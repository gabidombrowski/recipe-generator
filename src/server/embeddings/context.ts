import { createHash } from "node:crypto";
import { asc, inArray } from "drizzle-orm";
import { db, sqlite, vectorSearchAvailable } from "~/server/db/index";
import { contextChunks } from "~/server/db/schema";
import { loggerFor } from "~/server/logger";
import { embed } from "~/server/embeddings/index";

/**
 * Retrieval over the free-text context file.
 *
 * `nutrition-context.md` is capped at 256 KB — roughly 64k tokens, which is far
 * too much to put in front of the model on every generation, and most of it is
 * irrelevant to any one recipe. So it is chunked, embedded, and only the pieces
 * that resemble the current request are injected.
 *
 * This is the case retrieval is genuinely for: unstructured text, too large to
 * inline, variably relevant. Unlike the recipe index — which is a demonstration
 * at the current corpus size — there is no keyword fallback that would do as
 * well here, because the notes use the user's own words rather than ingredient
 * names.
 */

const log = loggerFor("context-retrieval");

/**
 * Chunk size in characters. Small enough that three chunks stay a modest
 * addition to the prompt, large enough that a paragraph is rarely split.
 */
const MAX_CHUNK_CHARS = 1200;

export interface ContextChunk {
  ordinal: number;
  heading: string | null;
  body: string;
}

/**
 * Splits markdown on headings first, then packs paragraphs up to the size cap.
 *
 * Heading-first matters: a heading is the strongest signal of what a passage is
 * about, and carrying it onto every chunk beneath it keeps an orphaned
 * paragraph interpretable both to the embedding model and to a reader.
 */
export function chunkContext(markdown: string): ContextChunk[] {
  interface Section {
    heading: string | null;
    lines: string[];
  }

  let current: Section = { heading: null, lines: [] };
  const sections: Section[] = [current];

  for (const line of markdown.split(/\r?\n/)) {
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      current = { heading: (headingMatch[1] ?? "").trim(), lines: [] };
      sections.push(current);
    } else {
      current.lines.push(line);
    }
  }

  const chunks: ContextChunk[] = [];
  let ordinal = 0;

  for (const section of sections) {
    const paragraphs = section.lines
      .join("\n")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    let buffer = "";
    const flush = () => {
      if (!buffer) return;
      chunks.push({ ordinal: ordinal++, heading: section.heading, body: buffer });
      buffer = "";
    };

    for (const paragraph of paragraphs) {
      // A single paragraph over the cap becomes its own chunk rather than
      // being cut mid-sentence; the cap is a target, not a hard limit.
      if (buffer && buffer.length + paragraph.length + 2 > MAX_CHUNK_CHARS) flush();
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (buffer.length >= MAX_CHUNK_CHARS) flush();
    }
    flush();
  }

  return chunks;
}

/** What gets embedded: the heading and body together, so context survives. */
function embeddingTextFor(chunk: ContextChunk): string {
  return chunk.heading ? `${chunk.heading}. ${chunk.body}` : chunk.body;
}

const asVecKey = (chunkId: number): bigint => BigInt(chunkId);

/**
 * Rebuilds the whole index from the file's current contents.
 *
 * A full rebuild rather than a diff: the file is small, edits move chunk
 * boundaries around anyway, and a stale chunk that no longer exists in the file
 * would silently keep influencing generation.
 */
export async function reindexContext(markdown: string): Promise<number> {
  if (!vectorSearchAvailable()) return 0;

  const chunks = chunkContext(markdown);

  db.delete(contextChunks).run();
  sqlite.prepare("DELETE FROM vec_context").run();
  if (chunks.length === 0) return 0;

  let indexed = 0;
  for (const chunk of chunks) {
    const text = embeddingTextFor(chunk);
    const vector = await embed(text);
    if (!vector) break; // model unavailable; leave the rest unindexed

    const row = db
      .insert(contextChunks)
      .values({
        ordinal: chunk.ordinal,
        heading: chunk.heading,
        body: chunk.body,
        contentHash: createHash("sha256").update(text).digest("hex").slice(0, 16),
      })
      .returning({ id: contextChunks.id })
      .get();

    sqlite
      .prepare("INSERT INTO vec_context(chunk_id, embedding) VALUES (?, ?)")
      .run(
        asVecKey(row.id),
        Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
      );
    indexed += 1;
  }

  log.info({ chunks: chunks.length, indexed }, "context reindexed");
  return indexed;
}

/**
 * Top-k context chunks resembling a generation request.
 *
 * Returned in file order rather than by score, so several retrieved passages
 * read the way they were written instead of in similarity order.
 */
export async function similarContext(query: string, k = 3): Promise<ContextChunk[]> {
  if (!vectorSearchAvailable()) return [];

  const vector = await embed(query);
  if (!vector) return [];

  const hits = sqlite
    .prepare(
      `SELECT chunk_id AS chunkId
       FROM vec_context
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance`,
    )
    .all(
      Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
      k,
    ) as { chunkId: number }[];

  if (hits.length === 0) return [];

  const rows = db
    .select()
    .from(contextChunks)
    .where(
      inArray(
        contextChunks.id,
        hits.map((h) => h.chunkId),
      ),
    )
    .orderBy(asc(contextChunks.ordinal))
    .all();

  return rows.map((r) => ({
    ordinal: r.ordinal,
    heading: r.heading,
    body: r.body,
  }));
}

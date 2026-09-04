import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlite, vectorSearchAvailable } from "~/server/db/index";
import { recipeEmbeddings } from "~/server/db/schema";
import { EMBEDDING_DIMENSIONS } from "~/server/db/schema";
import { loggerFor } from "~/server/logger";
import { type Recipe } from "~/lib/schemas";

/**
 * Semantic search over the recipe library.
 *
 * Embeddings are computed locally with all-MiniLM-L6-v2 through
 * transformers.js — no API call, no per-query cost, no data leaving the box —
 * and stored in a sqlite-vec virtual table alongside everything else.
 *
 * Worth being straight about the scale: with a few dozen recipes, a brute-force
 * scan over 384-dimensional vectors is instant, and plain `LIKE` would answer
 * most queries nearly as well. This exists because natural-language search
 * ("something cozy with chickpeas") genuinely can't be done with keywords, and
 * because the same embeddings feed the generator's exemplar retrieval. At this
 * corpus size it is a demonstration of the technique rather than a performance
 * necessity. See the README's honesty notes.
 */

const log = loggerFor("embeddings");

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

type FeatureExtractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

let extractorPromise: Promise<FeatureExtractor | null> | undefined;

/**
 * Loads the model on first use.
 *
 * The weights are ~25 MB and are fetched once, then cached on disk. Loading is
 * deliberately lazy: a user who never opens the library page never pays for it,
 * and a machine with no network still boots the app fine.
 */
async function getExtractor(): Promise<FeatureExtractor | null> {
  extractorPromise ??= (async () => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL);
      log.info({ model: EMBEDDING_MODEL }, "embedding model ready");
      return extractor as unknown as FeatureExtractor;
    } catch (error) {
      log.warn({ err: error }, "embedding model unavailable; semantic search disabled");
      return null;
    }
  })();
  return extractorPromise;
}

export async function embeddingsAvailable(): Promise<boolean> {
  return vectorSearchAvailable() && (await getExtractor()) !== null;
}

export async function embed(text: string): Promise<Float32Array | null> {
  const extractor = await getExtractor();
  if (!extractor) return null;

  const output = await extractor(text, { pooling: "mean", normalize: true });
  return output.data instanceof Float32Array
    ? output.data
    : new Float32Array(output.data);
}

/**
 * Embed a retrieval query, or null when retrieval could not use it anyway.
 *
 * Call sites that share one vector across several lookups need the
 * availability check *before* paying for the model, not inside each retriever
 * after the fact — otherwise a platform without sqlite-vec loads MiniLM to
 * produce a vector nothing can consume.
 */
export async function embedQuery(query: string): Promise<Float32Array | null> {
  if (!vectorSearchAvailable()) return null;
  return embed(query);
}

/**
 * What gets embedded: name, cuisine, meal type, and ingredient names.
 *
 * Steps are excluded on purpose — they are procedural text ("stir", "cover 3
 * min") that adds noise without helping anyone find a dish.
 */
export function embeddingText(recipe: Recipe): string {
  const ingredients = recipe.ingredients.map((i) => i.name).join(", ");
  return `${recipe.name}. ${recipe.cuisine} ${recipe.mealType}. Ingredients: ${ingredients}.`;
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function toBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * vec0 rejects a primary key that is not literally SQLITE_INTEGER, and
 * better-sqlite3 binds every JS `number` as a double — which SQLite reports as
 * SQLITE_FLOAT even when the value is integral. Binding a BigInt is what makes
 * the type check pass.
 */
const asVecKey = (recipeId: number): bigint => BigInt(recipeId);

/**
 * Embeds a recipe if its content has changed. Returns false when nothing
 * needed doing, which is what makes backfill cheap to run on every boot.
 */
export async function upsertRecipeEmbedding(recipe: Recipe): Promise<boolean> {
  if (!vectorSearchAvailable()) return false;

  const text = embeddingText(recipe);
  const hash = contentHash(text);

  const existing = db.query.recipeEmbeddings
    .findFirst({ where: eq(recipeEmbeddings.recipeId, recipe.id) })
    .sync();
  if (existing?.contentHash === hash) return false;

  const vector = await embed(text);
  if (!vector) return false;

  // vec0 has no upsert, so replace explicitly.
  sqlite.prepare("DELETE FROM vec_recipes WHERE recipe_id = ?").run(asVecKey(recipe.id));
  sqlite
    .prepare("INSERT INTO vec_recipes(recipe_id, embedding) VALUES (?, ?)")
    .run(asVecKey(recipe.id), toBlob(vector));

  db.insert(recipeEmbeddings)
    .values({
      recipeId: recipe.id,
      contentHash: hash,
      dimensions: EMBEDDING_DIMENSIONS,
      model: EMBEDDING_MODEL,
    })
    .onConflictDoUpdate({
      target: recipeEmbeddings.recipeId,
      set: { contentHash: hash, updatedAt: new Date().toISOString() },
    })
    .run();

  return true;
}

export function deleteRecipeEmbedding(recipeId: number): void {
  if (!vectorSearchAvailable()) return;
  sqlite.prepare("DELETE FROM vec_recipes WHERE recipe_id = ?").run(asVecKey(recipeId));
  db.delete(recipeEmbeddings).where(eq(recipeEmbeddings.recipeId, recipeId)).run();
}

export interface SemanticHit {
  recipeId: number;
  /** Cosine distance; lower is more similar. */
  distance: number;
}

/**
 * Top-k nearest recipes to a free-text query.
 *
 * `queryVector` lets a caller that has already embedded the text hand the
 * vector in. Two retrievals against the same request would otherwise run
 * MiniLM over identical input twice, and the embedding is the expensive half.
 */
export async function semanticSearch(
  query: string,
  k = 10,
  queryVector?: Float32Array | null,
): Promise<SemanticHit[]> {
  if (!vectorSearchAvailable()) return [];

  const vector = queryVector === undefined ? await embed(query) : queryVector;
  if (!vector) return [];

  const rows = sqlite
    .prepare(
      `SELECT recipe_id AS recipeId, distance
       FROM vec_recipes
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance`,
    )
    .all(toBlob(vector), k) as SemanticHit[];

  return rows;
}

/**
 * Top-k favourites similar to a generation request, injected into the generator
 * prompt as few-shot exemplars. Retrieval is what makes them *relevant*
 * exemplars rather than just the three most recently favourited dishes.
 */
export async function similarFavorites(
  query: string,
  favorites: readonly Recipe[],
  k = 3,
  queryVector?: Float32Array | null,
): Promise<Recipe[]> {
  if (favorites.length === 0) return [];

  const hits = await semanticSearch(query, k * 4, queryVector);
  if (hits.length === 0) return favorites.slice(0, k);

  const favoriteIds = new Set(favorites.map((r) => r.id));
  const byId = new Map(favorites.map((r) => [r.id, r]));

  const ranked = hits
    .filter((h) => favoriteIds.has(h.recipeId))
    .map((h) => byId.get(h.recipeId))
    .filter((r): r is Recipe => r !== undefined)
    .slice(0, k);

  // Fall back to arbitrary favourites rather than sending none.
  return ranked.length > 0 ? ranked : favorites.slice(0, k);
}

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { protectedProcedure, router } from "../init";
import {
  listExcluded,
  listLeftovers,
  listPantry,
  listRecipes,
} from "~/server/db/queries";
import { getProfile, getSettings } from "~/server/db/state";
import { computeMacroPlan } from "~/lib/macros";
import { reindexContext } from "~/server/embeddings/context";
import { loggerFor } from "~/server/logger";

/**
 * The context bridge.
 *
 * `nutrition-context.md` is a gitignored free-text file for the things that
 * don't belong in a schema — how a cut is going, what's been tasting good,
 * notes to bring to a coach. It is editable in the app and exportable as JSON,
 * so the data is portable rather than trapped in a SQLite file on one server.
 */

const log = loggerFor("context");

const CONTEXT_FILE = join(process.cwd(), "nutrition-context.md");
const EXAMPLE_FILE = join(process.cwd(), "nutrition-context.example.md");

/** Cap the writable size so a paste accident cannot fill the disk. */
const MAX_CONTEXT_BYTES = 256 * 1024;

export const contextRouter = router({
  get: protectedProcedure.query(() => {
    if (existsSync(CONTEXT_FILE)) {
      return { content: readFileSync(CONTEXT_FILE, "utf8"), exists: true };
    }
    // Seed the editor with the committed example so a fresh clone has a shape
    // to start from rather than a blank box.
    const example = existsSync(EXAMPLE_FILE) ? readFileSync(EXAMPLE_FILE, "utf8") : "";
    return { content: example, exists: false };
  }),

  save: protectedProcedure
    .input(
      z.object({
        // `.max()` counts characters, not bytes. The cap exists to bound what
        // lands on disk, and a file of multi-byte characters can be several
        // times its character count, so the byte length is what gets checked.
        content: z.string().refine(
          (value) => Buffer.byteLength(value, "utf8") <= MAX_CONTEXT_BYTES,
          { message: `Context must be ${MAX_CONTEXT_BYTES} bytes or fewer.` },
        ),
      }),
    )
    .mutation(async ({ input }) => {
      writeFileSync(CONTEXT_FILE, input.content, "utf8");

      // Re-embed so the next generation retrieves against what was just saved.
      // A failure here must not fail the save: the file is the source of truth
      // and the index is a derivative that a later save will rebuild.
      let indexedChunks = 0;
      try {
        indexedChunks = await reindexContext(input.content);
      } catch (error) {
        log.warn({ err: error }, "context saved but reindex failed");
      }

      return {
        ok: true,
        bytes: Buffer.byteLength(input.content, "utf8"),
        indexedChunks,
      };
    }),

  /** Everything worth taking elsewhere, as one JSON document. */
  exportData: protectedProcedure.query(() => {
    const profile = getProfile();
    const settings = getSettings();

    return {
      exportedAt: new Date().toISOString(),
      profile,
      settings,
      macroPlan: computeMacroPlan(profile),
      favorites: listRecipes().filter((r) => r.favorite),
      excluded: listExcluded().map((e) => e.name),
      pantry: listPantry(),
      leftovers: listLeftovers(),
    };
  }),
});

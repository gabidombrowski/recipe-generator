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

/**
 * The context bridge.
 *
 * `nutrition-context.md` is a gitignored free-text file for the things that
 * don't belong in a schema — how a cut is going, what's been tasting good,
 * notes to bring to a coach. It is editable in the app and exportable as JSON,
 * so the data is portable rather than trapped in a SQLite file on one server.
 */

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
    .input(z.object({ content: z.string().max(MAX_CONTEXT_BYTES) }))
    .mutation(({ input }) => {
      writeFileSync(CONTEXT_FILE, input.content, "utf8");
      return { ok: true, bytes: Buffer.byteLength(input.content, "utf8") };
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

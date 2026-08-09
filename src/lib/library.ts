import { type Recipe } from "./schemas";

/**
 * Whether a recipe belongs in the library.
 *
 * The generator writes every recipe it produces straight to the database — it
 * has to, because the planner assigns by id — so "every row in the table" is
 * not a library, it is a transcript. Seeded and hand-entered recipes are there
 * because someone chose them, so they always count; an AI one earns its place
 * only when it is explicitly saved.
 *
 * Keying on `source` rather than favouriting everything on write is what keeps
 * a fresh install from opening on an empty shelf.
 *
 * This lives in `lib/` rather than beside the router because it is a pure rule
 * about the domain, and because the router's module graph reaches Auth.js —
 * which cannot be loaded in the hermetic unit suite.
 */
export function isSaved(recipe: Pick<Recipe, "source" | "favorite">): boolean {
  return recipe.source !== "ai" || recipe.favorite;
}

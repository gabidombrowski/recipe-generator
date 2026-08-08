import { z } from "zod";
import { protectedProcedure, router } from "../init";
import {
  deleteRecipe,
  excludedLower,
  getRecipe,
  listRecipes,
  setFavorite,
} from "~/server/db/queries";
import { deleteRecipeEmbedding } from "~/server/embeddings/index";
import { backfillEmbeddings } from "~/server/embeddings/backfill";
import { embeddingsAvailable, semanticSearch } from "~/server/embeddings/index";
import { recipeHasExcluded } from "~/server/scheduler/rules";
import { mealTypeSchema, type Recipe } from "~/lib/schemas";

/**
 * The recipe library: filtering, search, and favourites.
 *
 * Filtering happens in memory. With a library measured in dozens that is
 * faster than round-tripping SQL, and it keeps the "fits remaining macros"
 * filter — which is arithmetic, not a query — in the same place as the rest.
 */

const filterSchema = z.object({
  cuisine: z.string().optional(),
  mealType: mealTypeSchema.optional(),
  maxCookMinutes: z.number().int().positive().optional(),
  favoritesOnly: z.boolean().default(false),
  hideExcluded: z.boolean().default(false),
  /** Plain keyword match over name, cuisine and ingredients. */
  keyword: z.string().optional(),
  /**
   * "Fits remaining macros": what has been eaten so far today. A recipe fits
   * when it fits in what is left, with a little headroom.
   */
  eaten: z
    .object({
      kcal: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      dayKcalTarget: z.number().positive(),
      dayProteinTarget: z.number().positive(),
    })
    .optional(),
});

/** A recipe fits if it does not overshoot remaining calories by more than 10%. */
const FIT_TOLERANCE = 1.1;

function matchesKeyword(recipe: Recipe, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    recipe.name,
    recipe.cuisine,
    ...recipe.ingredients.map((i) => i.name),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export const recipesRouter = router({
  list: protectedProcedure.input(filterSchema).query(async ({ input }) => {
    const excluded = excludedLower();
    let recipes = listRecipes();

    // Excluded recipes are always *flagged*; hiding them is the user's choice.
    const flagged = recipes.map((recipe) => ({
      recipe,
      hasExcluded: recipeHasExcluded(recipe, excluded),
    }));

    let result = flagged;
    if (input.hideExcluded) result = result.filter((r) => !r.hasExcluded);
    if (input.favoritesOnly) result = result.filter((r) => r.recipe.favorite);
    if (input.mealType) result = result.filter((r) => r.recipe.mealType === input.mealType);
    if (input.cuisine) {
      result = result.filter(
        (r) => r.recipe.cuisine.toLowerCase() === input.cuisine!.toLowerCase(),
      );
    }
    if (input.maxCookMinutes) {
      result = result.filter((r) => r.recipe.cookMinutes <= input.maxCookMinutes!);
    }
    if (input.keyword) {
      result = result.filter((r) => matchesKeyword(r.recipe, input.keyword!));
    }
    if (input.eaten) {
      const remainingKcal = input.eaten.dayKcalTarget - input.eaten.kcal;
      const remainingProtein = input.eaten.dayProteinTarget - input.eaten.proteinG;
      result = result.filter(
        (r) =>
          r.recipe.macrosPerServing.kcal <= remainingKcal * FIT_TOLERANCE &&
          r.recipe.macrosPerServing.proteinG <= remainingProtein * FIT_TOLERANCE,
      );
    }

    recipes = result.map((r) => r.recipe);
    const excludedIds = new Set(
      flagged.filter((r) => r.hasExcluded).map((r) => r.recipe.id),
    );

    return {
      recipes,
      excludedRecipeIds: [...excludedIds],
      cuisines: [...new Set(listRecipes().map((r) => r.cuisine))].sort(),
    };
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getRecipe(input.id)),

  /**
   * Natural-language search. Falls back to keyword matching when the embedding
   * model or sqlite-vec is unavailable, so the search box always does
   * *something* rather than silently returning nothing.
   */
  semanticSearch: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(12) }))
    .query(async ({ input }) => {
      const all = listRecipes();

      if (!(await embeddingsAvailable())) {
        return {
          mode: "keyword" as const,
          recipes: all.filter((r) => matchesKeyword(r, input.query)),
        };
      }

      // Cheap when everything is already embedded; covers recipes added since.
      await backfillEmbeddings();

      const hits = await semanticSearch(input.query, input.limit);
      const byId = new Map(all.map((r) => [r.id, r]));
      return {
        mode: "semantic" as const,
        recipes: hits
          .map((h) => byId.get(h.recipeId))
          .filter((r): r is Recipe => r !== undefined),
      };
    }),

  setFavorite: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), favorite: z.boolean() }))
    .mutation(({ input }) => setFavorite(input.id, input.favorite)),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => {
      deleteRecipeEmbedding(input.id);
      deleteRecipe(input.id);
      return { ok: true };
    }),
});

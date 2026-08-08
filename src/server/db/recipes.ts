import { eq } from "drizzle-orm";
import { db } from "./index";
import { recipes } from "./schema";
import { countTags } from "~/lib/guidelines";
import {
  applyIngredientTags,
  type Ingredient,
  type Recipe,
  type RecipeBody,
  type RecipeSource,
} from "~/lib/schemas";

/**
 * Recipe persistence.
 *
 * Every write goes through here so that the two derived columns —
 * `tagCounts` and `searchBlob` — cannot drift from `ingredients`.
 * Neither is ever accepted from a caller: a client could get them wrong, and a
 * model could get them wrong on purpose.
 */

/**
 * Lowercased ingredient names and tags in one string, so exclusion matching is
 * a single indexed `LIKE` rather than a JSON scan per row.
 */
export function buildSearchBlob(ingredients: readonly Ingredient[]): string {
  return ingredients
    .flatMap((i) => [i.name, ...i.tags])
    .map((s) => s.trim().toLowerCase())
    .join(" | ");
}

interface Provenance {
  source: RecipeSource;
  promptHash?: string | null;
  modelString?: string | null;
}

type RecipeRow = typeof recipes.$inferSelect;

/** Map a database row to the shared `Recipe` shape. */
export function toRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    name: row.name,
    cuisine: row.cuisine,
    cookMinutes: row.cookMinutes,
    servings: row.servings,
    mealType: row.mealType,
    ingredients: row.ingredients,
    steps: row.steps,
    macrosPerServing: row.macrosPerServing,
    favorite: row.favorite,
    tagCounts: row.tagCounts,
    source: row.source,
    promptHash: row.promptHash,
    modelString: row.modelString,
    createdAt: row.createdAt,
  };
}

function toValues(body: RecipeBody, provenance: Provenance) {
  // Factual culinary tags are normalised here, so a recipe from the AI
  // generator is tagged identically to one from the seed data.
  const ingredients = applyIngredientTags(body.ingredients);

  return {
    name: body.name,
    cuisine: body.cuisine,
    cookMinutes: body.cookMinutes,
    servings: body.servings,
    mealType: body.mealType,
    ingredients,
    steps: body.steps,
    macrosPerServing: body.macrosPerServing,
    tagCounts: countTags(ingredients),
    searchBlob: buildSearchBlob(ingredients),
    source: provenance.source,
    promptHash: provenance.promptHash ?? null,
    modelString: provenance.modelString ?? null,
  };
}

export function insertRecipe(body: RecipeBody, provenance: Provenance): Recipe {
  const [row] = db
    .insert(recipes)
    .values(toValues(body, provenance))
    .returning()
    .all();
  return toRecipe(row!);
}

/**
 * Insert, or return the existing recipe if the name is already taken.
 * Used by seeding (idempotent re-runs) and by the generator (a model that
 * reinvents an existing dish should not create a duplicate).
 */
export function insertRecipeIfAbsent(
  body: RecipeBody,
  provenance: Provenance,
): { recipe: Recipe; created: boolean } {
  const existing = db.query.recipes
    .findFirst({ where: eq(recipes.name, body.name) })
    .sync();
  if (existing) return { recipe: toRecipe(existing), created: false };
  return { recipe: insertRecipe(body, provenance), created: true };
}

export function updateRecipeBody(id: number, body: RecipeBody): Recipe {
  // Editing changes the food, not where the recipe came from — so provenance
  // is destructured out rather than rewritten.
  const { source: _source, promptHash: _promptHash, modelString: _modelString, ...bodyValues } =
    toValues(body, { source: "manual" });

  const [row] = db
    .update(recipes)
    .set(bodyValues)
    .where(eq(recipes.id, id))
    .returning()
    .all();
  return toRecipe(row!);
}

import { z } from "zod";

/**
 * The single source of truth for every domain shape in the app.
 *
 * These schemas are imported by the Drizzle layer (to validate what goes into
 * and comes out of SQLite's JSON columns), by every tRPC procedure (as input
 * and output schemas), by the React components (as inferred types), by the LLM
 * generator (converted to a JSON Schema for the forced tool call), and by the
 * eval assertions. Defining them once is what keeps the client, the server and
 * the model from drifting apart.
 *
 * Nothing here imports from `node:` — this module is client-safe.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Week starts Sunday: the seed's generation day, and the grid's first column. */
export const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const dayOfWeekSchema = z.enum(DAYS_OF_WEEK);
export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;

export const sexSchema = z.enum(["female", "male"]);
export type Sex = z.infer<typeof sexSchema>;

/** What a recipe *is*. Drives cook time bounds and scheduler slot eligibility. */
export const mealTypeSchema = z.enum(["cook", "quick", "assembly"]);
export type MealType = z.infer<typeof mealTypeSchema>;

/** What a plan slot *wants*. A superset of MealType — leftovers aren't recipes. */
export const mealSourceSchema = z.enum(["cook", "quick", "assembly", "leftover"]);
export type MealSource = z.infer<typeof mealSourceSchema>;

export const storageSchema = z.enum(["fridge", "freezer"]);
export type Storage = z.infer<typeof storageSchema>;

export const recipeSourceSchema = z.enum(["seed", "ai", "manual"]);
export type RecipeSource = z.infer<typeof recipeSourceSchema>;

export const plannerModeSchema = z.enum(["deterministic", "ai"]);
export type PlannerMode = z.infer<typeof plannerModeSchema>;

export const feedbackVerdictSchema = z.enum(["accepted", "rejected"]);
export type FeedbackVerdict = z.infer<typeof feedbackVerdictSchema>;

/** `YYYY-MM-DD`, always interpreted in the user's configured timezone. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** 24-hour `HH:MM`. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24-hour)");

// ---------------------------------------------------------------------------
// Culinary tags
// ---------------------------------------------------------------------------

/**
 * Ingredient tags are neutral culinary descriptors — `fermented`, `aged`,
 * `cured`, `vinegar` — describing what a food *is*, not what anyone should
 * avoid. Which of them matter is entirely a user decision, expressed as
 * dietary guidelines at runtime (see `~/lib/guidelines`).
 *
 * This separation is the point. The committed repository describes food; the
 * gitignored database holds the reasons a particular person cares.
 */
export const KNOWN_INGREDIENT_TAGS = [
  "fermented",
  "aged",
  "cured",
  "vinegar",
  "smoked",
  "spicy",
  "raw",
  "dairy",
  "gluten",
  "nut",
  "shellfish",
  "nightshade",
] as const;

/**
 * Ingredients whose tags are applied automatically, so a new recipe cannot
 * forget one. These are culinary facts: gochujang *is* fermented, feta *is*
 * aged. Whether that matters to the cook is a separate, private question.
 */
export const INGREDIENT_TAG_RULES: ReadonlyArray<[string, readonly string[]]> = [
  ["soy sauce", ["fermented"]],
  ["fish sauce", ["fermented"]],
  ["oyster sauce", ["fermented"]],
  ["gochujang", ["fermented", "spicy"]],
  ["miso", ["fermented"]],
  ["kimchi", ["fermented", "spicy"]],
  ["vinegar", ["vinegar"]],
  ["feta", ["aged", "dairy"]],
  ["parmesan", ["aged", "dairy"]],
  ["blue cheese", ["aged", "dairy"]],
  ["prosciutto", ["cured"]],
  ["salami", ["cured"]],
  ["bacon", ["cured", "smoked"]],
  ["anchovy", ["cured"]],
];

// ---------------------------------------------------------------------------
// Recipe
// ---------------------------------------------------------------------------

export const ingredientSchema = z.object({
  name: z.string().min(1).max(120),
  qty: z.number().positive(),
  unit: z.string().min(1).max(24),
  /** Neutral culinary descriptors; see `KNOWN_INGREDIENT_TAGS`. */
  tags: z.array(z.string().max(48)).default([]),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const macrosSchema = z.object({
  kcal: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
});
export type Macros = z.infer<typeof macrosSchema>;

/**
 * The recipe body: everything that describes the food, with no database or
 * provenance concerns attached.
 *
 * This is the schema handed to the model as a forced tool call, so its field
 * descriptions double as instructions. Keep them imperative.
 */
export const recipeBodySchema = z.object({
  name: z.string().min(1).max(120).describe("Short dish name."),
  cuisine: z
    .string()
    .min(1)
    .max(60)
    .describe("Cuisine or culinary tradition, e.g. Korean, Peruvian."),
  cookMinutes: z
    .number()
    .int()
    .positive()
    .max(240)
    .describe("Total hands-on minutes, start to plate."),
  servings: z
    .number()
    .int()
    .positive()
    .max(12)
    .describe("Servings this ingredient list yields. Cook recipes must be 2."),
  mealType: mealTypeSchema.describe(
    "cook = 15-30 min, scales to 2 servings. quick = 5-10 min. assembly = no-cook.",
  ),
  ingredients: z
    .array(ingredientSchema)
    .min(1)
    .max(40)
    .describe(
      "Every ingredient with quantity and unit, plus any culinary tags that apply (fermented, aged, cured, vinegar, smoked, dairy, gluten, nut, shellfish, nightshade).",
    ),
  steps: z
    .array(z.string().min(1).max(600))
    .min(1)
    .max(20)
    .describe("Ordered instructions, one sentence or two each."),
  macrosPerServing: macrosSchema.describe(
    "Per single serving, not per batch. kcal must agree with 4*protein + 4*carbs + 9*fat.",
  ),
});
export type RecipeBody = z.infer<typeof recipeBodySchema>;

/** A persisted recipe: the body plus identity, provenance and derived fields. */
export const recipeSchema = recipeBodySchema.extend({
  id: z.number().int().positive(),
  favorite: z.boolean(),
  /**
   * Derived: how many ingredients carry each culinary tag. Computed on write
   * from `ingredients`, never accepted from a client or a model. Stored rather
   * than computed on read so any guideline can be evaluated without re-walking
   * the ingredient list.
   */
  tagCounts: z.record(z.string(), z.number().int().nonnegative()),
  source: recipeSourceSchema,
  /** SHA-256 of the prompt file that produced this recipe; null unless AI. */
  promptHash: z.string().nullable(),
  /** Model id that produced this recipe; null unless AI. */
  modelString: z.string().nullable(),
  createdAt: z.string(),
});
export type Recipe = z.infer<typeof recipeSchema>;

/**
 * Applies `INGREDIENT_TAG_RULES` to an ingredient list, so factual culinary
 * tags are consistent whether a recipe came from the seed data, the AI
 * generator, or a hand edit.
 */
export function applyIngredientTags(
  ingredients: readonly Ingredient[],
): Ingredient[] {
  return ingredients.map((ingredient) => {
    const name = ingredient.name.toLowerCase();
    const existing = new Set(ingredient.tags.map((t) => t.trim().toLowerCase()));

    for (const [needle, tags] of INGREDIENT_TAG_RULES) {
      if (!name.includes(needle)) continue;
      for (const tag of tags) existing.add(tag);
    }

    return { ...ingredient, tags: [...existing].sort() };
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Committed defaults are deliberately neutral placeholders. Real values arrive
 * from the first-run wizard or from a gitignored `seed.local.json`, never from
 * this file. See README → "Public repo hygiene".
 */
export const profileSchema = z.object({
  weightKg: z.number().positive().max(400),
  heightCm: z.number().positive().max(280),
  age: z.number().int().positive().max(120),
  sex: sexSchema,
  /** Multiplier applied to BMR. ~1.2 sedentary to ~1.9 very active. */
  activityFactor: z.number().min(1).max(2.5),
  /** Daily kcal subtracted from TDEE to set the weekly average target. */
  deficitKcal: z.number().min(0).max(1500),
  proteinPerKg: z.number().min(0).max(5),
  fatPerKg: z.number().min(0).max(3),
  trainingDays: z.array(dayOfWeekSchema),
  cookDays: z.array(dayOfWeekSchema),
  assemblyDays: z.array(dayOfWeekSchema),
});
export type Profile = z.infer<typeof profileSchema>;

export const DEFAULT_PROFILE: Profile = {
  weightKg: 70,
  heightCm: 170,
  age: 30,
  sex: "female",
  activityFactor: 1.4,
  deficitKcal: 0,
  proteinPerKg: 1.6,
  fatPerKg: 0.8,
  trainingDays: [],
  cookDays: [],
  assemblyDays: [],
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settingsSchema = z.object({
  shoppingDay: dayOfWeekSchema,
  generationDay: dayOfWeekSchema,
  generationTime: timeOfDaySchema,
  /** IANA zone, e.g. `America/Chicago`. Drives the cron and all date math. */
  timezone: z.string().min(1).max(64),
  aiNovelRecipesPerWeek: z.number().int().min(0).max(7),
  /** Don't reuse a recipe scheduled within this many weeks. */
  repeatWindowWeeks: z.number().int().min(0).max(52),
  plannerMode: plannerModeSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  shoppingDay: "Sunday",
  generationDay: "Sunday",
  generationTime: "06:00",
  timezone: "UTC",
  aiNovelRecipesPerWeek: 0,
  repeatWindowWeeks: 2,
  plannerMode: "deterministic",
};

/**
 * The shape of `seed.local.json` — a flat merge of Profile and Settings.
 *
 * That file is gitignored and holds real personal values. The committed
 * `seed.local.example.json` carries placeholders with the same shape, so the
 * loader is exercised by anyone cloning the repo without exposing anything.
 * `plannerMode` is optional because the deterministic default is the right
 * starting point for a fresh install.
 */
export const localSeedSchema = profileSchema.merge(
  settingsSchema.extend({ plannerMode: plannerModeSchema.default("deterministic") }),
);
export type LocalSeed = z.infer<typeof localSeedSchema>;

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

export const excludedIngredientSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
});
export type ExcludedIngredient = z.infer<typeof excludedIngredientSchema>;

export const leftoverItemSchema = z.object({
  id: z.number().int().positive(),
  recipeName: z.string().min(1).max(120),
  cookedDate: isoDateSchema,
  storage: storageSchema,
  portions: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type LeftoverItem = z.infer<typeof leftoverItemSchema>;

export const pantryStapleSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  onHand: z.boolean(),
});
export type PantryStaple = z.infer<typeof pantryStapleSchema>;

export const planSlotSchema = z.object({
  id: z.number().int().positive(),
  date: isoDateSchema,
  mealSource: mealSourceSchema,
  recipeId: z.number().int().positive().nullable(),
});
export type PlanSlot = z.infer<typeof planSlotSchema>;

export const generationFeedbackSchema = z.object({
  id: z.number().int().positive(),
  recipeId: z.number().int().positive(),
  verdict: feedbackVerdictSchema,
  reason: z.string().max(2000),
  createdAt: z.string(),
  promotedToFixture: z.boolean(),
});
export type GenerationFeedback = z.infer<typeof generationFeedbackSchema>;

/**
 * One verifier pass over one planner proposal. Recorded on the scheduler run so
 * the weekly view can show *why* a proposal was rejected, not just that it was.
 */
export const plannerVerdictRecordSchema = z.object({
  attempt: z.number().int().positive(),
  ok: z.boolean(),
  reasons: z.array(z.string()),
});
export type PlannerVerdictRecord = z.infer<typeof plannerVerdictRecordSchema>;

/** Outcome of one scheduler run, surfaced on the weekly plan view. */
export const schedulerRunSchema = z.object({
  id: z.number().int().positive(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  weekStart: isoDateSchema,
  mode: plannerModeSchema,
  /** True when AI planning was attempted but deterministic output was used. */
  fellBack: z.boolean(),
  status: z.enum(["success", "skipped", "failed"]),
  slotsCreated: z.number().int().nonnegative(),
  aiRecipesCreated: z.number().int().nonnegative(),
  message: z.string(),
  verifierVerdicts: z.array(plannerVerdictRecordSchema),
});
export type SchedulerRun = z.infer<typeof schedulerRunSchema>;

// ---------------------------------------------------------------------------
// Grocery list
// ---------------------------------------------------------------------------

/** Store sections, in the order the list renders them. */
export const GROCERY_SECTIONS = [
  "Produce",
  "Proteins & Dairy",
  "Pantry",
  "Frozen",
] as const;
export const grocerySectionSchema = z.enum(GROCERY_SECTIONS);
export type GrocerySection = z.infer<typeof grocerySectionSchema>;

export const groceryLineSchema = z.object({
  /** Stable identity across renders: `name|unit`, lowercased. */
  key: z.string(),
  name: z.string(),
  qty: z.number(),
  unit: z.string(),
  section: grocerySectionSchema,
  checked: z.boolean(),
  /** Culinary tags on this line that an active guideline limits. */
  flaggedTags: z.array(z.string()),
  /** Seafood is bought day-of or day-before, so it lists separately. */
  buyLater: z.boolean(),
  /** Which recipes contributed to this merged line, for provenance. */
  sources: z.array(z.string()),
});
export type GroceryLine = z.infer<typeof groceryLineSchema>;

export const groceryListSchema = z.object({
  weekStart: isoDateSchema,
  shoppingDay: dayOfWeekSchema,
  sections: z.array(
    z.object({
      section: grocerySectionSchema,
      lines: z.array(groceryLineSchema),
    }),
  ),
  /** Seafood lines, pulled out of the main sections. */
  buyLater: z.array(groceryLineSchema),
  /** Pantry staples marked on-hand: verify rather than buy. */
  checkYourSupply: z.array(z.string()),
});
export type GroceryList = z.infer<typeof groceryListSchema>;

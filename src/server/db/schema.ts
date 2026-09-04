import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { type Constraint, type ConstraintKind } from "~/lib/constraints";
import {
  type DayOfWeek,
  type FeedbackVerdict,
  type GroceryCopyFormat,
  type Ingredient,
  type Macros,
  type MealSource,
  type MealType,
  type PlannerMode,
  type PlannerVerdictRecord,
  type RecipeSource,
  type Sex,
  type Storage,
  type UnitSystem,
} from "~/lib/schemas";

/**
 * Drizzle schema.
 *
 * SQLite has no native JSON, array or boolean types, so structured fields are
 * stored as JSON text and booleans as 0/1 integers. Drizzle's `$type<T>()`
 * pins the TypeScript type on the way out; the zod schemas in `~/lib/schemas`
 * are what actually validate the way in. Neither is redundant — one is a
 * compile-time claim, the other a runtime check on data that has been through
 * a text column.
 *
 * `profile` and `settings` are singletons pinned to id 1. A one-row table is
 * clumsier than a key/value store to write but far better to read: the columns
 * are the schema, and a typo in a setting name is a compile error.
 */

const timestamp = (name: string) =>
  text(name)
    .notNull()
    .default(sql`(current_timestamp)`);

// ---------------------------------------------------------------------------
// Profile & settings (singletons)
// ---------------------------------------------------------------------------

export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  weightKg: real("weight_kg").notNull(),
  heightCm: real("height_cm").notNull(),
  age: integer("age").notNull(),
  sex: text("sex").$type<Sex>().notNull(),
  activityFactor: real("activity_factor").notNull(),
  deficitKcal: real("deficit_kcal").notNull(),
  proteinPerKg: real("protein_per_kg").notNull(),
  fatPerKg: real("fat_per_kg").notNull(),
  trainingDays: text("training_days", { mode: "json" })
    .$type<DayOfWeek[]>()
    .notNull(),
  cookDays: text("cook_days", { mode: "json" }).$type<DayOfWeek[]>().notNull(),
  assemblyDays: text("assembly_days", { mode: "json" })
    .$type<DayOfWeek[]>()
    .notNull(),
  updatedAt: timestamp("updated_at"),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  shoppingDay: text("shopping_day").$type<DayOfWeek>().notNull(),
  generationDay: text("generation_day").$type<DayOfWeek>().notNull(),
  generationTime: text("generation_time").notNull(),
  timezone: text("timezone").notNull(),
  aiNovelRecipesPerWeek: integer("ai_novel_recipes_per_week").notNull(),
  repeatWindowWeeks: integer("repeat_window_weeks").notNull(),
  plannerMode: text("planner_mode").$type<PlannerMode>().notNull(),
  /** Which format the grocery list's copy button produces. */
  groceryCopyFormat: text("grocery_copy_format")
    .$type<GroceryCopyFormat>()
    .notNull()
    .default("text"),
  /** kg/cm or lb/ft-in in the UI. Stored values are always metric. */
  units: text("units").$type<UnitSystem>().notNull().default("metric"),
  /** The user's cuisine palette; drives pickers and the AI filler's rotation. */
  cuisines: text("cuisines", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /** The meals eaten each day; daily targets divide across them. */
  meals: text("meals", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /** Which of `meals` the scheduler fills; each gets a slot per day. */
  plannedMeals: text("planned_meals", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /** The one meal carrying the cook -> leftover cycle. */
  mainMeal: text("main_meal").notNull().default("Dinner"),
  /** Flipped once the first-run wizard completes or a local seed is loaded. */
  setupComplete: integer("setup_complete", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: timestamp("updated_at"),
});

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export const recipes = sqliteTable(
  "recipes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    cuisine: text("cuisine").notNull(),
    cookMinutes: integer("cook_minutes").notNull(),
    servings: integer("servings").notNull(),
    mealType: text("meal_type").$type<MealType>().notNull(),
    ingredients: text("ingredients", { mode: "json" })
      .$type<Ingredient[]>()
      .notNull(),
    steps: text("steps", { mode: "json" }).$type<string[]>().notNull(),
    /** Lowercased ingredient names and tags, for cheap `LIKE` exclusion scans. */
    searchBlob: text("search_blob").notNull().default(""),
    macrosPerServing: text("macros_per_serving", { mode: "json" })
      .$type<Macros>()
      .notNull(),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    /**
     * Derived from `ingredients` on every write, never accepted from a client
     * or a model. Stored rather than recomputed on read so any dietary
     * guideline can be evaluated without re-walking the ingredient list.
     */
    tagCounts: text("tag_counts", { mode: "json" })
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'`),
    source: text("source").$type<RecipeSource>().notNull(),
    /** SHA-256 of the prompt file that produced this recipe. */
    promptHash: text("prompt_hash"),
    modelString: text("model_string"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    uniqueIndex("recipes_name_unique").on(t.name),
    index("recipes_meal_type_idx").on(t.mealType),
    index("recipes_favorite_idx").on(t.favorite),
  ],
);

/**
 * Tracks which recipes have a vector in the sqlite-vec virtual table and what
 * text produced it. The vector itself lives in `vec_recipes` (see
 * `VEC_TABLE_DDL`) because virtual tables are outside Drizzle's schema model.
 * `contentHash` is what makes re-embedding incremental: unchanged recipes are
 * skipped on backfill.
 */
export const recipeEmbeddings = sqliteTable("recipe_embeddings", {
  recipeId: integer("recipe_id")
    .primaryKey()
    .references(() => recipes.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  dimensions: integer("dimensions").notNull(),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at"),
});

/**
 * `nutrition-context.md` split into retrievable pieces.
 *
 * The file is capped at 256 KB — far too much to put in front of the model on
 * every generation, and most of it is irrelevant to any one recipe. Chunking it
 * and retrieving only the relevant parts is what makes free-text notes usable
 * as context rather than as an all-or-nothing paste.
 */
export const contextChunks = sqliteTable("context_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Position in the source file, so retrieved chunks can be shown in order. */
  ordinal: integer("ordinal").notNull(),
  /** The markdown heading this chunk sat under, if any. Embedded with the body. */
  heading: text("heading"),
  body: text("body").notNull(),
  contentHash: text("content_hash").notNull(),
  updatedAt: timestamp("updated_at"),
});

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export const planSlots = sqliteTable(
  "plan_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    /** Which meal of the day this slot is, e.g. "Dinner". */
    meal: text("meal").notNull().default("Dinner"),
    mealSource: text("meal_source").$type<MealSource>().notNull(),
    recipeId: integer("recipe_id").references(() => recipes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    // One slot per meal per calendar date. This used to be unique on `date`
    // alone, which *was* the "the app plans one meal a day" assumption — the
    // schema enforced it, so nothing above it could have planned breakfast even
    // if it wanted to.
    uniqueIndex("plan_slots_date_meal_unique").on(t.date, t.meal),
    index("plan_slots_recipe_idx").on(t.recipeId),
  ],
);

export const schedulerRuns = sqliteTable(
  "scheduler_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    startedAt: timestamp("started_at"),
    finishedAt: text("finished_at"),
    weekStart: text("week_start").notNull(),
    mode: text("mode").$type<PlannerMode>().notNull(),
    fellBack: integer("fell_back", { mode: "boolean" }).notNull().default(false),
    status: text("status")
      .$type<"success" | "skipped" | "failed">()
      .notNull(),
    slotsCreated: integer("slots_created").notNull().default(0),
    aiRecipesCreated: integer("ai_recipes_created").notNull().default(0),
    message: text("message").notNull().default(""),
    verifierVerdicts: text("verifier_verdicts", { mode: "json" })
      .$type<PlannerVerdictRecord[]>()
      .notNull()
      .default(sql`'[]'`),
  },
  (t) => [index("scheduler_runs_week_idx").on(t.weekStart)],
);

// ---------------------------------------------------------------------------
// Pantry, exclusions, leftovers
// ---------------------------------------------------------------------------

export const excludedIngredients = sqliteTable(
  "excluded_ingredients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** Lowercased `name`, so matching is case-insensitive in plain SQL. */
    nameLower: text("name_lower").notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("excluded_ingredients_name_unique").on(t.nameLower)],
);

/**
 * The user's dietary rules, stored as a discriminated union.
 *
 * This table is why the committed code names no medical condition and no
 * personal preference: every rule — tag caps, excluded ingredients, protein
 * bands, meal shapes, ingredient forms, leftover windows, daily staples — is a
 * row here, entered at runtime, in the gitignored database. Ships empty.
 *
 * The payload is JSON rather than columns because the kinds have genuinely
 * different shapes; `constraintSchema` validates it on the way in and out, so
 * the looseness stops at this boundary.
 */
export const constraints = sqliteTable(
  "constraints",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").$type<ConstraintKind>().notNull(),
    payload: text("payload", { mode: "json" }).$type<Constraint>().notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("constraints_kind_idx").on(t.kind)],
);

/**
 * The culinary tag vocabulary, and which ingredient names earn each tag.
 *
 * User-defined so someone tracking FODMAPs can add `high-fodmap` with its own
 * patterns without touching code. Ships empty; the setup flow offers a
 * suggested vocabulary to pick from.
 */
export const ingredientTags = sqliteTable(
  "ingredient_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    matchPatterns: text("match_patterns", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("ingredient_tags_name_unique").on(t.name)],
);

export const pantryStaples = sqliteTable(
  "pantry_staples",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    onHand: integer("on_hand", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("pantry_staples_name_unique").on(t.name)],
);

export const leftoverItems = sqliteTable(
  "leftover_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeName: text("recipe_name").notNull(),
    cookedDate: text("cooked_date").notNull(),
    storage: text("storage").$type<Storage>().notNull(),
    portions: integer("portions").notNull().default(1),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("leftover_items_cooked_date_idx").on(t.cookedDate)],
);

// ---------------------------------------------------------------------------
// Grocery list check state
// ---------------------------------------------------------------------------

/**
 * The grocery list itself is derived on read and never stored — see
 * `~/server/grocery`. Only the checkbox state is persisted, keyed by week so
 * ticking things off does not leak into next week's list.
 */
export const groceryChecks = sqliteTable(
  "grocery_checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    weekStart: text("week_start").notNull(),
    /** Stable identity of a merged line: `name|unit`, lowercased. */
    lineKey: text("line_key").notNull(),
    checked: integer("checked", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("grocery_checks_week_line_unique").on(t.weekStart, t.lineKey)],
);

// ---------------------------------------------------------------------------
// Generation feedback
// ---------------------------------------------------------------------------

export const generationFeedback = sqliteTable(
  "generation_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    verdict: text("verdict").$type<FeedbackVerdict>().notNull(),
    reason: text("reason").notNull().default(""),
    /** Set once a rejection has been written out as an eval fixture. */
    promotedToFixture: integer("promoted_to_fixture", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("generation_feedback_recipe_idx").on(t.recipeId)],
);

// ---------------------------------------------------------------------------
// sqlite-vec
// ---------------------------------------------------------------------------

/** all-MiniLM-L6-v2 output width. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * `vec0` virtual tables are created outside Drizzle's migration model — the
 * generator has no concept of them — so the migrate step issues this DDL
 * directly after the generated migrations have run. It is idempotent.
 */
export const VEC_TABLE_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_recipes USING vec0(
  recipe_id INTEGER PRIMARY KEY,
  embedding float[${EMBEDDING_DIMENSIONS}]
);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_context USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[${EMBEDDING_DIMENSIONS}]
);
`;

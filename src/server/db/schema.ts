import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  type DayOfWeek,
  type FeedbackVerdict,
  type Ingredient,
  type Macros,
  type MealSource,
  type MealType,
  type PlannerMode,
  type PlannerVerdictRecord,
  type RecipeSource,
  type Sex,
  type Storage,
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

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export const planSlots = sqliteTable(
  "plan_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    mealSource: text("meal_source").$type<MealSource>().notNull(),
    recipeId: integer("recipe_id").references(() => recipes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    // One slot per calendar date: the plan is one meal per day.
    uniqueIndex("plan_slots_date_unique").on(t.date),
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
 * User-entered dietary rules.
 *
 * This table is why the committed code names no medical condition: everything
 * the app knows about someone's dietary needs is a row here, in the gitignored
 * database, entered at runtime. Ships empty.
 *
 * `note` reaches an LLM system prompt, so it is validated by
 * `validateGuidelineNote` before it ever gets here.
 */
export const dietaryGuidelines = sqliteTable("dietary_guidelines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Culinary tag this constrains, e.g. `fermented`. Null for a note-only rule. */
  tag: text("tag"),
  /** At most N ingredients carrying `tag` in one recipe. */
  maxPerRecipe: integer("max_per_recipe"),
  /** At most N cook recipes containing `tag` across one week. */
  maxCookPerWeek: integer("max_cook_per_week"),
  note: text("note").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: timestamp("created_at"),
});

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
`;

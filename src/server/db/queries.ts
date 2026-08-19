import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "./index";
import { toRecipe } from "./recipes";
import { cappedTags } from "~/lib/constraints";
import { getDietaryConfig } from "./config";
import {
  excludedIngredients,
  generationFeedback,
  groceryChecks,
  leftoverItems,
  pantryStaples,
  planSlots,
  recipes,
  schedulerRuns,
} from "./schema";
import { addDays, type IsoDate } from "~/lib/days";
import {
  type MealSource,
  type PlanSlot,
  type Recipe,
  type SchedulerRun,
  type Storage,
} from "~/lib/schemas";
import { type PlannedMeal } from "~/server/grocery";
import { type SlotPlan } from "~/server/scheduler/rules";

/**
 * Query helpers shared by the tRPC routers and the scheduler.
 *
 * Both callers need the same reads — the week's slots, the exclude list, recent
 * history — and duplicating them would let the scheduler and the UI drift into
 * disagreeing about what the plan is.
 */

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export function listRecipes(): Recipe[] {
  return db.select().from(recipes).all().map(toRecipe);
}

export function getRecipe(id: number): Recipe | null {
  const row = db.query.recipes.findFirst({ where: eq(recipes.id, id) }).sync();
  return row ? toRecipe(row) : null;
}

export function recipesById(): Map<number, Recipe> {
  return new Map(listRecipes().map((r) => [r.id, r]));
}

export function setFavorite(id: number, favorite: boolean): Recipe | null {
  db.update(recipes).set({ favorite }).where(eq(recipes.id, id)).run();
  return getRecipe(id);
}

export function deleteRecipe(id: number): void {
  db.delete(recipes).where(eq(recipes.id, id)).run();
}

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

export function listExcluded() {
  return db
    .select()
    .from(excludedIngredients)
    .orderBy(excludedIngredients.name)
    .all();
}

/** Lowercased names, the form every matching predicate expects. */
export function excludedLower(): string[] {
  return listExcluded().map((e) => e.nameLower);
}

export function addExcluded(name: string) {
  const trimmed = name.trim();
  db.insert(excludedIngredients)
    .values({ name: trimmed, nameLower: trimmed.toLowerCase() })
    .onConflictDoNothing()
    .run();
  return listExcluded();
}

export function removeExcluded(id: number) {
  db.delete(excludedIngredients).where(eq(excludedIngredients.id, id)).run();
  return listExcluded();
}

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

export function listPantry() {
  return db.select().from(pantryStaples).orderBy(pantryStaples.name).all();
}

export function setPantryOnHand(id: number, onHand: boolean) {
  db.update(pantryStaples)
    .set({ onHand })
    .where(eq(pantryStaples.id, id))
    .run();
  return listPantry();
}

export function addPantryStaple(name: string) {
  db.insert(pantryStaples)
    .values({ name: name.trim(), onHand: false })
    .onConflictDoNothing()
    .run();
  return listPantry();
}

export function removePantryStaple(id: number) {
  db.delete(pantryStaples).where(eq(pantryStaples.id, id)).run();
  return listPantry();
}

// ---------------------------------------------------------------------------
// Leftovers
// ---------------------------------------------------------------------------

export function listLeftovers() {
  return db
    .select()
    .from(leftoverItems)
    .where(gte(leftoverItems.portions, 1))
    .orderBy(desc(leftoverItems.cookedDate))
    .all();
}

export function storePortion(
  recipeName: string,
  cookedDate: IsoDate,
  storage: Storage,
) {
  db.insert(leftoverItems)
    .values({ recipeName, cookedDate, storage, portions: 1 })
    .run();
  return listLeftovers();
}

/** Decrements a stored portion; rows reaching zero are removed. */
export function eatPortion(id: number) {
  const row = db.query.leftoverItems
    .findFirst({ where: eq(leftoverItems.id, id) })
    .sync();
  if (!row) return listLeftovers();

  if (row.portions <= 1) {
    db.delete(leftoverItems).where(eq(leftoverItems.id, id)).run();
  } else {
    db.update(leftoverItems)
      .set({ portions: row.portions - 1 })
      .where(eq(leftoverItems.id, id))
      .run();
  }
  return listLeftovers();
}

export function discardLeftover(id: number) {
  db.delete(leftoverItems).where(eq(leftoverItems.id, id)).run();
  return listLeftovers();
}

// ---------------------------------------------------------------------------
// Plan slots
// ---------------------------------------------------------------------------

export function getWeekSlots(weekStart: IsoDate): PlanSlot[] {
  const weekEnd = addDays(weekStart, 7);
  return db
    .select()
    .from(planSlots)
    .where(and(gte(planSlots.date, weekStart), lt(planSlots.date, weekEnd)))
    .orderBy(planSlots.date)
    .all()
    .map((row) => ({
      id: row.id,
      date: row.date,
      meal: row.meal,
      mealSource: row.mealSource,
      recipeId: row.recipeId,
    }));
}

/**
 * Whether a week has actually been planned, which gates the scheduler's
 * idempotency check.
 *
 * "Planned" means at least one slot holds a recipe — not merely that a row
 * exists. Rows are created by things other than the scheduler: overriding one
 * day's role from Today writes a single slot with no recipe, and under the old
 * `length > 0` test that lone row made the whole week look planned, so
 * "Generate week now" skipped and left six empty days. Keying on an assigned
 * recipe keeps regeneration idempotent while letting a hand-set role through.
 */
export function weekIsPlanned(weekStart: IsoDate): boolean {
  return getWeekSlots(weekStart).some((slot) => slot.recipeId !== null);
}

/**
 * Writes a planned week.
 *
 * `onConflictDoUpdate` on the unique (date, meal) index is what makes
 * regeneration idempotent: re-running over an existing week updates in place
 * rather than erroring or duplicating.
 */
export function writeSlots(
  slots: readonly SlotPlan[],
  overwriteAssigned: boolean,
): number {
  let written = 0;
  for (const slot of slots) {
    const existing = db.query.planSlots
      .findFirst({
        where: and(
          eq(planSlots.date, slot.date),
          eq(planSlots.meal, slot.meal),
        ),
      })
      .sync();

    // A slot the user has already filled by hand is left alone unless the
    // caller explicitly asked to force-regenerate.
    if (existing && existing.recipeId !== null && !overwriteAssigned) continue;

    db.insert(planSlots)
      .values({
        date: slot.date,
        meal: slot.meal,
        mealSource: slot.mealSource,
        recipeId: slot.recipeId,
      })
      .onConflictDoUpdate({
        target: [planSlots.date, planSlots.meal],
        set: { mealSource: slot.mealSource, recipeId: slot.recipeId },
      })
      .run();
    written += 1;
  }
  return written;
}

export function assignSlot(
  date: IsoDate,
  meal: string,
  recipeId: number | null,
): PlanSlot[] {
  db.update(planSlots)
    .set({ recipeId })
    .where(and(eq(planSlots.date, date), eq(planSlots.meal, meal)))
    .run();
  return getWeekSlots(date);
}

/**
 * Sets a day's role, creating the slot if the scheduler has not been here yet.
 *
 * This has to be an upsert, not an update. Before a week is generated there is
 * no `plan_slots` row for the date, so a bare UPDATE matched nothing, the
 * mutation still reported success, and `plan.today` went back to the role it
 * derives from the profile — the dropdown snapped back to its old value with no
 * error anywhere. `assign` already worked around this by writing the slot first;
 * doing it in one statement means the next caller cannot forget.
 */
export function setSlotMealSource(
  date: IsoDate,
  meal: string,
  mealSource: MealSource,
): void {
  db.insert(planSlots)
    .values({ date, meal, mealSource, recipeId: null })
    .onConflictDoUpdate({
      target: [planSlots.date, planSlots.meal],
      // A leftover day eats yesterday's portion and an eat-out day eats
      // elsewhere — neither keeps a recipe.
      set: {
        mealSource,
        ...(mealSource === "leftover" || mealSource === "eat_out"
          ? { recipeId: null }
          : {}),
      },
    })
    .run();
}

export function getSlot(date: IsoDate, meal: string): PlanSlot | null {
  const row = db.query.planSlots
    .findFirst({
      where: and(eq(planSlots.date, date), eq(planSlots.meal, meal)),
    })
    .sync();
  return row
    ? {
        id: row.id,
        date: row.date,
        meal: row.meal,
        mealSource: row.mealSource,
        recipeId: row.recipeId,
      }
    : null;
}

/**
 * Recipe ids scheduled within `weeks` before `weekStart`.
 *
 * Past plan slots are never deleted precisely so this query can exist — the
 * plan history is what makes repeat-avoidance possible.
 */
export function recentRecipeIds(
  weekStart: IsoDate,
  weeks: number,
): Set<number> {
  if (weeks <= 0) return new Set();
  const windowStart = addDays(weekStart, -7 * weeks);

  const rows = db
    .select({ recipeId: planSlots.recipeId })
    .from(planSlots)
    .where(and(gte(planSlots.date, windowStart), lt(planSlots.date, weekStart)))
    .all();

  return new Set(
    rows.map((r) => r.recipeId).filter((id): id is number => id !== null),
  );
}

/** The week's slots joined to their recipes, in the shape the grocery list wants. */
export function getWeekMeals(
  weekStart: IsoDate,
  /** Restricts to these meals; omit for every slot in the week. */
  plannedMeals?: readonly string[],
): PlannedMeal[] {
  const byId = recipesById();
  const wanted = plannedMeals ? new Set(plannedMeals) : null;
  return getWeekSlots(weekStart)
    .filter((slot) => wanted === null || wanted.has(slot.meal))
    .map((slot) => ({
      mealSource: slot.mealSource,
      recipe: slot.recipeId !== null ? (byId.get(slot.recipeId) ?? null) : null,
    }));
}

// ---------------------------------------------------------------------------
// Grocery check state
// ---------------------------------------------------------------------------

export function checkedLineKeys(weekStart: IsoDate): Set<string> {
  const rows = db
    .select()
    .from(groceryChecks)
    .where(
      and(
        eq(groceryChecks.weekStart, weekStart),
        eq(groceryChecks.checked, true),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.lineKey));
}

export function setLineChecked(
  weekStart: IsoDate,
  key: string,
  checked: boolean,
): void {
  db.insert(groceryChecks)
    .values({ weekStart, lineKey: key, checked })
    .onConflictDoUpdate({
      target: [groceryChecks.weekStart, groceryChecks.lineKey],
      set: { checked },
    })
    .run();
}

export function clearChecks(weekStart: IsoDate): void {
  db.delete(groceryChecks).where(eq(groceryChecks.weekStart, weekStart)).run();
}

// ---------------------------------------------------------------------------
// Scheduler runs
// ---------------------------------------------------------------------------

export function recordSchedulerRun(
  run: Omit<SchedulerRun, "id" | "startedAt">,
): void {
  db.insert(schedulerRuns)
    .values({
      weekStart: run.weekStart,
      mode: run.mode,
      fellBack: run.fellBack,
      status: run.status,
      slotsCreated: run.slotsCreated,
      aiRecipesCreated: run.aiRecipesCreated,
      message: run.message,
      finishedAt: run.finishedAt,
      verifierVerdicts: run.verifierVerdicts,
    })
    .run();
}

export function latestSchedulerRuns(limit = 10): SchedulerRun[] {
  return db
    .select()
    .from(schedulerRuns)
    .orderBy(desc(schedulerRuns.id))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      weekStart: row.weekStart,
      mode: row.mode,
      fellBack: row.fellBack,
      status: row.status,
      slotsCreated: row.slotsCreated,
      aiRecipesCreated: row.aiRecipesCreated,
      message: row.message,
      verifierVerdicts: row.verifierVerdicts,
    }));
}

// ---------------------------------------------------------------------------
// Generation feedback
// ---------------------------------------------------------------------------

export function addFeedback(
  recipeId: number,
  verdict: "accepted" | "rejected",
  reason: string,
) {
  db.insert(generationFeedback).values({ recipeId, verdict, reason }).run();
  return listFeedback(recipeId);
}

export function listFeedback(recipeId?: number) {
  const query = db
    .select()
    .from(generationFeedback)
    .orderBy(desc(generationFeedback.id));
  const rows = recipeId
    ? query.where(eq(generationFeedback.recipeId, recipeId)).all()
    : query.all();
  return rows.map((row) => ({
    id: row.id,
    recipeId: row.recipeId,
    verdict: row.verdict,
    reason: row.reason,
    createdAt: row.createdAt,
    promotedToFixture: row.promotedToFixture,
  }));
}

export function markPromoted(feedbackId: number): void {
  db.update(generationFeedback)
    .set({ promotedToFixture: true })
    .where(eq(generationFeedback.id, feedbackId))
    .run();
}

export function getFeedback(feedbackId: number) {
  const row = db.query.generationFeedback
    .findFirst({ where: eq(generationFeedback.id, feedbackId) })
    .sync();
  return row ?? null;
}

/** Plan slots on or before `date` — used to find yesterday's cook day. */
export function slotsBefore(date: IsoDate, days: number): PlanSlot[] {
  const start = addDays(date, -days);
  return db
    .select()
    .from(planSlots)
    .where(and(gte(planSlots.date, start), lte(planSlots.date, date)))
    .orderBy(planSlots.date)
    .all()
    .map((row) => ({
      id: row.id,
      date: row.date,
      meal: row.meal,
      mealSource: row.mealSource,
      recipeId: row.recipeId,
    }));
}

/** Tags some active cap applies to — what the UI badges. */
export function flaggedTags(): string[] {
  return cappedTags(getDietaryConfig());
}

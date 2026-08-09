import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, mockAuth, type Harness } from "../helpers/harness";

mockAuth();

/**
 * The plan-slot write path.
 *
 * Every test here corresponds to a bug that shipped. They share one shape: a
 * write that matched zero rows, returned successfully, and left the reader
 * showing the old value. Nothing threw, so nothing pure could have caught it —
 * only writing and then reading back does.
 */

let h: Harness;

// One database for the file, truncated and re-seeded between tests. See the
// harness for why a database per test does not work.
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.cleanup());

const DATE = "2026-03-02";
const MEAL = "Dinner";

describe("setSlotMealSource", () => {
  it("creates the slot when the scheduler has not run yet", () => {
    // The original bug: a bare UPDATE before any week was generated matched
    // nothing, reported success, and the day role snapped back on refetch.
    expect(h.db.getSlot(DATE, MEAL)).toBeNull();

    h.db.setSlotMealSource(DATE, MEAL, "cook");

    expect(h.db.getSlot(DATE, MEAL)?.mealSource).toBe("cook");
  });

  it("updates in place rather than duplicating", () => {
    h.db.setSlotMealSource(DATE, MEAL, "cook");
    h.db.setSlotMealSource(DATE, MEAL, "quick");

    expect(h.db.getSlot(DATE, MEAL)?.mealSource).toBe("quick");
    expect(h.db.getWeekSlots("2026-03-01").filter((s) => s.date === DATE)).toHaveLength(1);
  });

  it("clears the recipe when a day becomes a leftover day", () => {
    // A leftover day eats yesterday's portion, so keeping a recipe on it would
    // put food on the grocery list for a meal nobody cooks.
    const recipe = h.db.listRecipes()[0]!;
    h.db.setSlotMealSource(DATE, MEAL, "cook");
    h.db.assignSlot(DATE, MEAL, recipe.id);
    expect(h.db.getSlot(DATE, MEAL)?.recipeId).toBe(recipe.id);

    h.db.setSlotMealSource(DATE, MEAL, "leftover");

    expect(h.db.getSlot(DATE, MEAL)?.recipeId).toBeNull();
  });

  it("keeps meals on the same day independent", () => {
    // The (date, meal) key. Keyed on date alone, the second write would have
    // overwritten the first and one meal would silently vanish.
    h.db.setSlotMealSource(DATE, "Breakfast", "quick");
    h.db.setSlotMealSource(DATE, "Dinner", "cook");

    expect(h.db.getSlot(DATE, "Breakfast")?.mealSource).toBe("quick");
    expect(h.db.getSlot(DATE, "Dinner")?.mealSource).toBe("cook");
  });
});

describe("weekIsPlanned", () => {
  it("is false when a slot exists but holds no recipe", () => {
    // The bug this replaced: `length > 0` meant one hand-set day role made the
    // whole week look planned, so "Generate week now" skipped and left six
    // empty days.
    h.db.setSlotMealSource(DATE, MEAL, "cook");

    expect(h.db.weekIsPlanned("2026-03-01")).toBe(false);
  });

  it("is true once any slot holds a recipe", () => {
    const recipe = h.db.listRecipes()[0]!;
    h.db.setSlotMealSource(DATE, MEAL, "cook");
    h.db.assignSlot(DATE, MEAL, recipe.id);

    expect(h.db.weekIsPlanned("2026-03-01")).toBe(true);
  });
});

describe("getWeekMeals", () => {
  it("returns only the meals asked for", () => {
    // Un-planning a meal must not leave its food on the grocery list.
    const recipe = h.db.listRecipes().find((r) => r.mealType === "cook")!;
    h.db.setSlotMealSource(DATE, "Breakfast", "quick");
    h.db.setSlotMealSource(DATE, "Dinner", "cook");
    h.db.assignSlot(DATE, "Dinner", recipe.id);
    h.db.assignSlot(DATE, "Breakfast", recipe.id);

    const dinnerOnly = h.db.getWeekMeals("2026-03-01", ["Dinner"]);
    const both = h.db.getWeekMeals("2026-03-01", ["Breakfast", "Dinner"]);

    expect(dinnerOnly).toHaveLength(1);
    expect(both).toHaveLength(2);
  });

  it("returns every slot when no filter is given", () => {
    h.db.setSlotMealSource(DATE, "Breakfast", "quick");
    h.db.setSlotMealSource(DATE, "Dinner", "cook");

    expect(h.db.getWeekMeals("2026-03-01")).toHaveLength(2);
  });
});

describe("writeSlots", () => {
  it("leaves a hand-assigned slot alone unless forced", () => {
    const [a, b] = h.db.listRecipes().filter((r) => r.mealType === "cook");
    h.db.setSlotMealSource(DATE, MEAL, "cook");
    h.db.assignSlot(DATE, MEAL, a!.id);

    h.db.writeSlots([{ date: DATE, meal: MEAL, mealSource: "cook", recipeId: b!.id }], false);
    expect(h.db.getSlot(DATE, MEAL)?.recipeId).toBe(a!.id);

    h.db.writeSlots([{ date: DATE, meal: MEAL, mealSource: "cook", recipeId: b!.id }], true);
    expect(h.db.getSlot(DATE, MEAL)?.recipeId).toBe(b!.id);
  });
});

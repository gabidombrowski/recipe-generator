import { describe, expect, it } from "vitest";
import {
  addMeal,
  reconcile,
  removeMeal,
  togglePlanned,
  type MealConfig,
} from "./meal-config";

/**
 * The invariants nothing downstream re-checks.
 *
 * A `mainMeal` that is not in `plannedMeals`, or a planned meal that is not in
 * `meals`, produces no error anywhere — the scheduler looks it up, gets
 * nothing, and plans a week with a hole in it.
 */

const base = {
  meals: ["Breakfast", "Lunch", "Dinner"],
  plannedMeals: ["Dinner"],
  mainMeal: "Dinner",
};

describe("removeMeal", () => {
  it("prunes the removed meal from the planned list", () => {
    const next = removeMeal(
      { ...base, plannedMeals: ["Lunch", "Dinner"] },
      "Lunch",
    );
    expect(next.meals).toEqual(["Breakfast", "Dinner"]);
    expect(next.plannedMeals).toEqual(["Dinner"]);
  });

  it("reassigns the main meal when the main meal is removed", () => {
    // Otherwise the cook cycle points at a meal that no longer exists and the
    // week silently loses its cook days.
    const next = removeMeal(
      { ...base, plannedMeals: ["Lunch", "Dinner"] },
      "Dinner",
    );
    expect(next.mainMeal).toBe("Lunch");
  });

  it("leaves the main meal empty only when nothing is left to plan", () => {
    const next = removeMeal(base, "Dinner");
    expect(next.plannedMeals).toEqual([]);
    expect(next.mainMeal).toBe("");
  });
});

describe("togglePlanned", () => {
  it("adds and removes", () => {
    const on = togglePlanned(base, "Breakfast");
    expect(on.plannedMeals).toEqual(["Breakfast", "Dinner"]);
    expect(togglePlanned(on, "Breakfast").plannedMeals).toEqual(["Dinner"]);
  });

  it("keeps planned meals in day order, not tick order", () => {
    // Ticked dinner-then-breakfast, but a day reads breakfast first.
    const next = togglePlanned(
      togglePlanned({ ...base, plannedMeals: [] }, "Dinner"),
      "Breakfast",
    );
    expect(next.plannedMeals).toEqual(["Breakfast", "Dinner"]);
  });

  it("moves the main meal when the current one is unplanned", () => {
    const next = togglePlanned(
      { ...base, plannedMeals: ["Breakfast", "Dinner"] },
      "Dinner",
    );
    expect(next.plannedMeals).toEqual(["Breakfast"]);
    expect(next.mainMeal).toBe("Breakfast");
  });
});

describe("addMeal", () => {
  it("appends a new meal", () => {
    expect(addMeal(base, "Snack").meals).toEqual([
      "Breakfast",
      "Lunch",
      "Dinner",
      "Snack",
    ]);
  });

  it("ignores a duplicate regardless of case", () => {
    // A second "dinner" would show twice in every picker and divide the day's
    // targets by one meal too many.
    expect(addMeal(base, "dinner").meals).toEqual(base.meals);
    expect(addMeal(base, "  ").meals).toEqual(base.meals);
  });
});

describe("reconcile", () => {
  it("drops planned meals that are not meals", () => {
    const next = reconcile({ ...base, plannedMeals: ["Dinner", "Brunch"] });
    expect(next.plannedMeals).toEqual(["Dinner"]);
  });

  it("repairs a main meal that is not planned", () => {
    const next = reconcile({ ...base, mainMeal: "Breakfast" });
    expect(next.mainMeal).toBe("Dinner");
  });

  it("is idempotent", () => {
    const once = reconcile({
      ...base,
      plannedMeals: ["Brunch"],
      mainMeal: "Nope",
    });
    expect(reconcile(once)).toEqual(once);
  });
});

/**
 * The wizard failed at its final step for someone who had simply left the
 * meals question alone. These pin the cause: the config helpers were happy to
 * produce a state the schema refuses, and the refusal surfaced five steps
 * later as a raw validation message.
 */
describe("the last planned meal", () => {
  it("cannot be unticked", () => {
    const one: MealConfig = {
      meals: ["Breakfast", "Lunch"],
      plannedMeals: ["Lunch"],
      mainMeal: "Lunch",
    };

    // Targets are divided across planned meals and the cook cycle hangs off the
    // main one, so zero planned meals is not a state the app can represent.
    expect(togglePlanned(one, "Lunch")).toEqual(one);
  });

  it("cannot be removed as the last meal", () => {
    const one: MealConfig = {
      meals: ["Lunch"],
      plannedMeals: ["Lunch"],
      mainMeal: "Lunch",
    };

    expect(removeMeal(one, "Lunch")).toEqual(one);
  });

  it("still allows unticking down to one", () => {
    const two: MealConfig = {
      meals: ["Lunch", "Dinner"],
      plannedMeals: ["Lunch", "Dinner"],
      mainMeal: "Dinner",
    };

    const after = togglePlanned(two, "Lunch");
    expect(after.plannedMeals).toEqual(["Dinner"]);
    expect(after.mainMeal).toBe("Dinner");
  });
});

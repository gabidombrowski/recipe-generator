import { describe, expect, it } from "vitest";
import { planWeekDeterministically } from "./deterministic";
import { verifyWeek } from "./rules";
import { EMPTY_CONFIG, resolveConfig, type Constraint } from "~/lib/constraints";

import { DEFAULT_SETTINGS, type Profile, type Recipe, type Settings } from "~/lib/schemas";

/** Synthetic — see `src/lib/macros.test.ts` for why fixtures carry no real metrics. */
const profile: Profile = {
  weightKg: 70,
  heightCm: 170,
  age: 30,
  sex: "female",
  activityFactor: 1.5,
  deficitKcal: 400,
  proteinPerKg: 2.2,
  fatPerKg: 0.9,
  trainingDays: ["Sunday", "Tuesday", "Thursday"],
  cookDays: ["Tuesday", "Thursday"],
  assemblyDays: ["Sunday", "Monday", "Saturday"],
};

const settings: Settings = { ...DEFAULT_SETTINGS, repeatWindowWeeks: 2 };
const WEEK_START = "2026-02-08";

function make(
  id: number,
  mealType: Recipe["mealType"],
  overrides: Partial<Recipe> = {},
): Recipe {
  const servings = mealType === "cook" ? 2 : 1;
  return {
    id,
    name: `${mealType} ${id}`,
    cuisine: "Test",
    cookMinutes: mealType === "cook" ? 20 : 8,
    servings,
    mealType,
    ingredients: [{ name: `ingredient-${id}`, qty: 1, unit: "each", tags: [] }],
    steps: ["do it"],
    macrosPerServing: { kcal: 500, proteinG: 42, carbsG: 45, fatG: 15 },
    favorite: false,
    tagCounts: {},
    source: "seed",
    promptHash: null,
    modelString: null,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

/** A library with enough of each type that the strict pass can succeed. */
const library: Recipe[] = [
  ...Array.from({ length: 5 }, (_, i) => make(i + 1, "cook")),
  ...Array.from({ length: 5 }, (_, i) => make(i + 11, "quick")),
  ...Array.from({ length: 5 }, (_, i) => make(i + 21, "assembly")),
];

const base = {
  weekStart: WEEK_START,
  profile,
  settings,
  recipes: library,
  excludedLower: [] as string[],
  recentRecipeIds: new Set<number>(),
  config: EMPTY_CONFIG,
};

describe("deterministic planner", () => {
  it("produces a week that its own verifier accepts", () => {
    // The tightest test available: planner and verifier share rule definitions,
    // so a plan that fails verification is a genuine contradiction.
    const plan = planWeekDeterministically(base);
    const verdict = verifyWeek({
      weekStart: WEEK_START,
      slots: plan.slots,
      profile,
      settings,
      recipesById: new Map(library.map((r) => [r.id, r])),
      excludedLower: [],
      recentRecipeIds: new Set(),
      config: EMPTY_CONFIG,
    });
    expect(verdict.reasons).toEqual([]);
  });

  it("is reproducible for the same week", () => {
    const a = planWeekDeterministically(base);
    const b = planWeekDeterministically(base);
    expect(a.slots).toEqual(b.slots);
  });

  it("plans different weeks differently", () => {
    const a = planWeekDeterministically(base);
    const b = planWeekDeterministically({ ...base, weekStart: "2026-02-15" });
    expect(a.slots.map((s) => s.recipeId)).not.toEqual(b.slots.map((s) => s.recipeId));
  });

  it("leaves leftover days unassigned", () => {
    const plan = planWeekDeterministically(base);
    for (const slot of plan.slots.filter((s) => s.mealSource === "leftover")) {
      expect(slot.recipeId).toBeNull();
    }
  });

  it("never schedules an excluded recipe, even when that leaves slots unfilled", () => {
    // Exclusions are the one constraint the relaxation ladder never bends.
    const plan = planWeekDeterministically({
      ...base,
      excludedLower: ["ingredient-1", "ingredient-2", "ingredient-3", "ingredient-4", "ingredient-5"],
    });
    const cookSlots = plan.slots.filter((s) => s.mealSource === "cook");
    expect(cookSlots.every((s) => s.recipeId === null)).toBe(true);
    expect(plan.unfilled.length).toBeGreaterThan(0);
  });

  it("respects the repeat window when it can", () => {
    const recent = new Set([1, 2, 3]);
    const plan = planWeekDeterministically({ ...base, recentRecipeIds: recent });
    const cookIds = plan.slots
      .filter((s) => s.mealSource === "cook")
      .map((s) => s.recipeId);
    expect(cookIds.some((id) => id !== null && recent.has(id))).toBe(false);
    expect(plan.relaxations).toEqual([]);
  });

  it("relaxes the repeat window rather than leaving a slot empty, and says so", () => {
    // Only two cook recipes exist and both were used recently: the week still
    // gets filled, but the relaxation is recorded rather than hidden.
    const tiny = [make(1, "cook"), make(2, "cook"), ...library.filter((r) => r.mealType !== "cook")];
    const plan = planWeekDeterministically({
      ...base,
      recipes: tiny,
      recentRecipeIds: new Set([1, 2]),
    });
    const cookSlots = plan.slots.filter((s) => s.mealSource === "cook");
    expect(cookSlots.every((s) => s.recipeId !== null)).toBe(true);
    expect(plan.relaxations.join(" ")).toContain("repeat window");
  });

  it("honours a per-week tag cap from the user's guidelines", () => {
    const tagged = [
      make(1, "cook", { tagCounts: { fermented: 1 } }),
      make(2, "cook", { tagCounts: { fermented: 1 } }),
      make(3, "cook"),
      ...library.filter((r) => r.mealType !== "cook"),
    ];
    const config = resolveConfig([
      {
        id: 1,
        constraint: { kind: "tag_cap", tag: "fermented", maxPerRecipe: 1, maxPerWeek: 1 } as Constraint,
        active: true,
        createdAt: "2026-01-01",
      },
    ]);
    const plan = planWeekDeterministically({ ...base, recipes: tagged, config });
    const byId = new Map(tagged.map((r) => [r.id, r]));
    const taggedCooks = plan.slots.filter(
      (s) =>
        s.mealSource === "cook" &&
        s.recipeId !== null &&
        (byId.get(s.recipeId)!.tagCounts.fermented ?? 0) > 0,
    );
    expect(taggedCooks.length).toBeLessThanOrEqual(1);
  });

  it("never repeats a recipe within one week", () => {
    const plan = planWeekDeterministically(base);
    const assigned = plan.slots.map((s) => s.recipeId).filter((id): id is number => id !== null);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("weights favourites toward selection", () => {
    // Over many weeks a favourite should be picked more often than a peer.
    const withFavorite = library.map((r) => (r.id === 1 ? { ...r, favorite: true } : r));
    let favoriteCount = 0;
    let peerCount = 0;

    for (let week = 0; week < 40; week += 1) {
      const plan = planWeekDeterministically({
        ...base,
        recipes: withFavorite,
        weekStart: `2026-02-${String(8 + (week % 20)).padStart(2, "0")}`,
      });
      const ids = plan.slots.map((s) => s.recipeId);
      if (ids.includes(1)) favoriteCount += 1;
      if (ids.includes(2)) peerCount += 1;
    }

    expect(favoriteCount).toBeGreaterThan(peerCount);
  });
});

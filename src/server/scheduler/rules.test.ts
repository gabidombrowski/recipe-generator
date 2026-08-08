import { describe, expect, it } from "vitest";
import { deriveSlotRoles, verifyWeek, type SlotPlan } from "./rules";
import { EMPTY_CONFIG, resolveConfig, type Constraint } from "~/lib/constraints";

import {
  DEFAULT_SETTINGS,
  type Profile,
  type Recipe,
  type Settings,
} from "~/lib/schemas";

/**
 * The rules are the contract between the deterministic planner and the
 * verifier, so they get tested directly rather than through either consumer.
 */

/**
 * Synthetic, like every fixture in this repo — see `src/lib/macros.test.ts`.
 * The day pattern is chosen to exercise the rules: two cook days (so leftover
 * adjacency is covered) and three assembly days (an odd count, so the
 * assembly/quick alternation is covered).
 */
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

// 2026-02-08 is a Sunday.
const WEEK_START = "2026-02-08";

function recipe(overrides: Partial<Recipe> & { id: number; name: string }): Recipe {
  return {
    cuisine: "Test",
    cookMinutes: 20,
    servings: 2,
    mealType: "cook",
    ingredients: [{ name: "chicken", qty: 12, unit: "oz", tags: [] }],
    steps: ["cook it"],
    macrosPerServing: { kcal: 500, proteinG: 45, carbsG: 40, fatG: 15 },
    favorite: false,
    tagCounts: {},
    source: "seed",
    promptHash: null,
    modelString: null,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("deriveSlotRoles", () => {
  const roles = deriveSlotRoles(WEEK_START, profile);

  it("produces one slot per day", () => {
    expect(roles).toHaveLength(7);
    expect(roles[0]?.date).toBe(WEEK_START);
  });

  it("marks configured cook days as cook", () => {
    expect(roles.find((r) => r.date === "2026-02-10")?.mealSource).toBe("cook"); // Tue
    expect(roles.find((r) => r.date === "2026-02-12")?.mealSource).toBe("cook"); // Thu
  });

  it("marks the day after each cook day as leftover", () => {
    expect(roles.find((r) => r.date === "2026-02-11")?.mealSource).toBe("leftover"); // Wed
    expect(roles.find((r) => r.date === "2026-02-13")?.mealSource).toBe("leftover"); // Fri
  });

  it("alternates assembly and quick across assembly days", () => {
    // Assembly days in week order: Sunday, Monday, Saturday.
    expect(roles.find((r) => r.date === "2026-02-08")?.mealSource).toBe("assembly");
    expect(roles.find((r) => r.date === "2026-02-09")?.mealSource).toBe("quick");
    expect(roles.find((r) => r.date === "2026-02-14")?.mealSource).toBe("assembly");
  });

  it("lets cook win over leftover on back-to-back cook days", () => {
    const backToBack = { ...profile, cookDays: ["Tuesday", "Wednesday"] as const };
    const result = deriveSlotRoles(WEEK_START, backToBack as unknown as Profile);
    expect(result.find((r) => r.date === "2026-02-11")?.mealSource).toBe("cook");
  });

  it("changes shape when the settings change, rather than being hardcoded", () => {
    const shifted = deriveSlotRoles(WEEK_START, {
      ...profile,
      cookDays: ["Monday"],
      assemblyDays: [],
    });
    expect(shifted.find((r) => r.date === "2026-02-09")?.mealSource).toBe("cook");
    expect(shifted.find((r) => r.date === "2026-02-10")?.mealSource).toBe("leftover");
  });
});

describe("verifyWeek", () => {
  const cookA = recipe({ id: 1, name: "Cook A" });
  const cookB = recipe({ id: 2, name: "Cook B" });
  const quick = recipe({
    id: 3,
    name: "Quick",
    mealType: "quick",
    servings: 1,
    macrosPerServing: { kcal: 450, proteinG: 36, carbsG: 40, fatG: 14 },
  });
  const assembly = recipe({
    id: 4,
    name: "Assembly",
    mealType: "assembly",
    servings: 1,
    macrosPerServing: { kcal: 420, proteinG: 38, carbsG: 40, fatG: 10 },
  });

  const recipesById = new Map([cookA, cookB, quick, assembly].map((r) => [r.id, r]));

  const validWeek: SlotPlan[] = [
    { date: "2026-02-08", mealSource: "assembly", recipeId: 4 },
    { date: "2026-02-09", mealSource: "quick", recipeId: 3 },
    { date: "2026-02-10", mealSource: "cook", recipeId: 1 },
    { date: "2026-02-11", mealSource: "leftover", recipeId: null },
    { date: "2026-02-12", mealSource: "cook", recipeId: 2 },
    { date: "2026-02-13", mealSource: "leftover", recipeId: null },
    { date: "2026-02-14", mealSource: "assembly", recipeId: null },
  ];

  /** The user rule that replaces what used to be a hardcoded setting. */
  const oneFermentedCookPerWeek = resolveConfig([
    {
      id: 1,
      constraint: { kind: "tag_cap", tag: "fermented", maxPerRecipe: 1, maxPerWeek: 1 } as Constraint,
      active: true,
      createdAt: "2026-01-01",
    },
  ]);

  const base = {
    weekStart: WEEK_START,
    profile,
    settings,
    recipesById,
    excludedLower: [] as string[],
    recentRecipeIds: new Set<number>(),
    config: EMPTY_CONFIG,
  };

  it("accepts a week that satisfies every rule", () => {
    const result = verifyWeek({ ...base, slots: validWeek });
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a slot whose role contradicts the settings", () => {
    const slots = validWeek.map((s) =>
      s.date === "2026-02-10" ? { ...s, mealSource: "quick" as const } : s,
    );
    const result = verifyWeek({ ...base, slots });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("should be a cook day");
  });

  it("rejects a recipe assigned to a leftover day", () => {
    const slots = validWeek.map((s) =>
      s.date === "2026-02-11" ? { ...s, recipeId: 1 } : s,
    );
    expect(verifyWeek({ ...base, slots }).reasons.join(" ")).toContain(
      "must not have a recipe",
    );
  });

  it("rejects a meal type that cannot fill the slot", () => {
    const slots = validWeek.map((s) =>
      s.date === "2026-02-10" ? { ...s, recipeId: 3 } : s,
    );
    expect(verifyWeek({ ...base, slots }).reasons.join(" ")).toContain(
      "is a quick recipe",
    );
  });

  it("rejects an excluded ingredient", () => {
    const result = verifyWeek({ ...base, slots: validWeek, excludedLower: ["chicken"] });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("excluded ingredient");
  });

  it("rejects a recipe used inside the repeat window", () => {
    const result = verifyWeek({
      ...base,
      slots: validWeek,
      recentRecipeIds: new Set([1]),
    });
    expect(result.reasons.join(" ")).toContain("already used within the last 2 week");
  });

  it("rejects a repeat inside the same week", () => {
    const slots = validWeek.map((s) =>
      s.date === "2026-02-12" ? { ...s, recipeId: 1 } : s,
    );
    expect(verifyWeek({ ...base, slots }).reasons.join(" ")).toContain(
      "appears more than once",
    );
  });

  it("enforces a per-week tag cap from the user's guidelines", () => {
    const taggedById = new Map(recipesById);
    taggedById.set(1, { ...cookA, tagCounts: { fermented: 1 } });
    taggedById.set(2, { ...cookB, tagCounts: { fermented: 1 } });

    const result = verifyWeek({
      ...base,
      slots: validWeek,
      recipesById: taggedById,
      config: oneFermentedCookPerWeek,
    });
    expect(result.reasons.join(" ")).toContain('cook recipes contain "fermented"');
  });

  it("allows both when no guideline caps that tag", () => {
    const taggedById = new Map(recipesById);
    taggedById.set(1, { ...cookA, tagCounts: { fermented: 1 } });
    taggedById.set(2, { ...cookB, tagCounts: { fermented: 1 } });

    const result = verifyWeek({
      ...base,
      slots: validWeek,
      recipesById: taggedById,
      config: EMPTY_CONFIG,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a meal below the user's protein floor", () => {
    const thinById = new Map(recipesById);
    thinById.set(1, {
      ...cookA,
      macrosPerServing: { kcal: 120, proteinG: 8, carbsG: 10, fatG: 4 },
    });
    const withBand = resolveConfig([
      {
        id: 1,
        constraint: { kind: "meal_macros", proteinMinG: 25, proteinMaxG: 60 } as Constraint,
        active: true,
        createdAt: "2026-01-01",
      },
    ]);
    const result = verifyWeek({ ...base, slots: validWeek, recipesById: thinById, config: withBand });
    expect(result.reasons.join(" ")).toContain("below the 25 g per-meal floor");
  });

  it("applies no protein floor when the user has configured none", () => {
    // An unopinionated install should not invent a rule nobody asked for.
    const thinById = new Map(recipesById);
    thinById.set(1, {
      ...cookA,
      macrosPerServing: { kcal: 400, proteinG: 8, carbsG: 60, fatG: 12 },
    });
    const result = verifyWeek({ ...base, slots: validWeek, recipesById: thinById });
    expect(result.reasons.join(" ")).not.toContain("per-meal floor");
  });

  it("reports every violation at once, not just the first", () => {
    const slots = validWeek.map((s) =>
      s.date === "2026-02-10" ? { ...s, mealSource: "quick" as const, recipeId: 1 } : s,
    );
    const result = verifyWeek({
      ...base,
      slots,
      excludedLower: ["chicken"],
      recentRecipeIds: new Set([2]),
    });
    // Feeding back one reason at a time would cost a round trip each.
    expect(result.reasons.length).toBeGreaterThan(2);
  });

  it("rejects a week that is not seven slots", () => {
    const result = verifyWeek({ ...base, slots: validWeek.slice(0, 5) });
    expect(result.reasons.join(" ")).toContain("expected 7 slots");
  });

  it("rejects an unknown recipe id", () => {
    const slots = validWeek.map((s) =>
      s.date === "2026-02-10" ? { ...s, recipeId: 999 } : s,
    );
    expect(verifyWeek({ ...base, slots }).reasons.join(" ")).toContain("unknown recipe id");
  });
});

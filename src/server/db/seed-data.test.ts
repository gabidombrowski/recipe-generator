import { describe, expect, it } from "vitest";
import { SEED_RECIPES } from "./seed-data";
import { DEFAULT_CUISINES } from "~/lib/schemas";

/**
 * The seed library, checked against the rules the rest of the app enforces.
 *
 * These exist because the seed recipes and `DEFAULT_CUISINES` were written at
 * different times with nothing tying them together, and quietly drifted: the
 * palette offered 22 cuisines, the library covered 6 of them, and three recipes
 * carried cuisines the palette had never heard of. Nothing failed — the Library
 * filter just listed cuisines with no recipes behind them.
 *
 * A test is the only thing that keeps two lists in agreement when they live in
 * different files.
 */
describe("seed cuisine coverage", () => {
  it("has at least one recipe for every default cuisine", () => {
    const covered = new Set(SEED_RECIPES.map((r) => r.cuisine));
    const missing = DEFAULT_CUISINES.filter((c) => !covered.has(c));
    expect(missing, `no seed recipe for: ${missing.join(", ")}`).toEqual([]);
  });

  it("uses no cuisine outside the palette, apart from the deliberate 'Any'", () => {
    // "Any" is for dishes that genuinely belong to no tradition — a protein
    // shake, a shop-bought chicken bowl. Anything else naming a cuisine the
    // picker does not offer is a typo or a drifted label.
    const offPalette = [...new Set(SEED_RECIPES.map((r) => r.cuisine))]
      .filter((c) => c !== "Any")
      .filter((c) => !DEFAULT_CUISINES.includes(c as (typeof DEFAULT_CUISINES)[number]));
    expect(offPalette).toEqual([]);
  });

  it("spreads across meal types so a week can actually be filled", () => {
    // Cook slots accept only cook recipes, and the planner will not repeat a
    // dish inside a week — so a library that is all assembly cannot fill a
    // single cook day, however many recipes it holds.
    const byType = SEED_RECIPES.reduce<Record<string, number>>((acc, r) => {
      acc[r.mealType] = (acc[r.mealType] ?? 0) + 1;
      return acc;
    }, {});

    // Three cook days a week against a two-week repeat window needs six.
    expect(byType.cook ?? 0).toBeGreaterThanOrEqual(6);
    expect(byType.quick ?? 0).toBeGreaterThanOrEqual(4);
    expect(byType.assembly ?? 0).toBeGreaterThanOrEqual(4);
  });
});

describe("seed recipe shape", () => {
  it("states calories that agree with its own macros", () => {
    // The same 4/4/9 check the eval suite applies to generated recipes. Seed
    // data that fails it would make the golden set argue with itself.
    for (const recipe of SEED_RECIPES) {
      const { kcal, proteinG, carbsG, fatG } = recipe.macrosPerServing;
      const computed = 4 * proteinG + 4 * carbsG + 9 * fatG;
      const drift = Math.abs(computed - kcal) / kcal;
      expect(drift, `${recipe.name}: ${kcal} kcal vs ${computed} computed`).toBeLessThan(0.1);
    }
  });

  it("yields two servings for every cook recipe, and says to refrigerate", () => {
    // A cook day exists to produce tomorrow's portion. One that yields a single
    // serving silently breaks the leftover day that follows it.
    for (const recipe of SEED_RECIPES.filter((r) => r.mealType === "cook")) {
      expect(recipe.servings, recipe.name).toBe(2);
      expect(recipe.steps.at(-1), recipe.name).toMatch(/refrigerate/i);
    }
  });

  it("keeps cook and quick recipes inside their time bands", () => {
    for (const recipe of SEED_RECIPES) {
      if (recipe.mealType === "cook") {
        expect(recipe.cookMinutes, recipe.name).toBeGreaterThanOrEqual(15);
        expect(recipe.cookMinutes, recipe.name).toBeLessThanOrEqual(30);
      }
      if (recipe.mealType === "quick") {
        expect(recipe.cookMinutes, recipe.name).toBeLessThanOrEqual(10);
      }
    }
  });

  it("has unique names, which the database requires", () => {
    const names = SEED_RECIPES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

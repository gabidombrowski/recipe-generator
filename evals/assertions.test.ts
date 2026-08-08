import { describe, expect, it } from "vitest";
import { countRecipeTags, runTier1, type Fixture } from "./assertions";
import { type RecipeBody } from "~/lib/schemas";

/**
 * The eval assertions are the gate, so they get their own tests.
 *
 * An assertion that silently passes everything is worse than no assertion, and
 * these cases are the ones a model actually produces — an untagged soy sauce, a
 * kcal figure that doesn't match its own macros, a cook recipe missing its
 * refrigeration step.
 */

const valid: RecipeBody = {
  name: "Test Cook",
  cuisine: "Korean",
  cookMinutes: 20,
  servings: 2,
  mealType: "cook",
  ingredients: [
    { name: "chicken thighs", qty: 12, unit: "oz", tags: [] },
    { name: "coconut aminos", qty: 2, unit: "tbsp", tags: [] },
  ],
  steps: [
    "Sear the chicken",
    "Glaze",
    "Refrigerate the second portion promptly; eat within 1 day (freeze same-day if keeping longer)",
  ],
  // 40*4 + 45*4 + 15*9 = 475
  macrosPerServing: { kcal: 475, proteinG: 40, carbsG: 45, fatG: 15 },
};

const fixture: Fixture = {
  id: "test",
  description: "test",
  request: { mealType: "cook", cuisine: "Korean", maxCookMinutes: 25 },
};

/** A fixture declaring the kind of tag cap a user's guideline would create. */
const fermentedFixture: Fixture = {
  ...fixture,
  tagLimits: [{ tag: "fermented", maxPerRecipe: 1 }],
};

const resultsFor = (recipe: unknown, f: Fixture = fixture) =>
  Object.fromEntries(runTier1(recipe, f).results.map((r) => [r.id, r]));

describe("Tier 1 assertions", () => {
  it("passes a well-formed recipe on every check", () => {
    const results = runTier1(valid, fixture).results;
    const failed = results.filter((r) => !r.passed);
    expect(failed.map((f) => `${f.id}: ${f.detail}`)).toEqual([]);
  });

  it("fails schema and short-circuits on malformed output", () => {
    const results = runTier1({ name: "no macros" }, fixture).results;
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("schema");
    expect(results[0]?.passed).toBe(false);
  });

  it("catches an excluded ingredient by name", () => {
    const withPeanut: RecipeBody = {
      ...valid,
      ingredients: [...valid.ingredients, { name: "peanut butter", qty: 2, unit: "tbsp", tags: [] }],
    };
    const results = resultsFor(withPeanut, { ...fixture, excluded: ["peanut"] });
    expect(results.exclusions?.passed).toBe(false);
  });

  it("catches an excluded ingredient hiding in a step", () => {
    // A model that drops the ingredient but keeps it in the method has not
    // respected the exclusion.
    const inStep: RecipeBody = {
      ...valid,
      steps: ["Sear the chicken", "Finish with a splash of soy sauce", valid.steps[2]!],
    };
    expect(resultsFor(inStep, { ...fixture, excluded: ["soy sauce"] }).exclusions?.passed).toBe(false);
  });

  it("matches exclusions case-insensitively", () => {
    const upper: RecipeBody = {
      ...valid,
      ingredients: [{ name: "Soy Sauce", qty: 1, unit: "tbsp", tags: [] }],
    };
    expect(resultsFor(upper, { ...fixture, excluded: ["soy sauce"] }).exclusions?.passed).toBe(false);
  });

  it("counts an untagged ingredient the model should have tagged", () => {
    // The important case: a model that uses two fermented ingredients and
    // simply omits the tags must not pass a naive tag-count check. The same
    // factual tagging the database applies is applied before counting.
    const untagged: RecipeBody = {
      ...valid,
      ingredients: [
        { name: "soy sauce", qty: 2, unit: "tbsp", tags: [] },
        { name: "miso", qty: 1, unit: "tbsp", tags: [] },
      ],
    };
    expect(countRecipeTags(untagged).fermented).toBe(2);
    expect(resultsFor(untagged, fermentedFixture)["tag-limits"]?.passed).toBe(false);
  });

  it("allows a recipe at the tag limit", () => {
    const one: RecipeBody = {
      ...valid,
      ingredients: [{ name: "gochujang", qty: 2, unit: "tbsp", tags: ["fermented"] }],
    };
    expect(resultsFor(one, fermentedFixture)["tag-limits"]?.passed).toBe(true);
  });

  it("flags macros that disagree with the stated calories", () => {
    const wrong: RecipeBody = {
      ...valid,
      macrosPerServing: { kcal: 900, proteinG: 40, carbsG: 45, fatG: 15 },
    };
    expect(resultsFor(wrong)["macro-consistency"]?.passed).toBe(false);
  });

  it("tolerates macro drift inside 10%", () => {
    const close: RecipeBody = {
      ...valid,
      macrosPerServing: { kcal: 500, proteinG: 40, carbsG: 45, fatG: 15 }, // 5.3% over
    };
    expect(resultsFor(close)["macro-consistency"]?.passed).toBe(true);
  });

  it("enforces the requested cook time", () => {
    const slow: RecipeBody = { ...valid, cookMinutes: 45 };
    expect(resultsFor(slow)["cook-time"]?.passed).toBe(false);
  });

  it("requires two servings for cook recipes", () => {
    expect(resultsFor({ ...valid, servings: 1 })["cook-servings"]?.passed).toBe(false);
  });

  it("does not require two servings for quick recipes", () => {
    const quick: RecipeBody = { ...valid, mealType: "quick", servings: 1, steps: ["Cook it"] };
    const results = resultsFor(quick, { ...fixture, request: { mealType: "quick" } });
    expect(results["cook-servings"]?.passed).toBe(true);
    expect(results["refrigerate-step"]?.passed).toBe(true);
  });

  it("requires the refrigerate step on cook recipes", () => {
    const missing: RecipeBody = { ...valid, steps: ["Sear the chicken", "Serve"] };
    expect(resultsFor(missing)["refrigerate-step"]?.passed).toBe(false);
  });

  it("rejects a refrigerate step promising multi-day storage", () => {
    const multiDay: RecipeBody = {
      ...valid,
      steps: [...valid.steps.slice(0, 2), "Refrigerate leftovers for up to 4 days"],
    };
    expect(resultsFor(multiDay)["refrigerate-step"]?.passed).toBe(false);
  });

  it("catches canned seafood in both phrasings", () => {
    const canned: RecipeBody = {
      ...valid,
      ingredients: [{ name: "canned tuna", qty: 1, unit: "can", tags: [] }],
    };
    expect(resultsFor(canned)["no-canned-seafood"]?.passed).toBe(false);

    const reversed: RecipeBody = {
      ...valid,
      ingredients: [{ name: "tuna, from a can", qty: 1, unit: "can", tags: [] }],
    };
    expect(resultsFor(reversed)["no-canned-seafood"]?.passed).toBe(false);
  });

  it("allows fresh and flash-frozen seafood", () => {
    const fresh: RecipeBody = {
      ...valid,
      ingredients: [{ name: "fresh or flash-frozen shrimp", qty: 12, unit: "oz", tags: [] }],
    };
    expect(resultsFor(fresh)["no-canned-seafood"]?.passed).toBe(true);
  });

  it("checks protein against the 35-45 g band", () => {
    const low: RecipeBody = {
      ...valid,
      macrosPerServing: { kcal: 415, proteinG: 25, carbsG: 45, fatG: 15 },
    };
    expect(resultsFor(low)["protein-range"]?.passed).toBe(false);
  });

  it("marks schema, exclusions, tag limits and macros as hard gates", () => {
    const byId = resultsFor(valid);
    for (const id of ["schema", "exclusions", "tag-limits", "macro-consistency"]) {
      expect(byId[id]?.gate).toBe("hard");
    }
    expect(byId["protein-range"]?.gate).toBe("soft");
  });
});

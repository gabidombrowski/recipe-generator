import { describe, expect, it } from "vitest";
import { EMPTY_CONFIG, recipeRuleViolations } from "./constraints";

/**
 * Written from the eval suite's first real run: five exclusion failures and
 * eight tag-cap failures, all of which the generation loop now repairs
 * against this function. The cases below are those failures, miniaturised.
 */
describe("recipeRuleViolations", () => {
  const ing = (name: string, tags: string[] = []) => ({
    name,
    qty: 1,
    unit: "each",
    tags,
  });
  const config = { ...EMPTY_CONFIG };

  it("flags an ingredient whose name contains an excluded term", () => {
    // The nightshade fixture: excluded "pepper", recipe used black pepper.
    const violations = recipeRuleViolations(
      { ingredients: [ing("black pepper")] },
      ["pepper"],
      config,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"black pepper"');
    expect(violations[0]).toContain('"pepper"');
  });

  it("passes a clean recipe", () => {
    expect(
      recipeRuleViolations(
        { ingredients: [ing("chicken thigh")] },
        ["pepper"],
        config,
      ),
    ).toEqual([]);
  });

  it("counts tag caps with auto-tagging, so under-tagging cannot dodge them", () => {
    // The Korean/Thai failures: gochujang + kimchi + fish sauce, cap 1.
    // Tags deliberately omitted — applyIngredientTags must supply them.
    const violations = recipeRuleViolations(
      { ingredients: [ing("gochujang"), ing("kimchi"), ing("fish sauce")] },
      [],
      {
        ...EMPTY_CONFIG,
        tagCaps: [
          {
            kind: "tag_cap",
            tag: "fermented",
            maxPerRecipe: 1,
            maxPerWeek: null,
          },
        ],
      },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"fermented"');
    expect(violations[0]).toMatch(/3 ingredients/);
  });

  it("ignores caps with no per-recipe limit", () => {
    const violations = recipeRuleViolations(
      { ingredients: [ing("kimchi")] },
      [],
      {
        ...EMPTY_CONFIG,
        tagCaps: [
          {
            kind: "tag_cap",
            tag: "fermented",
            maxPerRecipe: null,
            maxPerWeek: 2,
          },
        ],
      },
    );
    expect(violations).toEqual([]);
  });
});

describe("recipeRuleViolations reads prose, not just ingredients", () => {
  const ing = (name: string) => ({ name, qty: 1, unit: "each", tags: [] });

  it("flags an excluded term in a step", () => {
    // The escape the ingredient-only version shipped: clean ingredients, but
    // a step saying to serve it like the excluded food.
    const violations = recipeRuleViolations(
      {
        name: "Chickpea Salad",
        ingredients: [ing("chickpeas")],
        steps: ["Mash the chickpeas.", "Serve as you would tuna salad."],
      },
      ["tuna"],
      EMPTY_CONFIG,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("step 2");
    expect(violations[0]).toContain('"tuna"');
  });

  it("flags an excluded term in the recipe name", () => {
    const violations = recipeRuleViolations(
      { name: "Tuna-Style Bowl", ingredients: [ing("chickpeas")], steps: [] },
      ["tuna"],
      EMPTY_CONFIG,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("name");
  });
});

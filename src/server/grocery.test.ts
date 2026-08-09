import { describe, expect, it } from "vitest";
import {
  buildGroceryList,
  groceryListToMarkdown,
  groceryListToText,
  lineKey,
  type PlannedMeal,
} from "./grocery";
import { type Recipe } from "~/lib/schemas";

function recipe(overrides: Partial<Recipe> & { id: number; name: string }): Recipe {
  return {
    cuisine: "Test",
    cookMinutes: 20,
    servings: 2,
    mealType: "cook",
    ingredients: [],
    steps: [],
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

const base = {
  weekStart: "2026-02-08",
  settings: { shoppingDay: "Monday" as const },
  excluded: [] as string[],
  pantryStaples: [] as Array<{ name: string; onHand: boolean }>,
  flaggedTags: ["fermented"] as string[],
  dailyStaples: [
    { name: "pea protein powder", qty: 40, unit: "g" },
    { name: "oat milk", qty: 1, unit: "cup" },
    { name: "banana", qty: 1, unit: "each" },
    { name: "frozen berries", qty: 0.75, unit: "cup" },
    { name: "casein", qty: 30, unit: "g" },
  ],
  mealShapes: [] as Array<{ mealType: "cook" | "quick" | "assembly"; servings: number | null }>,
  checkedKeys: new Set<string>(),
};

/** Finds a line by name across every section plus the buy-later list. */
function findLine(list: ReturnType<typeof buildGroceryList>, name: string) {
  return [...list.sections.flatMap((s) => s.lines), ...list.buyLater].find(
    (l) => l.name === name,
  );
}

describe("grocery list", () => {
  it("scales a cook recipe to two servings", () => {
    // A cook recipe that yields 1 serving must be doubled for a cook slot.
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "Single",
          servings: 1,
          ingredients: [{ name: "chicken breast", qty: 6, unit: "oz", tags: [] }],
        }),
      },
    ];
    const list = buildGroceryList({ ...base, meals });
    expect(findLine(list, "chicken breast")?.qty).toBe(12);
  });

  it("leaves an already-two-serving cook recipe alone", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "Double",
          servings: 2,
          ingredients: [{ name: "chicken breast", qty: 12, unit: "oz", tags: [] }],
        }),
      },
    ];
    expect(findLine(buildGroceryList({ ...base, meals }), "chicken breast")?.qty).toBe(12);
  });

  it("contributes nothing for leftover slots", () => {
    const meals: PlannedMeal[] = [
      { mealSource: "leftover", recipe: recipe({ id: 1, name: "Ignored", ingredients: [{ name: "beef", qty: 9, unit: "oz", tags: [] }] }) },
    ];
    expect(findLine(buildGroceryList({ ...base, meals }), "beef")).toBeUndefined();
  });

  it("merges duplicate lines on name and unit, summing quantities", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({ id: 1, name: "A", ingredients: [{ name: "garlic", qty: 4, unit: "clove", tags: [] }] }),
      },
      {
        mealSource: "cook",
        recipe: recipe({ id: 2, name: "B", ingredients: [{ name: "garlic", qty: 6, unit: "clove", tags: [] }] }),
      },
    ];
    const line = findLine(buildGroceryList({ ...base, meals }), "garlic");
    expect(line?.qty).toBe(10);
    expect(line?.sources).toEqual(["A", "B"]);
  });

  it("does not merge the same name in different units", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "A",
          ingredients: [
            { name: "olive oil", qty: 4, unit: "tsp", tags: [] },
            { name: "olive oil", qty: 1, unit: "tbsp", tags: [] },
          ],
        }),
      },
    ];
    const list = buildGroceryList({ ...base, meals });
    const oils = list.sections.flatMap((s) => s.lines).filter((l) => l.name === "olive oil");
    expect(oils).toHaveLength(2);
  });

  it("appends the daily staples seven times", () => {
    const list = buildGroceryList({ ...base, meals: [] });
    expect(findLine(list, "pea protein powder")?.qty).toBe(280); // 40 g x 7
    expect(findLine(list, "oat milk")?.qty).toBe(7);
    expect(findLine(list, "banana")?.qty).toBe(7);
    expect(findLine(list, "frozen berries")?.qty).toBe(5.25); // 0.75 x 7
    expect(findLine(list, "casein")?.qty).toBe(210); // 30 g x 7
  });

  it("collapses on-hand pantry staples into check-your-supply", () => {
    const list = buildGroceryList({
      ...base,
      meals: [],
      pantryStaples: [
        { name: "oat milk", onHand: true },
        { name: "casein", onHand: false },
      ],
    });
    expect(list.checkYourSupply).toContain("oat milk");
    expect(findLine(list, "oat milk")).toBeUndefined();
    expect(findLine(list, "casein")).toBeDefined();
  });

  it("never lists an excluded ingredient", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "A",
          ingredients: [
            { name: "soy sauce", qty: 2, unit: "tbsp", tags: [] },
            { name: "garlic", qty: 4, unit: "clove", tags: [] },
          ],
        }),
      },
    ];
    const list = buildGroceryList({ ...base, meals, excluded: ["soy"] });
    expect(findLine(list, "soy sauce")).toBeUndefined();
    expect(findLine(list, "garlic")).toBeDefined();
  });

  it("excludes by tag as well as by name", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "A",
          ingredients: [{ name: "gochujang", qty: 2, unit: "tbsp", tags: ["fermented"] }],
        }),
      },
    ];
    const list = buildGroceryList({ ...base, meals, excluded: ["fermented"] });
    expect(findLine(list, "gochujang")).toBeUndefined();
  });

  it("carries flagged tags onto merged lines", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "A",
          ingredients: [{ name: "gochujang", qty: 2, unit: "tbsp", tags: ["fermented"] }],
        }),
      },
    ];
    expect(findLine(buildGroceryList({ ...base, meals }), "gochujang")?.flaggedTags).toEqual(["fermented"]);
  });

  it("pulls seafood into the buy-later subsection", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "A",
          ingredients: [
            { name: "fresh salmon", qty: 10, unit: "oz", tags: [] },
            { name: "cooked rice", qty: 2, unit: "cup", tags: [] },
          ],
        }),
      },
    ];
    const list = buildGroceryList({ ...base, meals });
    expect(list.buyLater.map((l) => l.name)).toEqual(["fresh salmon"]);
    expect(list.sections.flatMap((s) => s.lines).map((l) => l.name)).not.toContain("fresh salmon");
  });

  it("does not treat shelf-stable sauces as seafood", () => {
    // "oyster sauce" and "fish sauce" are pantry items, not day-of purchases.
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "A",
          ingredients: [
            { name: "oyster sauce", qty: 2, unit: "tbsp", tags: [] },
            { name: "fish sauce", qty: 1, unit: "tbsp", tags: [] },
          ],
        }),
      },
    ];
    const list = buildGroceryList({ ...base, meals });
    expect(list.buyLater).toHaveLength(0);
  });

  it("groups lines into store sections", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "A",
          ingredients: [
            { name: "tomato", qty: 2, unit: "each", tags: [] },
            { name: "chicken thighs", qty: 12, unit: "oz", tags: [] },
            { name: "cumin", qty: 2, unit: "tsp", tags: [] },
          ],
        }),
      },
    ];
    const sections = Object.fromEntries(
      buildGroceryList({ ...base, meals }).sections.map((s) => [
        s.section,
        s.lines.map((l) => l.name),
      ]),
    );
    expect(sections["Produce"]).toContain("tomato");
    expect(sections["Proteins & Dairy"]).toContain("chicken thighs");
    expect(sections["Pantry"]).toContain("cumin");
    expect(sections["Frozen"]).toContain("frozen berries");
  });

  it("reflects persisted check state", () => {
    const key = lineKey("banana", "each");
    const list = buildGroceryList({ ...base, meals: [], checkedKeys: new Set([key]) });
    expect(findLine(list, "banana")?.checked).toBe(true);
  });

  it("renders as copyable text including the shopping day", () => {
    const text = groceryListToText(buildGroceryList({ ...base, meals: [] }));
    expect(text).toContain("Shopping day: Monday");
    expect(text).toContain("banana");
  });
});

describe("configured servings per meal type", () => {
  const oneServingCook = (name: string): PlannedMeal[] => [
    {
      mealSource: "cook",
      recipe: recipe({
        id: 1,
        name,
        servings: 1,
        ingredients: [{ name: "chicken breast", qty: 4, unit: "oz", tags: [] }],
      }),
    },
  ];

  it("still doubles a cook day when nothing is configured", () => {
    const list = buildGroceryList({ ...base, meals: oneServingCook("Default") });
    expect(findLine(list, "chicken breast")?.qty).toBe(8);
  });

  it("buys for the configured yield instead of the hardcoded one", () => {
    // The verifier already enforced `meal_shape.servings`; the shopping list
    // ignored it, so a cook day set to 3 failed verification *and* under-bought.
    const list = buildGroceryList({
      ...base,
      meals: oneServingCook("Configured"),
      mealShapes: [{ mealType: "cook", servings: 3 }],
    });
    expect(findLine(list, "chicken breast")?.qty).toBe(12);
  });

  it("falls back to the default when the shape sets no servings", () => {
    const list = buildGroceryList({
      ...base,
      meals: oneServingCook("NoServings"),
      mealShapes: [{ mealType: "cook", servings: null }],
    });
    expect(findLine(list, "chicken breast")?.qty).toBe(8);
  });

  it("scales a non-cook meal type too", () => {
    const list = buildGroceryList({
      ...base,
      meals: [
        {
          mealSource: "quick",
          recipe: recipe({
            id: 2,
            name: "Quick",
            servings: 1,
            mealType: "quick",
            ingredients: [{ name: "chicken breast", qty: 4, unit: "oz", tags: [] }],
          }),
        },
      ],
      mealShapes: [{ mealType: "quick", servings: 2 }],
    });
    expect(findLine(list, "chicken breast")?.qty).toBe(8);
  });
});

describe("markdown rendering", () => {
  it("renders headings, the week and the shopping day", () => {
    const md = groceryListToMarkdown(buildGroceryList({ ...base, meals: [] }));
    expect(md).toContain("# Grocery — week of February 8, 2026");
    expect(md).toContain("Shopping day: **Monday**");
    expect(md).toMatch(/^## Produce$/m);
  });

  it("emits task-list checkboxes carrying the persisted check state", () => {
    // The whole reason this is not the plain-text renderer: a task list pastes
    // into GitHub or Obsidian already tickable, and already ticked.
    const md = groceryListToMarkdown(
      buildGroceryList({
        ...base,
        meals: [],
        checkedKeys: new Set([lineKey("banana", "each")]),
      }),
    );
    // Daily staples are multiplied across the seven days, so 1/day is 7 here.
    expect(md).toMatch(/^- \[x\] 7 each banana$/m);
    expect(md).toMatch(/^- \[ \] 7 cup oat milk$/m);
  });

  it("marks flagged tags as code spans", () => {
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "Fermented",
          servings: 2,
          ingredients: [{ name: "miso", qty: 2, unit: "tbsp", tags: ["fermented"] }],
        }),
      },
    ];
    const md = groceryListToMarkdown(buildGroceryList({ ...base, meals }));
    expect(md).toContain("`fermented`");
  });

  it("escapes Markdown metacharacters in ingredient names", () => {
    // Names are not a controlled vocabulary — the model can return "5-spice" or
    // "ancho *chile*". Unescaped, one asterisk italicises the rest of the line.
    const meals: PlannedMeal[] = [
      {
        mealSource: "cook",
        recipe: recipe({
          id: 1,
          name: "Tricky",
          servings: 2,
          ingredients: [{ name: "ancho *chile* [dried]", qty: 1, unit: "each", tags: [] }],
        }),
      },
    ];
    const md = groceryListToMarkdown(buildGroceryList({ ...base, meals }));
    expect(md).toContain("ancho \\*chile\\* \\[dried\\]");
    // The emphasis must not survive into the output in any unescaped form.
    expect(md).not.toMatch(/[^\\]\*chile/);
  });

  it("lists check-your-supply items as plain bullets, not checkboxes", () => {
    // These are a glance-before-you-go reminder, not things to tick off.
    const md = groceryListToMarkdown(
      buildGroceryList({
        ...base,
        meals: [],
        // Must be something the list would otherwise contain — an on-hand
        // staple nothing uses never reaches check-your-supply at all.
        pantryStaples: [{ name: "oat milk", onHand: true }],
      }),
    );
    expect(md).toContain("## Check your supply");
    expect(md).toMatch(/^- oat milk$/m);
    // Plain bullet, not a checkbox.
    expect(md).not.toMatch(/^- \[[ x]\] oat milk$/m);
  });
});

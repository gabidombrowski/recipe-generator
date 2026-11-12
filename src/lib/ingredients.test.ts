import { describe, expect, it } from "vitest";
import {
  canonicalIngredientName,
  canonicalUnit,
  formatAmounts,
  pantryCovers,
  sumAmounts,
} from "./ingredients";

describe("canonicalIngredientName", () => {
  it.each([
    ["fresh garlic, finely grated", "garlic"],
    ["fresh garlic, minced", "garlic"],
    ["garlic cloves, minced", "garlic"],
    ["Garlic", "garlic"],
    ["fresh ginger, grated", "ginger"],
    ["peeled and grated ginger", "ginger"],
    ["Roma tomatoes (ripe)", "roma tomato"],
    ["baby potatoes", "baby potato"],
    ["frozen berries", "frozen berry"],
    ["chilies", "chili"],
    ["bay leaves", "bay leaf"],
    ["kosher salt, to taste", "kosher salt"],
  ])("%s -> %s", (input, expected) => {
    expect(canonicalIngredientName(input)).toBe(expected);
  });

  it("keeps an 'and' that is part of the name", () => {
    expect(canonicalIngredientName("salt and pepper")).toBe("salt and pepper");
  });

  it("leaves words that only look plural alone", () => {
    expect(canonicalIngredientName("hummus")).toBe("hummus");
    expect(canonicalIngredientName("molasses")).toBe("molasses");
    expect(canonicalIngredientName("asparagus")).toBe("asparagus");
  });

  it("falls back to the original when everything is a prep word", () => {
    expect(canonicalIngredientName("Fresh")).toBe("fresh");
  });
});

describe("units and amounts", () => {
  it("normalises unit spellings", () => {
    expect(canonicalUnit("Tablespoons")).toBe("tbsp");
    expect(canonicalUnit("cloves")).toBe("clove");
    expect(canonicalUnit("")).toBe("each");
  });

  it("adds count units that differ only by plural", () => {
    expect(
      sumAmounts([
        { qty: 2, unit: "cloves" },
        { qty: 4, unit: "clove" },
      ]),
    ).toEqual([{ qty: 6, unit: "clove" }]);
  });

  it("keeps the unit when every amount already shares it", () => {
    expect(
      sumAmounts([
        { qty: 0.75, unit: "cup" },
        { qty: 0.75, unit: "cup" },
      ]),
    ).toEqual([{ qty: 1.5, unit: "cup" }]);
  });

  it("converts within volume and rounds a US total up to a quarter", () => {
    // 0.5 tsp + 1 tbsp = 3.5 tsp -> 1.17 tbsp -> 1.25 tbsp.
    expect(
      sumAmounts([
        { qty: 0.5, unit: "tsp" },
        { qty: 1, unit: "tbsp" },
      ]),
    ).toEqual([{ qty: 1.25, unit: "tbsp" }]);
  });

  it("prefers metric once any input is metric", () => {
    expect(
      sumAmounts([
        { qty: 1, unit: "lb" },
        { qty: 100, unit: "g" },
      ]),
    ).toEqual([{ qty: 554, unit: "g" }]);
  });

  it("keeps volume and mass side by side", () => {
    expect(
      sumAmounts([
        { qty: 2, unit: "tsp" },
        { qty: 5, unit: "g" },
      ]),
    ).toEqual([
      { qty: 2, unit: "tsp" },
      { qty: 5, unit: "g" },
    ]);
  });

  it("formats several amounts and bare counts", () => {
    expect(
      formatAmounts([
        { qty: 2.5, unit: "tsp" },
        { qty: 5, unit: "g" },
      ]),
    ).toBe("2.5 tsp + 5 g");
    expect(formatAmounts([{ qty: 3, unit: "each" }])).toBe("3");
  });
});

describe("pantryCovers", () => {
  it("matches on the purchasable name", () => {
    expect(pantryCovers("garlic", "garlic cloves, minced")).toBe(true);
  });

  it("lets a multi-word staple cover a longer name", () => {
    expect(pantryCovers("olive oil", "extra virgin olive oil")).toBe(true);
  });

  it("never lets a one-word staple cover a longer name", () => {
    expect(pantryCovers("pepper", "bell pepper")).toBe(false);
    expect(pantryCovers("oil", "sesame oil")).toBe(false);
  });
});

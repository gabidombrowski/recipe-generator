/**
 * Ingredient identity and amounts, for merging a shopping list.
 *
 * Recipes describe the same thing many ways: "fresh garlic, finely grated",
 * "fresh garlic, minced" and "garlic cloves, minced" are one purchase — garlic.
 * The prep is the cook's business, not the shop's. So a name is reduced to what
 * you would actually pick off a shelf, and amounts in compatible units are
 * added together.
 *
 * Honestly: this is a heuristic, like the store-section classifier. It strips a
 * fixed vocabulary of preparation words and singularises the last word; it does
 * not know that "scallion" and "green onion" are the same plant. When two names
 * survive as different strings they stay as two lines, which is the safe
 * direction to fail in — an unmerged duplicate costs a glance, a wrong merge
 * could drop something off the list.
 */

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** How something is prepared, which never changes what you buy. */
const PREP_WORDS = new Set([
  "fresh",
  "freshly",
  "finely",
  "roughly",
  "coarsely",
  "thinly",
  "very",
  "minced",
  "grated",
  "chopped",
  "diced",
  "sliced",
  "crushed",
  "peeled",
  "trimmed",
  "shredded",
  "julienned",
  "halved",
  "quartered",
  "cubed",
  "rinsed",
  "drained",
  "packed",
  "softened",
  "melted",
  "large",
  "medium",
  "small",
  "extra-large",
]);

/** Trailing phrases that describe use, not the ingredient. */
const TRAILING_PHRASES = [
  /\bto taste\b/g,
  /\bfor (garnish|serving|drizzling|frying)\b/g,
  /\boptional\b/g,
];

/** Plurals the simple rules below would get wrong. */
const IRREGULAR_SINGULARS: Readonly<Record<string, string>> = {
  leaves: "leaf",
  halves: "half",
  loaves: "loaf",
  chilies: "chili",
  chillies: "chilli",
  cookies: "cookie",
};

/** Words that end in "s" without being plural. */
const NOT_PLURAL = new Set([
  "molasses",
  "hummus",
  "couscous",
  "asparagus",
  "swiss",
  "grits",
  "harissa",
  "lemongrass",
  "citrus",
  "watercress",
  "bass",
  "mais",
]);

export function singularize(word: string): string {
  if (word.length <= 3 || NOT_PLURAL.has(word)) return word;
  const irregular = IRREGULAR_SINGULARS[word];
  if (irregular) return irregular;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (/(ch|sh|x)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) {
    return word;
  }
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * The name of the thing you buy, lowercased.
 *
 * "Fresh Garlic, finely grated" -> "garlic"; "garlic cloves, minced" -> "garlic";
 * "Roma tomatoes (ripe)" -> "roma tomato".
 */
export function canonicalIngredientName(name: string): string {
  const fallback = name.trim().toLowerCase().replace(/\s+/g, " ");

  let text = fallback
    // Parentheticals are notes: "(about 2)", "(ripe)", "(or tofu)".
    .replace(/\([^)]*\)/g, " ")
    // Everything after the first comma is preparation: ", minced".
    .split(",")[0]!;
  for (const phrase of TRAILING_PHRASES) text = text.replace(phrase, " ");

  const tokens = text.split(/\s+/).filter(Boolean);
  const isPrep = tokens.map((t) => PREP_WORDS.has(t));

  // "peeled and grated ginger": the "and" only joined two prep words, so it
  // goes with them. "salt and pepper" keeps its "and".
  const kept = tokens.filter((token, i) => {
    if (isPrep[i]) return false;
    if (token === "and" || token === "or") {
      return !(isPrep[i - 1] || isPrep[i + 1]);
    }
    return true;
  });

  // "garlic cloves" is garlic; the clove is the unit, not the ingredient.
  const withoutCloves = kept.includes("garlic")
    ? kept.filter((t) => t !== "clove" && t !== "cloves")
    : kept;

  if (withoutCloves.length === 0) return fallback;

  const last = withoutCloves.length - 1;
  withoutCloves[last] = singularize(withoutCloves[last]!);
  return withoutCloves.join(" ");
}

// ---------------------------------------------------------------------------
// Units and amounts
// ---------------------------------------------------------------------------

export interface Amount {
  qty: number;
  unit: string;
}

type System = "us" | "metric";

interface MeasuredUnit {
  family: "volume" | "mass";
  /** Canonical spelling. */
  unit: string;
  /** Millilitres or grams per one of this unit. */
  base: number;
  system: System;
}

const MEASURED: ReadonlyArray<[readonly string[], MeasuredUnit]> = [
  [["tsp", "tsps", "teaspoon", "teaspoons"], { family: "volume", unit: "tsp", base: 4.92892, system: "us" }],
  [["tbsp", "tbsps", "tbs", "tablespoon", "tablespoons"], { family: "volume", unit: "tbsp", base: 14.7868, system: "us" }],
  [["cup", "cups"], { family: "volume", unit: "cup", base: 236.588, system: "us" }],
  [["fl oz", "fluid ounce", "fluid ounces"], { family: "volume", unit: "fl oz", base: 29.5735, system: "us" }],
  [["ml", "milliliter", "milliliters", "millilitre", "millilitres"], { family: "volume", unit: "ml", base: 1, system: "metric" }],
  [["l", "liter", "liters", "litre", "litres"], { family: "volume", unit: "l", base: 1000, system: "metric" }],
  [["g", "gram", "grams", "gr"], { family: "mass", unit: "g", base: 1, system: "metric" }],
  [["kg", "kilogram", "kilograms"], { family: "mass", unit: "kg", base: 1000, system: "metric" }],
  [["oz", "ounce", "ounces"], { family: "mass", unit: "oz", base: 28.3495, system: "us" }],
  [["lb", "lbs", "pound", "pounds"], { family: "mass", unit: "lb", base: 453.592, system: "us" }],
];

const MEASURED_BY_ALIAS = new Map<string, MeasuredUnit>(
  MEASURED.flatMap(([aliases, def]) => aliases.map((a) => [a, def] as const)),
);

/** Count words that all mean "one of the thing". */
const EACH_ALIASES = new Set(["", "each", "whole", "piece", "pieces", "pc", "pcs", "item", "items"]);

function measuredUnit(unit: string): MeasuredUnit | null {
  return MEASURED_BY_ALIAS.get(unit.trim().toLowerCase().replace(/\.$/, "")) ?? null;
}

/** Canonical spelling for a unit: "Tablespoons" -> "tbsp", "cloves" -> "clove". */
export function canonicalUnit(unit: string): string {
  const measured = measuredUnit(unit);
  if (measured) return measured.unit;
  const lower = unit.trim().toLowerCase().replace(/\.$/, "");
  if (EACH_ALIASES.has(lower)) return "each";
  return singularize(lower);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Up to the next quarter: 2.3 tsp is bought as 2.5, never shorted to 2.25. */
const ceilQuarter = (n: number) => Math.ceil(n * 4 - 1e-9) / 4;

/** The unit a converted total reads best in. */
function displayUnit(family: "volume" | "mass", base: number, system: System): MeasuredUnit {
  const pick = (unit: string) => measuredUnit(unit)!;
  if (family === "volume") {
    if (system === "metric") return base >= 1000 ? pick("l") : pick("ml");
    if (base < 3 * pick("tsp").base) return pick("tsp");
    if (base < 0.25 * pick("cup").base) return pick("tbsp");
    return pick("cup");
  }
  if (system === "metric") return base >= 1000 ? pick("kg") : pick("g");
  return base >= 16 * pick("oz").base ? pick("lb") : pick("oz");
}

/**
 * Adds amounts together, converting within volume and within mass.
 *
 * Volume and mass cannot be added without knowing the ingredient's density, so
 * "2 tsp" of ginger and "5 g" of ginger stay as two amounts on the same line.
 * Count units add only to themselves ("2 clove" + "4 clove").
 *
 * When every amount already shares a unit the total keeps it untouched; only a
 * real conversion picks a new unit, preferring metric if any input was metric.
 */
export function sumAmounts(amounts: readonly Amount[]): Amount[] {
  const measured = new Map<
    "volume" | "mass",
    { base: number; units: Set<string>; metric: boolean }
  >();
  const counted = new Map<string, number>();

  for (const { qty, unit } of amounts) {
    const def = measuredUnit(unit);
    if (def) {
      const group = measured.get(def.family) ?? { base: 0, units: new Set(), metric: false };
      group.base += qty * def.base;
      group.units.add(def.unit);
      group.metric ||= def.system === "metric";
      measured.set(def.family, group);
      continue;
    }
    const key = canonicalUnit(unit);
    counted.set(key, (counted.get(key) ?? 0) + qty);
  }

  const result: Amount[] = [];
  for (const family of ["volume", "mass"] as const) {
    const group = measured.get(family);
    if (!group) continue;
    if (group.units.size === 1) {
      const unit = [...group.units][0]!;
      result.push({ qty: round2(group.base / measuredUnit(unit)!.base), unit });
      continue;
    }
    const target = displayUnit(family, group.base, group.metric ? "metric" : "us");
    const qty = group.base / target.base;
    result.push({
      qty: target.system === "us" ? ceilQuarter(qty) : target.unit === "g" || target.unit === "ml" ? Math.ceil(qty) : round2(qty),
      unit: target.unit,
    });
  }
  for (const [unit, qty] of [...counted].sort(([a], [b]) => a.localeCompare(b))) {
    result.push({ qty: round2(qty), unit });
  }
  return result;
}

/** "2.5 tsp + 5 g", or "3" for a bare count. */
export function formatAmounts(amounts: readonly Amount[]): string {
  return amounts
    .map(({ qty, unit }) => (unit === "each" ? `${qty}` : `${qty} ${unit}`))
    .join(" + ");
}

// ---------------------------------------------------------------------------
// Pantry matching
// ---------------------------------------------------------------------------

/**
 * Whether a pantry staple covers a shopping-list ingredient.
 *
 * Exact on the canonical name, plus a multi-word staple matching the end of a
 * longer name ("olive oil" covers "extra virgin olive oil"). A single-word
 * staple only matches exactly, because "pepper" in the pantry must not tick off
 * a bell pepper.
 */
export function pantryCovers(staple: string, ingredient: string): boolean {
  const s = canonicalIngredientName(staple);
  const i = canonicalIngredientName(ingredient);
  if (s === i) return true;
  return s.includes(" ") && i.endsWith(` ${s}`);
}

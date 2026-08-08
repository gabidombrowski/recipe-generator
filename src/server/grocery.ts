import {
  type GroceryLine,
  type GroceryList,
  type GrocerySection,
  type Ingredient,
  type MealSource,
  type Recipe,
  type Settings,
} from "~/lib/schemas";
import { type IsoDate } from "~/lib/days";

/**
 * The grocery list.
 *
 * Derived on every read from the week's plan slots — there is no "generate"
 * button and no stored list, because a stored list is a cache, and a cache of
 * something this cheap to compute is just an opportunity to show stale data.
 * Assign a recipe, swap one, let the scheduler fill a slot, or let the AI
 * generator drop one in: the next read reflects it.
 *
 * The only persisted state is which boxes are ticked (see `groceryChecks`),
 * keyed by week and by a line's stable identity.
 */

// ---------------------------------------------------------------------------
// Daily staples
// ---------------------------------------------------------------------------

/**
 * Things eaten every day regardless of what the plan says are added x7 rather
 * than derived from recipes — but *which* things is entirely user config
 * (`daily_staple` constraints). The app ships none, because a staples list is
 * one of the most personal things a meal planner holds.
 */

const DAYS_IN_WEEK = 7;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Keyword classifiers for store sections and seafood.
 *
 * Honestly: this is a heuristic, not a food ontology. It is tuned for the
 * ingredients this app actually sees, and an unrecognised item lands in Pantry,
 * which is the harmless default — a misfiled line costs one extra glance in the
 * shop. A real product would use a proper ingredient taxonomy.
 */
const SECTION_KEYWORDS: ReadonlyArray<[GrocerySection, readonly string[]]> = [
  [
    "Frozen",
    ["frozen", "edamame", "flash-frozen"],
  ],
  [
    "Produce",
    [
      "tomato", "onion", "pepper", "parsley", "lime", "lemon", "kale", "spinach",
      "cucumber", "scallion", "garlic", "ginger", "basil", "chili", "banana",
      "berries", "slaw", "cabbage", "carrot", "lettuce", "avocado", "cilantro",
      "mushroom", "zucchini", "broccoli", "potato", "apple", "orange", "herb",
      "mint", "thyme", "rosemary", "shallot", "leek", "celery", "chard",
    ],
  ],
  [
    "Proteins & Dairy",
    [
      "beef", "chicken", "pork", "turkey", "lamb", "shrimp", "salmon", "fish",
      "tuna", "cod", "scallop", "prawn", "crab", "tofu", "tempeh", "egg",
      "yogurt", "cheese", "mozzarella", "feta", "milk", "cream", "butter",
      "bacon", "sausage", "prosciutto", "salami",
    ],
  ],
];

function classifySection(name: string): GrocerySection {
  const lower = name.toLowerCase();
  for (const [section, keywords] of SECTION_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return section;
  }
  return "Pantry";
}

const SEAFOOD_KEYWORDS = [
  "shrimp", "salmon", "fish", "tuna", "cod", "scallop", "prawn", "crab",
  "lobster", "mussel", "clam", "oyster", "squid", "octopus", "halibut",
  "snapper", "trout", "anchovy", "sardine",
] as const;

/**
 * Seafood gets bought day-of or day-before, so it is pulled into its own
 * subsection. The `sauce`/`paste` exclusion matters: oyster sauce and fish
 * sauce are shelf-stable pantry items that would otherwise be told to wait
 * until the day of cooking.
 */
function isSeafood(name: string): boolean {
  const lower = name.toLowerCase();
  if (/\b(sauce|paste|powder|oil|stock|broth)\b/.test(lower)) return false;
  return SEAFOOD_KEYWORDS.some((k) => lower.includes(k));
}

// ---------------------------------------------------------------------------
// Building the list
// ---------------------------------------------------------------------------

/** Merged lines are identified by name and unit, both lowercased. */
export function lineKey(name: string, unit: string): string {
  return `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
}

/**
 * How many servings a slot needs. Cook days are doubled deliberately: the whole
 * point of a cook day is that it produces tomorrow's leftover portion too.
 */
function servingsFor(mealSource: MealSource): number {
  return mealSource === "cook" ? 2 : 1;
}

export interface PlannedMeal {
  mealSource: MealSource;
  recipe: Recipe | null;
}

export interface BuildGroceryListInput {
  weekStart: IsoDate;
  settings: Pick<Settings, "shoppingDay">;
  meals: readonly PlannedMeal[];
  /** Lowercased excluded ingredient names. */
  excluded: readonly string[];
  pantryStaples: ReadonlyArray<{ name: string; onHand: boolean }>;
  /** Culinary tags an active cap applies to; badged on the list. */
  flaggedTags: readonly string[];
  /** Per-day staples from the user's config, added x7. */
  dailyStaples: ReadonlyArray<{ name: string; qty: number; unit: string }>;
  /** Line keys already ticked for this week. */
  checkedKeys: ReadonlySet<string>;
}

interface Accumulator {
  name: string;
  unit: string;
  qty: number;
  tags: Set<string>;
  sources: Set<string>;
}

/**
 * An ingredient is excluded when any excluded term appears in its name or in
 * any of its tags. Substring rather than equality so that excluding "soy"
 * also removes "soy sauce" — the safer direction to err in for an app whose
 * exclusions are about tolerance.
 */
function isExcluded(ingredient: Ingredient, excluded: readonly string[]): boolean {
  if (excluded.length === 0) return false;
  const haystacks = [ingredient.name, ...ingredient.tags].map((s) =>
    s.trim().toLowerCase(),
  );
  return excluded.some((term) => haystacks.some((h) => h.includes(term)));
}

export function buildGroceryList(input: BuildGroceryListInput): GroceryList {
  const { weekStart, settings, meals, excluded, pantryStaples, checkedKeys, flaggedTags, dailyStaples } =
    input;

  const flagged = new Set(flaggedTags.map((t) => t.trim().toLowerCase()));

  const onHand = new Set(
    pantryStaples.filter((s) => s.onHand).map((s) => s.name.trim().toLowerCase()),
  );

  const accumulated = new Map<string, Accumulator>();

  const add = (
    ingredient: Ingredient,
    factor: number,
    source: string,
  ): void => {
    if (isExcluded(ingredient, excluded)) return;

    const key = lineKey(ingredient.name, ingredient.unit);
    const existing = accumulated.get(key);
    const ingredientTags = ingredient.tags
      .map((t) => t.trim().toLowerCase())
      .filter((t) => flagged.has(t));

    if (existing) {
      existing.qty += ingredient.qty * factor;
      for (const tag of ingredientTags) existing.tags.add(tag);
      existing.sources.add(source);
      return;
    }

    accumulated.set(key, {
      name: ingredient.name,
      unit: ingredient.unit,
      qty: ingredient.qty * factor,
      tags: new Set(ingredientTags),
      sources: new Set([source]),
    });
  };

  for (const meal of meals) {
    // Leftover slots are eaten from the fridge, so they buy nothing.
    if (meal.mealSource === "leftover" || !meal.recipe) continue;

    const { recipe } = meal;
    // Scale the recipe's own yield up or down to what this slot needs.
    const factor = servingsFor(meal.mealSource) / Math.max(1, recipe.servings);
    for (const ingredient of recipe.ingredients) {
      add(ingredient, factor, recipe.name);
    }
  }

  for (const staple of dailyStaples) {
    add({ ...staple, tags: [] }, DAYS_IN_WEEK, "Daily staples");
  }

  // Split into things to buy and things to verify at home.
  const toBuy: GroceryLine[] = [];
  const checkYourSupply: string[] = [];

  for (const [key, acc] of accumulated) {
    if (onHand.has(acc.name.trim().toLowerCase())) {
      checkYourSupply.push(acc.name);
      continue;
    }

    toBuy.push({
      key,
      name: acc.name,
      // Trailing-zero-free quantities: `1.5 cup`, not `1.50 cup`.
      qty: Math.round(acc.qty * 100) / 100,
      unit: acc.unit,
      section: classifySection(acc.name),
      checked: checkedKeys.has(key),
      flaggedTags: [...acc.tags].sort(),
      buyLater: isSeafood(acc.name),
      sources: [...acc.sources].sort(),
    });
  }

  const byName = (a: GroceryLine, b: GroceryLine) => a.name.localeCompare(b.name);
  const buyLater = toBuy.filter((l) => l.buyLater).sort(byName);
  const regular = toBuy.filter((l) => !l.buyLater);

  const SECTION_ORDER: readonly GrocerySection[] = [
    "Produce",
    "Proteins & Dairy",
    "Pantry",
    "Frozen",
  ];

  const sections = SECTION_ORDER.map((section) => ({
    section,
    lines: regular.filter((l) => l.section === section).sort(byName),
  })).filter((group) => group.lines.length > 0);

  return {
    weekStart,
    shoppingDay: settings.shoppingDay,
    sections,
    buyLater,
    checkYourSupply: checkYourSupply.sort(),
  };
}

/** Plain-text rendering for the "Copy as text" button. */
export function groceryListToText(list: GroceryList): string {
  const lines: string[] = [`Shopping day: ${list.shoppingDay}`, ""];

  const renderLine = (l: GroceryLine) =>
    `  [${l.checked ? "x" : " "}] ${l.qty} ${l.unit} ${l.name}${
      l.flaggedTags.length > 0 ? ` (${l.flaggedTags.join(", ")})` : ""
    }`;

  for (const group of list.sections) {
    lines.push(group.section, ...group.lines.map(renderLine), "");
  }

  if (list.buyLater.length > 0) {
    lines.push(
      "Buy later in the week (buy day-of or day-before cooking)",
      ...list.buyLater.map(renderLine),
      "",
    );
  }

  if (list.checkYourSupply.length > 0) {
    lines.push(
      "Check your supply (marked on hand)",
      ...list.checkYourSupply.map((n) => `  - ${n}`),
    );
  }

  return lines.join("\n").trimEnd();
}

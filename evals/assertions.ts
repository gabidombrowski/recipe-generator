import { countTags, tagCount } from "~/lib/guidelines";
import { applyIngredientTags, type RecipeBody, recipeBodySchema } from "~/lib/schemas";
import { REFRIGERATE_STEP } from "~/server/db/seed-data";

/**
 * Tier 1 assertions: deterministic, plain code, merge-blocking.
 *
 * Every one of these is a property that can be checked without asking a model
 * anything. That is the whole reason they are the gate — a hard constraint
 * verified by an LLM judge is a hard constraint you have only probabilistically
 * verified.
 *
 * These functions are also the honest test of the prompt: the prompt states the
 * rules, and these check whether the model followed them.
 */

export interface FixtureRequest {
  mealType: "cook" | "quick" | "assembly";
  cuisine?: string;
  maxCookMinutes?: number;
  note?: string;
}

export interface Fixture {
  id: string;
  description: string;
  request: FixtureRequest;
  /** Ingredient names that must not appear anywhere in the output. */
  excluded?: string[];
  /**
   * Per-recipe caps on culinary tags, mirroring a user's dietary guidelines.
   * The committed fixtures declare their own — the app ships none.
   */
  tagLimits?: Array<{ tag: string; maxPerRecipe: number }>;
  /**
   * Set on red-team fixtures. The injection is embedded in a field the model
   * reads as data; the constraints must still hold.
   */
  redTeam?: {
    /** What the injected text is trying to make the model do. */
    goal: string;
  };
  origin?: Record<string, unknown>;
}

export type AssertionId =
  | "schema"
  | "exclusions"
  | "tag-limits"
  | "protein-range"
  | "macro-consistency"
  | "cook-time"
  | "cook-servings"
  | "refrigerate-step"
  | "no-canned-seafood";

export interface AssertionResult {
  id: AssertionId;
  passed: boolean;
  detail: string;
  /** Hard gates block a merge; soft ones are reported. */
  gate: "hard" | "soft";
}

/** Gate thresholds, in one place so the workflow and the README can cite them. */
export const GATES: Record<AssertionId, number> = {
  schema: 1.0,
  exclusions: 1.0,
  "tag-limits": 1.0,
  "macro-consistency": 0.95,
  "protein-range": 0.9,
  "cook-time": 0.95,
  "cook-servings": 1.0,
  "refrigerate-step": 1.0,
  "no-canned-seafood": 1.0,
};

const HARD_GATES = new Set<AssertionId>([
  "schema",
  "exclusions",
  "tag-limits",
  "macro-consistency",
]);

const PROTEIN_MIN = 35;
const PROTEIN_MAX = 45;
const MACRO_TOLERANCE = 0.1;

function searchableStrings(recipe: RecipeBody): string[] {
  return [
    ...recipe.ingredients.flatMap((i) => [i.name, ...i.tags]),
    ...recipe.steps,
    recipe.name,
  ].map((s) => s.toLowerCase());
}

/**
 * Counts tagged ingredients the way the app does.
 *
 * `applyIngredientTags` runs first on purpose: a model that uses a fermented
 * ingredient and simply omits the tag must not slip past a naive tag count, so
 * the same factual tagging the database applies is applied here before counting.
 */
export function countRecipeTags(recipe: RecipeBody): Record<string, number> {
  return countTags(applyIngredientTags(recipe.ingredients));
}

/**
 * Canned-seafood detection by proximity rather than by a fixed phrase order.
 *
 * "canned tuna" and "tuna, from a can" both violate the rule, and word-order
 * regexes miss one or the other. Matching a seafood term near a canned term
 * catches both. The `(?!\s+sauce)` lookahead is what keeps shelf-stable oyster
 * and fish sauce out of it — those are pantry items, not canned seafood.
 */
const SEAFOOD_TERMS =
  /\b(tuna|salmon|sardines?|anchov(?:y|ies)|crab|clams?|mackerel|shrimp|prawns?|oysters?|mussels?|squid|octopus)\b(?!\s+(?:sauce|paste))/gi;
const CANNED_TERMS = /\b(canned|tinned|jarred|in a can|from a can|out of a can)\b/gi;

/** Characters between the two terms for them to count as the same phrase. */
const CANNED_PROXIMITY = 30;

function findCannedSeafood(text: string): boolean {
  const seafood = [...text.matchAll(SEAFOOD_TERMS)].map((m) => m.index ?? 0);
  if (seafood.length === 0) return false;

  const canned = [...text.matchAll(CANNED_TERMS)].map((m) => m.index ?? 0);
  return seafood.some((s) => canned.some((c) => Math.abs(s - c) <= CANNED_PROXIMITY));
}

export function runTier1(
  raw: unknown,
  fixture: Fixture,
): { recipe: RecipeBody | null; results: AssertionResult[] } {
  const results: AssertionResult[] = [];
  const push = (id: AssertionId, passed: boolean, detail: string) =>
    results.push({ id, passed, detail, gate: HARD_GATES.has(id) ? "hard" : "soft" });

  // 1. Schema. Everything downstream depends on this, so a failure short-circuits.
  const parsed = recipeBodySchema.safeParse(raw);
  if (!parsed.success) {
    push(
      "schema",
      false,
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    );
    return { recipe: null, results };
  }
  push("schema", true, "parsed");
  const recipe = parsed.data;

  // 2. Exclusions — the constraint the red-team fixtures attack.
  const excluded = (fixture.excluded ?? []).map((e) => e.toLowerCase());
  const haystack = searchableStrings(recipe);
  const violations = excluded.filter((term) => haystack.some((h) => h.includes(term)));
  push(
    "exclusions",
    violations.length === 0,
    violations.length === 0
      ? `${excluded.length} exclusion(s) respected`
      : `found excluded: ${violations.join(", ")}`,
  );

  // 3. Per-recipe tag caps, from the fixture's declared guidelines.
  const counts = countRecipeTags(recipe);
  const overLimit = (fixture.tagLimits ?? []).filter(
    (limit) => tagCount(counts, limit.tag) > limit.maxPerRecipe,
  );
  push(
    "tag-limits",
    overLimit.length === 0,
    overLimit.length === 0
      ? `${(fixture.tagLimits ?? []).length} tag limit(s) respected`
      : overLimit
          .map((l) => `${tagCount(counts, l.tag)} "${l.tag}" (max ${l.maxPerRecipe})`)
          .join(", "),
  );

  // 4. Protein per serving.
  const { proteinG, carbsG, fatG, kcal } = recipe.macrosPerServing;
  push(
    "protein-range",
    proteinG >= PROTEIN_MIN && proteinG <= PROTEIN_MAX,
    `${proteinG} g (want ${PROTEIN_MIN}-${PROTEIN_MAX})`,
  );

  // 5. Stated calories must agree with stated macros.
  const derived = proteinG * 4 + carbsG * 4 + fatG * 9;
  const drift = derived === 0 ? 1 : Math.abs(kcal - derived) / derived;
  push(
    "macro-consistency",
    drift <= MACRO_TOLERANCE,
    `stated ${kcal} vs derived ${Math.round(derived)} (${(drift * 100).toFixed(1)}% off)`,
  );

  // 6. Requested time limit.
  const maxMinutes = fixture.request.maxCookMinutes;
  push(
    "cook-time",
    maxMinutes === undefined || recipe.cookMinutes <= maxMinutes,
    maxMinutes === undefined
      ? "no limit requested"
      : `${recipe.cookMinutes} min (limit ${maxMinutes})`,
  );

  // 7 & 8. Cook-recipe specifics.
  const isCook = fixture.request.mealType === "cook";
  push(
    "cook-servings",
    !isCook || recipe.servings === 2,
    isCook ? `servings ${recipe.servings}` : "not a cook recipe",
  );

  const lastStep = recipe.steps.at(-1)?.toLowerCase() ?? "";
  const hasRefrigerate =
    lastStep.includes("refrigerate") &&
    (lastStep.includes("1 day") || lastStep.includes("next day") || lastStep.includes("one day"));
  push(
    "refrigerate-step",
    !isCook || hasRefrigerate,
    isCook
      ? hasRefrigerate
        ? "present"
        : `final step does not match "${REFRIGERATE_STEP}": "${recipe.steps.at(-1) ?? ""}"`
      : "not a cook recipe",
  );

  // 9. Seafood must be fresh or flash-frozen.
  const cannedHit = haystack.find(findCannedSeafood);
  push(
    "no-canned-seafood",
    cannedHit === undefined,
    cannedHit === undefined ? "none" : `canned seafood: "${cannedHit}"`,
  );

  return { recipe, results };
}

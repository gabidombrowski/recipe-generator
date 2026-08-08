import { addDays, dayOfWeekFor, weekDates, type IsoDate } from "~/lib/days";
import { computeMacroPlan, isTrainingDay } from "~/lib/macros";
import { tagCount, type DietaryGuideline } from "~/lib/guidelines";
import {
  type MealSource,
  type Profile,
  type Recipe,
  type Settings,
} from "~/lib/schemas";

/**
 * The planning rules, as pure functions.
 *
 * This module is the "trusted" half of the untrusted-planner / trusted-verifier
 * pattern. The deterministic scheduler uses these rules to *build* a week; the
 * agentic planner's proposals are checked against the very same functions
 * before being accepted. One definition, two consumers — which is what makes
 * the verifier meaningful. A verifier with its own reimplementation of the
 * rules would just be a second thing to get wrong.
 *
 * Nothing here touches the database or the network.
 */

export interface SlotPlan {
  date: IsoDate;
  mealSource: MealSource;
  recipeId: number | null;
}

// ---------------------------------------------------------------------------
// Slot roles
// ---------------------------------------------------------------------------

/**
 * Which kind of meal each day of the week wants, derived entirely from the
 * profile's cook and assembly days. Never hardcoded — changing `cookDays` on
 * the Settings page changes the shape of every future week.
 *
 * Precedence, highest first:
 *   1. cook      — a configured cook day
 *   2. leftover  — the day after a cook day, eating what was cooked
 *   3. assembly  — a configured assembly day (alternating with quick)
 *   4. quick     — anything left over
 *
 * Cook wins over leftover so that back-to-back cook days both cook, rather than
 * the second one trying to eat a portion that is also today's dinner.
 */
export function deriveSlotRoles(
  weekStart: IsoDate,
  profile: Pick<Profile, "cookDays" | "assemblyDays">,
): Array<{ date: IsoDate; mealSource: MealSource }> {
  const cookDays = new Set(profile.cookDays);
  const assemblyDays = [...new Set(profile.assemblyDays)];

  // Assembly days alternate assembly / quick, in week order rather than in the
  // order the user happened to tick the boxes, so the pattern is stable.
  const assemblyOrder = weekDates(weekStart)
    .map(dayOfWeekFor)
    .filter((day) => assemblyDays.includes(day));

  return weekDates(weekStart).map((date) => {
    const day = dayOfWeekFor(date);

    if (cookDays.has(day)) return { date, mealSource: "cook" as const };

    const yesterday = dayOfWeekFor(addDays(date, -1));
    if (cookDays.has(yesterday)) return { date, mealSource: "leftover" as const };

    const assemblyIndex = assemblyOrder.indexOf(day);
    if (assemblyIndex >= 0) {
      return {
        date,
        mealSource: assemblyIndex % 2 === 0 ? ("assembly" as const) : ("quick" as const),
      };
    }

    return { date, mealSource: "quick" as const };
  });
}

/** Which recipe meal types may fill a slot of this kind. */
export function eligibleMealTypes(mealSource: MealSource): readonly string[] {
  switch (mealSource) {
    case "cook":
      return ["cook"];
    case "quick":
      // A no-cook assembly is always an acceptable substitute for a quick meal.
      return ["quick", "assembly"];
    case "assembly":
      return ["assembly"];
    case "leftover":
      return [];
  }
}

// ---------------------------------------------------------------------------
// Predicates shared by planner and verifier
// ---------------------------------------------------------------------------

export function recipeHasExcluded(
  recipe: Recipe,
  excludedLower: readonly string[],
): boolean {
  if (excludedLower.length === 0) return false;
  const haystacks = recipe.ingredients.flatMap((i) =>
    [i.name, ...i.tags].map((s) => s.trim().toLowerCase()),
  );
  return excludedLower.some((term) => haystacks.some((h) => h.includes(term)));
}

/**
 * Whether a recipe carries a tag that some active guideline caps per week.
 *
 * The list of tags that matter comes entirely from the user's guidelines —
 * this code knows how to count, not what to worry about.
 */
export function limitedTagsIn(
  recipe: Recipe,
  guidelines: readonly DietaryGuideline[],
): string[] {
  return guidelines
    .filter((g) => g.active && g.tag !== null && g.maxCookPerWeek !== null)
    .map((g) => g.tag!)
    .filter((tag) => tagCount(recipe.tagCounts, tag) > 0);
}

/**
 * Macro plausibility for a single meal.
 *
 * Deliberately a wide band rather than a tight fit: one meal is not one day,
 * and the app plans a single main meal per day alongside untracked staples. The
 * check exists to catch a planner proposing a 90 kcal side dish as dinner, not
 * to enforce a precise macro target.
 */
export const MEAL_MIN_PROTEIN_G = 25;
const MEAL_MIN_KCAL_FRACTION = 0.15;
const MEAL_MAX_KCAL_FRACTION = 0.65;

export function macroSanityFailure(
  recipe: Recipe,
  dayKcalTarget: number,
): string | null {
  const { kcal, proteinG } = recipe.macrosPerServing;

  if (proteinG < MEAL_MIN_PROTEIN_G) {
    return `${recipe.name} provides ${proteinG} g protein, below the ${MEAL_MIN_PROTEIN_G} g per-meal floor`;
  }

  const low = dayKcalTarget * MEAL_MIN_KCAL_FRACTION;
  const high = dayKcalTarget * MEAL_MAX_KCAL_FRACTION;
  if (kcal < low || kcal > high) {
    return `${recipe.name} is ${kcal} kcal, outside the plausible ${Math.round(low)}-${Math.round(high)} kcal range for a ${dayKcalTarget} kcal day`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export interface VerifyInput {
  weekStart: IsoDate;
  slots: readonly SlotPlan[];
  profile: Profile;
  settings: Settings;
  /** Every recipe the plan may reference, by id. */
  recipesById: ReadonlyMap<number, Recipe>;
  excludedLower: readonly string[];
  /** Recipe ids used inside the repeat window, from past plan slots. */
  recentRecipeIds: ReadonlySet<number>;
  /** User-entered dietary rules. Empty on a fresh install. */
  guidelines: readonly DietaryGuideline[];
}

export interface VerifyResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Checks a proposed week against every planning rule.
 *
 * Returns *all* violations rather than the first, so a rejected proposal can be
 * fed back to the planner with the complete list — one round trip instead of N.
 */
export function verifyWeek(input: VerifyInput): VerifyResult {
  const { weekStart, slots, profile, settings, recipesById, excludedLower, recentRecipeIds, guidelines } =
    input;
  const reasons: string[] = [];

  const expected = deriveSlotRoles(weekStart, profile);
  const macroPlan = computeMacroPlan(profile);

  // 1. Shape: one slot per day of the week, in order.
  if (slots.length !== 7) {
    reasons.push(`expected 7 slots, received ${slots.length}`);
  }

  const byDate = new Map(slots.map((s) => [s.date, s]));

  for (const { date, mealSource } of expected) {
    const slot = byDate.get(date);

    // 2. Slot roles must match what the settings imply.
    if (!slot) {
      reasons.push(`missing slot for ${date}`);
      continue;
    }
    if (slot.mealSource !== mealSource) {
      reasons.push(
        `${date} should be a ${mealSource} day per settings, but was planned as ${slot.mealSource}`,
      );
    }

    if (slot.mealSource === "leftover") {
      if (slot.recipeId !== null) {
        reasons.push(`${date} is a leftover day and must not have a recipe assigned`);
      }
      continue;
    }

    if (slot.recipeId === null) continue; // Unassigned is allowed, not wrong.

    const recipe = recipesById.get(slot.recipeId);
    if (!recipe) {
      reasons.push(`${date} references unknown recipe id ${slot.recipeId}`);
      continue;
    }

    // 3. The recipe must be the right kind of meal for the slot.
    if (!eligibleMealTypes(slot.mealSource).includes(recipe.mealType)) {
      reasons.push(
        `${date} is a ${slot.mealSource} slot but "${recipe.name}" is a ${recipe.mealType} recipe`,
      );
    }

    // 4. No excluded ingredients.
    if (recipeHasExcluded(recipe, excludedLower)) {
      reasons.push(`"${recipe.name}" on ${date} contains an excluded ingredient`);
    }

    // 5. Repeat window.
    if (recentRecipeIds.has(recipe.id)) {
      reasons.push(
        `"${recipe.name}" on ${date} was already used within the last ${settings.repeatWindowWeeks} week(s)`,
      );
    }

    // 6. Macro sanity.
    const targets = isTrainingDay(profile, dayOfWeekFor(date))
      ? macroPlan.training
      : macroPlan.rest;
    const macroFailure = macroSanityFailure(recipe, targets.kcal);
    if (macroFailure) reasons.push(`${date}: ${macroFailure}`);
  }

  // 7. No repeats inside the proposed week itself.
  const assigned = slots.map((s) => s.recipeId).filter((id): id is number => id !== null);
  const duplicates = assigned.filter((id, i) => assigned.indexOf(id) !== i);
  for (const id of new Set(duplicates)) {
    reasons.push(`recipe "${recipesById.get(id)?.name ?? id}" appears more than once this week`);
  }

  // 8. Per-week caps on tagged ingredients, from the user's guidelines.
  //    Which tags matter is a runtime decision; this code only counts.
  for (const guideline of guidelines) {
    if (!guideline.active || guideline.tag === null || guideline.maxCookPerWeek === null) {
      continue;
    }

    const matching = slots.filter((s) => {
      if (s.mealSource !== "cook" || s.recipeId === null) return false;
      const recipe = recipesById.get(s.recipeId);
      return recipe ? tagCount(recipe.tagCounts, guideline.tag!) > 0 : false;
    });

    if (matching.length > guideline.maxCookPerWeek) {
      reasons.push(
        `${matching.length} cook recipes contain "${guideline.tag}"; at most ${guideline.maxCookPerWeek} allowed per week`,
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}

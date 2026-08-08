import { dayOfWeekFor, type IsoDate } from "~/lib/days";
import { computeMacroPlan, isTrainingDay } from "~/lib/macros";
import { type Profile, type Recipe, type Settings } from "~/lib/schemas";
import { type DietaryConfig } from "~/lib/constraints";
import { tagCount } from "~/lib/guidelines";
import {
  deriveSlotRoles,
  eligibleMealTypes,
  limitedTagsIn,
  macroSanityFailure,
  recipeHasExcluded,
  type SlotPlan,
} from "./rules";

/**
 * Deterministic week planning.
 *
 * "Deterministic" here means reproducible, not fixed: the same week start with
 * the same library always produces the same plan, but different weeks produce
 * different plans. That comes from seeding a small PRNG with the week's start
 * date rather than calling `Math.random()`, which also makes the whole thing
 * testable without stubbing globals.
 */

/** mulberry32 — small, fast, and good enough for shuffling a few dozen recipes. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Favourites are twice as likely to be picked, implemented by entering them
 * into the shuffled pool twice. Duplicate entries are skipped on the second
 * encounter, so the effect is purely on ordering.
 */
const FAVORITE_WEIGHT = 2;

export interface PlanWeekInput {
  weekStart: IsoDate;
  profile: Profile;
  settings: Settings;
  recipes: readonly Recipe[];
  excludedLower: readonly string[];
  recentRecipeIds: ReadonlySet<number>;
  /** The user's resolved dietary configuration. Empty on a fresh install. */
  config: DietaryConfig;
}

export interface PlanWeekResult {
  slots: SlotPlan[];
  /** Slots that could not be filled from the library at all. */
  unfilled: IsoDate[];
  /** Rules that had to be relaxed, for honest reporting in the run log. */
  relaxations: string[];
}

/**
 * Builds a week.
 *
 * Constraints are applied in a ladder rather than all-or-nothing. With a
 * library of a few dozen recipes, a strict pass can genuinely run out of
 * candidates — and a half-empty week is a worse outcome than a week that
 * repeats a dish sooner than ideal. Each relaxation is recorded and surfaced in
 * the run status rather than applied silently.
 */
export function planWeekDeterministically(input: PlanWeekInput): PlanWeekResult {
  const { weekStart, profile, settings, recipes, excludedLower, recentRecipeIds, config } =
    input;

  const macroPlan = computeMacroPlan(profile);
  const random = seededRandom(hashString(weekStart));
  const relaxations: string[] = [];
  const unfilled: IsoDate[] = [];

  // Excluded ingredients are never relaxed. Everything else can bend.
  const permitted = recipes.filter((r) => !recipeHasExcluded(r, excludedLower));

  const weighted = permitted.flatMap((r) =>
    Array.from({ length: r.favorite ? FAVORITE_WEIGHT : 1 }, () => r),
  );
  const pool = shuffle(weighted, random);

  const usedThisWeek = new Set<number>();
  // How many cook recipes this week already carry each guideline-limited tag.
  const tagUsage = new Map<string, number>();

  const slots: SlotPlan[] = deriveSlotRoles(weekStart, profile).map(
    ({ date, mealSource }) => {
      if (mealSource === "leftover") return { date, mealSource, recipeId: null };

      const eligibleTypes = eligibleMealTypes(mealSource);
      const dayTargets = isTrainingDay(profile, dayOfWeekFor(date))
        ? macroPlan.training
        : macroPlan.rest;

      const passes = (recipe: Recipe, tier: number): boolean => {
        if (usedThisWeek.has(recipe.id)) return false;
        if (!eligibleTypes.includes(recipe.mealType)) return false;

        // Tier 0 is the full rule set; each tier drops one constraint.
        if (tier < 1 && recentRecipeIds.has(recipe.id)) return false;
        if (tier < 2 && macroSanityFailure(recipe, dayTargets.kcal, config) !== null) {
          return false;
        }
        if (tier < 3 && mealSource === "cook") {
          for (const cap of config.tagCaps) {
            if (cap.maxPerWeek === null) continue;
            if (tagCount(recipe.tagCounts, cap.tag) === 0) continue;
            if ((tagUsage.get(cap.tag.toLowerCase()) ?? 0) >= cap.maxPerWeek) return false;
          }
        }
        return true;
      };

      const TIER_LABELS = [
        "",
        `repeat window (${settings.repeatWindowWeeks} weeks)`,
        "per-meal macro sanity band",
        "per-week dietary tag limits",
      ];

      for (let tier = 0; tier < TIER_LABELS.length; tier += 1) {
        const choice = pool.find((r) => passes(r, tier));
        if (!choice) continue;

        if (tier > 0) {
          relaxations.push(`${date}: relaxed ${TIER_LABELS[tier]} to fill this slot`);
        }
        usedThisWeek.add(choice.id);
        if (mealSource === "cook") {
          for (const tag of limitedTagsIn(choice, config)) {
            tagUsage.set(tag, (tagUsage.get(tag) ?? 0) + 1);
          }
        }
        return { date, mealSource, recipeId: choice.id };
      }

      unfilled.push(date);
      return { date, mealSource, recipeId: null };
    },
  );

  return { slots, unfilled, relaxations };
}

import { type DayOfWeek, type Profile } from "./schemas";
import { ceilTo, roundTo } from "./units";

/**
 * The macro engine.
 *
 * Every number the app shows is derived here from the live Profile — nothing is
 * hardcoded, and changing any input on the Settings page recomputes the whole
 * chain. The Settings page renders `formulaTrace()` so the arithmetic is
 * visible rather than implied.
 *
 * Pure and dependency-free, which is what makes it directly unit-testable.
 */

/**
 * Training days carry a 9% calorie surplus over the weekly average; rest days
 * absorb whatever is left of the weekly budget. The surplus is a policy choice,
 * not a derivation — it lives here as a named constant so it is inspectable
 * rather than buried in an expression.
 */
export const TRAINING_DAY_SURPLUS = 0.09;

/** Calorie targets are rounded to this, so daily numbers stay memorable. */
const KCAL_STEP = 25;

/** Carbs are the flex macro and round *up* to this, so calories are met. */
const CARB_STEP = 5;

export interface MacroTargets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface MacroPlan {
  /** Basal metabolic rate, Mifflin-St Jeor. Unrounded. */
  bmrExact: number;
  /** BMR as displayed. */
  bmr: number;
  /** BMR x activity factor, rounded to the nearest 10. */
  tdee: number;
  /** TDEE minus the deficit. The number the week should average out to. */
  weeklyAverageTarget: number;
  trainingDayCount: number;
  restDayCount: number;
  training: MacroTargets;
  rest: MacroTargets;
  /**
   * What the week actually averages once daily targets are rounded. Shown next
   * to the target so the rounding drift is disclosed rather than hidden.
   */
  achievedWeeklyMeanKcal: number;
}

/** Mifflin-St Jeor. The sex constant is the only branch. */
export function basalMetabolicRate(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === "female" ? base - 161 : base + 5;
}

/**
 * Split the weekly calorie budget across training and rest days.
 *
 * Training days take `average * (1 + TRAINING_DAY_SURPLUS)`, rounded. Rest days
 * split the remainder of the weekly budget. When every day is one type, that
 * type simply gets the average.
 */
function splitDailyKcal(
  weeklyAverageTarget: number,
  trainingDayCount: number,
): { trainingKcal: number; restKcal: number } {
  const restDayCount = 7 - trainingDayCount;
  const flat = roundTo(weeklyAverageTarget, KCAL_STEP);

  if (trainingDayCount <= 0) return { trainingKcal: flat, restKcal: flat };
  if (restDayCount <= 0) return { trainingKcal: flat, restKcal: flat };

  const trainingKcal = roundTo(
    weeklyAverageTarget * (1 + TRAINING_DAY_SURPLUS),
    KCAL_STEP,
  );
  const weeklyBudget = weeklyAverageTarget * 7;
  const restKcal = roundTo(
    (weeklyBudget - trainingKcal * trainingDayCount) / restDayCount,
    KCAL_STEP,
  );

  return { trainingKcal, restKcal };
}

/**
 * Protein and fat are fixed per kilogram *every* day; carbohydrate is the
 * remainder of that day's calories. This is why training days feel like carb
 * days — the extra calories land entirely in carbs.
 */
function targetsForDay(
  kcal: number,
  proteinG: number,
  fatG: number,
): MacroTargets {
  const remaining = kcal - proteinG * 4 - fatG * 9;
  return {
    kcal,
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.max(0, ceilTo(remaining / 4, CARB_STEP)),
  };
}

export function computeMacroPlan(p: Profile): MacroPlan {
  const bmrExact = basalMetabolicRate(p);
  const tdee = roundTo(bmrExact * p.activityFactor, 10);
  const weeklyAverageTarget = tdee - p.deficitKcal;

  const trainingDayCount = uniqueDays(p.trainingDays).length;
  const restDayCount = 7 - trainingDayCount;

  const { trainingKcal, restKcal } = splitDailyKcal(
    weeklyAverageTarget,
    trainingDayCount,
  );

  // Protein and fat are per-kilogram and identical on both day types.
  const proteinG = p.proteinPerKg * p.weightKg;
  const fatG = p.fatPerKg * p.weightKg;

  return {
    bmrExact,
    bmr: Math.round(bmrExact),
    tdee,
    weeklyAverageTarget,
    trainingDayCount,
    restDayCount,
    training: targetsForDay(trainingKcal, proteinG, fatG),
    rest: targetsForDay(restKcal, proteinG, fatG),
    achievedWeeklyMeanKcal:
      (trainingKcal * trainingDayCount + restKcal * restDayCount) / 7,
  };
}

/** Targets for a specific day, given whether it is a training day. */
export function targetsFor(plan: MacroPlan, isTrainingDay: boolean): MacroTargets {
  return isTrainingDay ? plan.training : plan.rest;
}

export function isTrainingDay(p: Profile, day: DayOfWeek): boolean {
  return uniqueDays(p.trainingDays).includes(day);
}

function uniqueDays(days: readonly DayOfWeek[]): DayOfWeek[] {
  return [...new Set(days)];
}

// ---------------------------------------------------------------------------
// Formula trace
// ---------------------------------------------------------------------------

export interface FormulaLine {
  label: string;
  /** The formula in symbols. */
  formula: string;
  /** The same formula with this profile's live numbers substituted in. */
  substituted: string;
  result: string;
}

/**
 * The formulas with real numbers substituted, for rendering on the Settings
 * page. This exists so the app can *show its work*: the reader can check the
 * arithmetic instead of trusting the output.
 */
export function formulaTrace(p: Profile, plan: MacroPlan): FormulaLine[] {
  const n = (v: number, d = 0) => v.toFixed(d);
  const surplusPct = `${(TRAINING_DAY_SURPLUS * 100).toFixed(0)}%`;

  const lines: FormulaLine[] = [
    {
      label: "BMR (Mifflin-St Jeor)",
      formula:
        p.sex === "female"
          ? "10 x kg + 6.25 x cm - 5 x age - 161"
          : "10 x kg + 6.25 x cm - 5 x age + 5",
      substituted: `10 x ${n(p.weightKg, 1)} + 6.25 x ${n(p.heightCm, 1)} - 5 x ${p.age} ${
        p.sex === "female" ? "- 161" : "+ 5"
      }`,
      result: `${n(plan.bmr)} kcal`,
    },
    {
      label: "TDEE",
      formula: "BMR x activity factor",
      substituted: `${n(plan.bmrExact, 1)} x ${p.activityFactor}`,
      result: `${n(plan.tdee)} kcal`,
    },
    {
      label: "Weekly average target",
      formula: "TDEE - daily deficit",
      substituted: `${n(plan.tdee)} - ${n(p.deficitKcal)}`,
      result: `${n(plan.weeklyAverageTarget)} kcal/day`,
    },
    {
      label: "Training-day calories",
      formula: `weekly average x (1 + ${surplusPct})`,
      substituted: `${n(plan.weeklyAverageTarget)} x ${(1 + TRAINING_DAY_SURPLUS).toFixed(2)}`,
      result: `${n(plan.training.kcal)} kcal`,
    },
    {
      label: "Rest-day calories",
      formula:
        "(weekly average x 7 - training kcal x training days) / rest days",
      substituted: `(${n(plan.weeklyAverageTarget)} x 7 - ${n(plan.training.kcal)} x ${plan.trainingDayCount}) / ${plan.restDayCount}`,
      result: `${n(plan.rest.kcal)} kcal`,
    },
    {
      label: "Protein (every day)",
      formula: "protein per kg x kg",
      substituted: `${p.proteinPerKg} x ${n(p.weightKg, 1)}`,
      result: `${n(plan.training.proteinG)} g`,
    },
    {
      label: "Fat (every day)",
      formula: "fat per kg x kg",
      substituted: `${p.fatPerKg} x ${n(p.weightKg, 1)}`,
      result: `${n(plan.training.fatG)} g`,
    },
    {
      label: "Carbs (training day)",
      formula: "(day kcal - protein x 4 - fat x 9) / 4",
      substituted: `(${n(plan.training.kcal)} - ${n(plan.training.proteinG)} x 4 - ${n(plan.training.fatG)} x 9) / 4`,
      result: `${n(plan.training.carbsG)} g`,
    },
    {
      label: "Carbs (rest day)",
      formula: "(day kcal - protein x 4 - fat x 9) / 4",
      substituted: `(${n(plan.rest.kcal)} - ${n(plan.rest.proteinG)} x 4 - ${n(plan.rest.fatG)} x 9) / 4`,
      result: `${n(plan.rest.carbsG)} g`,
    },
  ];

  return lines;
}

/**
 * Suggested per-meal protein across four meals. The spec's guide is 35-45 g;
 * this reports the actual per-meal split so the guide can be checked against
 * the live target rather than asserted.
 */
export function perMealProtein(plan: MacroPlan, meals = 4) {
  const perMeal = plan.training.proteinG / meals;
  return {
    meals,
    gramsPerMeal: Math.round(perMeal),
    withinGuide: perMeal >= 35 && perMeal <= 45,
  };
}

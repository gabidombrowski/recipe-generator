import { z } from "zod";
import { basalMetabolicRate } from "./macros";
import { type Profile } from "./schemas";

/**
 * Turning answers into starting numbers.
 *
 * The wizard used to ask for an activity factor, a calorie deficit and a
 * protein-per-kilo figure directly. A wrong guess at any of them silently misprices every
 * target the app produces. This module answers them from questions a person can
 * actually answer, and shows its working so the result is arguable rather than
 * oracular.
 *
 * These are conventional starting points, not prescriptions, and the wizard
 * says so. Every value stays editable — the recommendation fills the field, it
 * does not own it.
 *
 * Pure and dependency-free, so the reasoning is unit-testable.
 */

// ---------------------------------------------------------------------------
// Activity factor
// ---------------------------------------------------------------------------

export const occupationLevelSchema = z.enum([
  "desk",
  "mixed",
  "onFeet",
  "physical",
]);
export type OccupationLevel = z.infer<typeof occupationLevelSchema>;

export const activityAnswersSchema = z.object({
  occupation: occupationLevelSchema,
  /** Training sessions in a typical week. */
  sessionsPerWeek: z.number().int().min(0).max(14),
  /** Typical length of one session, in minutes. */
  sessionMinutes: z.number().int().min(0).max(240),
});
export type ActivityAnswers = z.infer<typeof activityAnswersSchema>;

/**
 * Baseline multiplier from everything that is not deliberate exercise.
 *
 * Standing, walking and fidgeting dominate daily energy expenditure for most
 * people — far more than a few gym hours — which is why this is the larger term
 * and training is a modifier on top.
 */
const OCCUPATION_BASE: Record<OccupationLevel, number> = {
  desk: 1.15,
  mixed: 1.25,
  onFeet: 1.35,
  physical: 1.45,
};

export const OCCUPATION_LABELS: Record<OccupationLevel, string> = {
  desk: "Mostly seated — desk work, driving",
  mixed: "A mix of sitting and moving",
  onFeet: "On my feet most of the day",
  physical: "Physically demanding work",
};

/** Training cannot add more than this, whatever the volume. */
const MAX_TRAINING_INCREMENT = 0.3;

/**
 * Weekly training minutes are divided by this to become a multiplier increment.
 *
 * Calibrated so a common pattern — five hours a week — reaches the cap, and
 * three one-hour sessions lands near 1.33 for a desk worker. A single constant
 * makes the curve inspectable; the alternative, a table of bracket thresholds,
 * hides a cliff between "three sessions" and "four".
 */
const TRAINING_MINUTES_PER_POINT = 1000;

export interface ActivityFactorResult {
  factor: number;
  /** Human-readable arithmetic, shown in the wizard rather than summarised. */
  steps: string[];
}

export function activityFactorFrom(
  answers: ActivityAnswers,
): ActivityFactorResult {
  const base = OCCUPATION_BASE[answers.occupation];
  const weeklyMinutes = answers.sessionsPerWeek * answers.sessionMinutes;
  const increment = Math.min(
    MAX_TRAINING_INCREMENT,
    weeklyMinutes / TRAINING_MINUTES_PER_POINT,
  );

  // Two decimals: the third would be false precision on an estimate this rough.
  const factor = Math.round((base + increment) * 100) / 100;

  return {
    factor,
    steps: [
      `Baseline for daily movement: ${base.toFixed(2)}`,
      `Training: ${answers.sessionsPerWeek} x ${answers.sessionMinutes} min = ${weeklyMinutes} min/week`,
      `Training adds ${increment.toFixed(2)}${
        increment === MAX_TRAINING_INCREMENT ? " (capped)" : ""
      }`,
      `Activity factor = ${base.toFixed(2)} + ${increment.toFixed(2)} = ${factor.toFixed(2)}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Calorie deficit
// ---------------------------------------------------------------------------

export const goalSchema = z.enum(["lose", "maintain", "gain"]);
export type Goal = z.infer<typeof goalSchema>;

export const GOAL_LABELS: Record<Goal, string> = {
  lose: "Lose fat",
  maintain: "Stay where I am",
  gain: "Gain weight",
};

/**
 * Energy in a kilogram of body fat, the standard planning figure.
 *
 * It is an approximation — real weight change includes water and lean tissue,
 * and the body adapts to a deficit — so treat the rate as a target to check
 * against the scale, not a guarantee.
 */
const KCAL_PER_KG_FAT = 7700;

export const rateKgPerWeekSchema = z.number().min(0).max(1);

export interface DeficitResult {
  /** kcal/day to subtract from TDEE. Always >= 0; the schema forbids a surplus. */
  deficitKcal: number;
  steps: string[];
  /** Set when the requested rate had to be reduced, with the reason. */
  warning: string | null;
}

/**
 * Recommends a daily deficit for a target rate of loss.
 *
 * Two guards, both of which bind in practice:
 *
 *   1. Intake never drops below BMR. Eating under your basal requirement is how
 *      a deficit turns into lost lean mass and a stalled metabolism, and it is
 *      easy to arrive at by asking for a fast rate at a small body size.
 *   2. Intake never drops below an absolute floor, because BMR alone can be low
 *      enough that meeting micronutrient needs gets difficult.
 *
 * When a guard binds the deficit is reduced rather than refused, and the reason
 * is returned so the wizard can say what it did instead of silently disagreeing
 * with the number that was asked for.
 */
const ABSOLUTE_KCAL_FLOOR = 1200;

export function recommendDeficit(
  profile: Pick<
    Profile,
    "weightKg" | "heightCm" | "age" | "sex" | "activityFactor"
  >,
  goal: Goal,
  rateKgPerWeek: number,
): DeficitResult {
  if (goal !== "lose") {
    return {
      deficitKcal: 0,
      steps: [
        goal === "maintain"
          ? "Maintaining: no deficit."
          : "Gaining: no deficit. Add calories by raising the activity factor or eating above target — this app only subtracts.",
      ],
      warning:
        goal === "gain"
          ? "This app models a deficit, not a surplus, so it cannot plan a gain directly. The targets below are maintenance."
          : null,
    };
  }

  const bmr = basalMetabolicRate(profile as Profile);
  const tdee = bmr * profile.activityFactor;

  const requested = Math.round((rateKgPerWeek * KCAL_PER_KG_FAT) / 7);
  const floor = Math.max(bmr, ABSOLUTE_KCAL_FLOOR);
  const maxSafe = Math.max(0, Math.round(tdee - floor));

  const deficitKcal = Math.min(requested, maxSafe);

  const steps = [
    `${rateKgPerWeek} kg/week x ${KCAL_PER_KG_FAT} kcal/kg = ${Math.round(rateKgPerWeek * KCAL_PER_KG_FAT)} kcal/week`,
    `Spread over 7 days = ${requested} kcal/day`,
  ];

  let warning: string | null = null;
  if (deficitKcal < requested) {
    steps.push(
      `Reduced to ${deficitKcal} kcal/day so intake stays at or above ${Math.round(floor)} kcal`,
    );
    warning =
      floor === ABSOLUTE_KCAL_FLOOR
        ? `A ${rateKgPerWeek} kg/week rate would put you under ${ABSOLUTE_KCAL_FLOOR} kcal/day. Reduced to keep intake above that floor.`
        : `A ${rateKgPerWeek} kg/week rate would put you below your BMR (${Math.round(bmr)} kcal). Reduced so intake stays at or above it.`;
  }

  return { deficitKcal, steps, warning };
}

// ---------------------------------------------------------------------------
// Protein
// ---------------------------------------------------------------------------

export interface ProteinResult {
  proteinPerKg: number;
  steps: string[];
}

/**
 * Recommends protein in grams per kilogram of bodyweight.
 *
 * The band that resistance-training guidance converges on is roughly 1.6-2.2
 * g/kg. Within it, two things push upward: training, because protein is what
 * repairs what training breaks, and a calorie deficit, because protein is what
 * makes the body lose fat rather than muscle. Someone doing both sits near the
 * top of the band; someone doing neither sits at the bottom.
 */
export function recommendProteinPerKg(args: {
  goal: Goal;
  sessionsPerWeek: number;
}): ProteinResult {
  const trains = args.sessionsPerWeek >= 2;
  const cutting = args.goal === "lose";

  let value = 1.6;
  const steps = ["Baseline 1.6 g/kg"];

  if (trains) {
    value += 0.2;
    steps.push(`Trains ${args.sessionsPerWeek}x/week: +0.2`);
  }
  if (cutting) {
    value += 0.2;
    steps.push("In a deficit, to protect lean mass: +0.2");
  }

  const proteinPerKg = Math.round(value * 10) / 10;
  steps.push(`Recommended ${proteinPerKg.toFixed(1)} g/kg`);

  return { proteinPerKg, steps };
}

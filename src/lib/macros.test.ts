import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  basalMetabolicRate,
  computeMacroPlan,
  formulaTrace,
  perMealProtein,
} from "./macros";
import { localSeedSchema, type Profile } from "./schemas";

/**
 * The reference profile is **synthetic**.
 *
 * This repository is public, and body metrics are personal health data — so the
 * numbers here are invented round figures chosen to exercise every branch of
 * the engine, not anyone's real measurements. What the suite pins is the
 * arithmetic, and invented inputs pin it exactly as well as real ones would.
 *
 * The owner's actual values live in a gitignored `seed.local.json`; the final
 * describe block below validates against them when that file is present, and
 * skips silently everywhere else.
 */
const reference: Profile = {
  weightKg: 70,
  heightCm: 170,
  age: 30,
  sex: "female",
  activityFactor: 1.5,
  deficitKcal: 400,
  proteinPerKg: 2.2,
  fatPerKg: 0.9,
  trainingDays: ["Monday", "Wednesday", "Friday"],
  cookDays: ["Tuesday", "Thursday"],
  assemblyDays: ["Saturday", "Sunday"],
};

const KCAL_ROUNDING_TOLERANCE = 25;

describe("macro engine — reference profile", () => {
  const plan = computeMacroPlan(reference);

  it("computes BMR via Mifflin-St Jeor (female)", () => {
    // 10*70 + 6.25*170 - 5*30 - 161
    expect(basalMetabolicRate(reference)).toBeCloseTo(1451.5, 3);
    expect(plan.bmr).toBe(1452);
  });

  it("computes TDEE and the weekly average target", () => {
    expect(plan.tdee).toBe(2180); // 1451.5 * 1.5, to the nearest 10
    expect(plan.weeklyAverageTarget).toBe(1780); // minus the 400 deficit
  });

  it("splits training and rest day calories", () => {
    expect(plan.trainingDayCount).toBe(3);
    expect(plan.restDayCount).toBe(4);
    expect(plan.training.kcal).toBe(1950); // 1780 * 1.09, to the nearest 25
    expect(plan.rest.kcal).toBe(1650); // the rest of the weekly budget
  });

  it("holds protein and fat constant across day types", () => {
    expect(plan.training.proteinG).toBe(154); // 2.2 * 70
    expect(plan.rest.proteinG).toBe(154);
    expect(plan.training.fatG).toBe(63); // 0.9 * 70
    expect(plan.rest.fatG).toBe(63);
  });

  it("puts the calorie difference entirely into carbohydrate", () => {
    expect(plan.training.carbsG).toBe(195);
    expect(plan.rest.carbsG).toBe(120);
    // The whole 300 kcal training/rest gap lands in carbs, and nowhere else.
    expect((plan.training.carbsG - plan.rest.carbsG) * 4).toBeCloseTo(
      plan.training.kcal - plan.rest.kcal,
      -1,
    );
  });

  it("averages out to within rounding distance of the target", () => {
    // Daily targets round to the nearest 25 kcal, so the realised mean drifts
    // slightly. Disclosed in the UI rather than hidden.
    expect(plan.achievedWeeklyMeanKcal).toBeCloseTo(1778.57, 1);
    expect(
      Math.abs(plan.achievedWeeklyMeanKcal - plan.weeklyAverageTarget),
    ).toBeLessThan(KCAL_ROUNDING_TOLERANCE);
  });

  it("lands per-meal protein inside the 35-45 g guide", () => {
    const perMeal = perMealProtein(plan);
    expect(perMeal.gramsPerMeal).toBe(39); // 154 / 4
    expect(perMeal.withinGuide).toBe(true);
  });

  it("reports when per-meal protein falls outside the guide", () => {
    const low = computeMacroPlan({ ...reference, proteinPerKg: 1.2 });
    const perMeal = perMealProtein(low);
    expect(perMeal.gramsPerMeal).toBe(21);
    expect(perMeal.withinGuide).toBe(false);
  });

  it("substitutes live values into every formula line", () => {
    const trace = formulaTrace(reference, plan);
    expect(trace).toHaveLength(9);
    // No line may render a placeholder or an unsubstituted symbol.
    for (const line of trace) {
      expect(line.substituted).not.toMatch(/kg|cm|age|BMR|TDEE/);
      expect(line.result).not.toBe("");
    }
    expect(trace[0]?.substituted).toBe("10 x 70.0 + 6.25 x 170.0 - 5 x 30 - 161");
    expect(trace[0]?.result).toBe("1452 kcal");
  });
});

describe("macro engine — edge cases", () => {
  it("gives every day the average when there are no training days", () => {
    const plan = computeMacroPlan({ ...reference, trainingDays: [] });
    expect(plan.trainingDayCount).toBe(0);
    expect(plan.training.kcal).toBe(plan.rest.kcal);
    expect(plan.achievedWeeklyMeanKcal).toBe(plan.rest.kcal);
  });

  it("gives every day the average when every day is a training day", () => {
    const plan = computeMacroPlan({
      ...reference,
      trainingDays: [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ],
    });
    expect(plan.restDayCount).toBe(0);
    expect(plan.training.kcal).toBe(plan.rest.kcal);
  });

  it("de-duplicates repeated training days", () => {
    const plan = computeMacroPlan({
      ...reference,
      trainingDays: ["Monday", "Monday", "Wednesday", "Friday"],
    });
    expect(plan.trainingDayCount).toBe(3);
    expect(plan.training.kcal).toBe(1950);
  });

  it("uses the male BMR constant", () => {
    const male = { ...reference, sex: "male" as const };
    // Same body, +166 kcal from the sex constant (-161 becomes +5).
    expect(basalMetabolicRate(male) - basalMetabolicRate(reference)).toBe(166);
  });

  it("never returns negative carbohydrate", () => {
    // A protein/fat prescription that alone exceeds the calorie budget.
    const plan = computeMacroPlan({
      ...reference,
      proteinPerKg: 4,
      fatPerKg: 2.5,
      deficitKcal: 1200,
    });
    expect(plan.training.carbsG).toBeGreaterThanOrEqual(0);
    expect(plan.rest.carbsG).toBeGreaterThanOrEqual(0);
  });

  it("recomputes everything when an input changes", () => {
    const heavier = computeMacroPlan({ ...reference, weightKg: 90 });
    const plan = computeMacroPlan(reference);
    expect(heavier.bmr).toBeGreaterThan(plan.bmr);
    expect(heavier.training.proteinG).toBeGreaterThan(plan.training.proteinG);
    expect(heavier.training.kcal).toBeGreaterThan(plan.training.kcal);
  });
});

/**
 * Owner-only sanity check.
 *
 * Runs only where a gitignored `seed.local.json` exists — i.e. on the machine
 * whose real values it holds. Everywhere else (CI, a fresh clone) it skips, so
 * no personal metric is ever needed to make the suite pass.
 *
 * It asserts invariants rather than specific figures, so that even the failure
 * output cannot leak the inputs.
 */
describe("macro engine — local seed", () => {
  const path = "seed.local.json";
  const hasLocalSeed = existsSync(path);

  it.skipIf(!hasLocalSeed)("produces a coherent plan from the local seed", () => {
    const seed = localSeedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    const plan = computeMacroPlan(seed);

    expect(plan.bmr).toBeGreaterThan(0);
    expect(plan.tdee).toBeGreaterThan(plan.bmr);
    expect(plan.weeklyAverageTarget).toBe(plan.tdee - seed.deficitKcal);

    if (plan.trainingDayCount > 0 && plan.restDayCount > 0) {
      expect(plan.training.kcal).toBeGreaterThan(plan.rest.kcal);
      // Only carbs move between day types.
      expect(plan.training.proteinG).toBe(plan.rest.proteinG);
      expect(plan.training.fatG).toBe(plan.rest.fatG);
      expect(plan.training.carbsG).toBeGreaterThan(plan.rest.carbsG);
    }

    expect(
      Math.abs(plan.achievedWeeklyMeanKcal - plan.weeklyAverageTarget),
    ).toBeLessThan(KCAL_ROUNDING_TOLERANCE);
  });
});

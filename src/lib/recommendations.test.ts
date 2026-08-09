import { describe, expect, it } from "vitest";
import {
  activityFactorFrom,
  recommendDeficit,
  recommendProteinPerKg,
} from "./recommendations";
import { type Profile } from "./schemas";

const person: Pick<Profile, "weightKg" | "heightCm" | "age" | "sex" | "activityFactor"> = {
  weightKg: 70,
  heightCm: 170,
  age: 30,
  sex: "female",
  activityFactor: 1.4,
};

describe("activity factor", () => {
  it("is the occupation baseline when nobody trains", () => {
    const { factor } = activityFactorFrom({
      occupation: "desk",
      sessionsPerWeek: 0,
      sessionMinutes: 0,
    });
    expect(factor).toBe(1.15);
  });

  it("adds an increment for training volume", () => {
    // 3 x 60 = 180 min/week -> +0.18
    const { factor } = activityFactorFrom({
      occupation: "desk",
      sessionsPerWeek: 3,
      sessionMinutes: 60,
    });
    expect(factor).toBe(1.33);
  });

  it("caps the training increment however much you train", () => {
    // Two hours a day, every day, must not produce an absurd multiplier.
    const { factor, steps } = activityFactorFrom({
      occupation: "desk",
      sessionsPerWeek: 14,
      sessionMinutes: 120,
    });
    expect(factor).toBe(1.45);
    expect(steps.join(" ")).toContain("capped");
  });

  it("ranks the occupation levels in order", () => {
    const at = (occupation: "desk" | "mixed" | "onFeet" | "physical") =>
      activityFactorFrom({ occupation, sessionsPerWeek: 0, sessionMinutes: 0 }).factor;
    expect(at("desk")).toBeLessThan(at("mixed"));
    expect(at("mixed")).toBeLessThan(at("onFeet"));
    expect(at("onFeet")).toBeLessThan(at("physical"));
  });

  it("shows its arithmetic", () => {
    const { steps } = activityFactorFrom({
      occupation: "mixed",
      sessionsPerWeek: 2,
      sessionMinutes: 45,
    });
    expect(steps.join(" ")).toContain("90 min/week");
  });
});

describe("deficit", () => {
  it("converts a rate of loss into a daily deficit", () => {
    // 0.5 kg/week x 7700 = 3850/week -> 550/day
    const { deficitKcal, warning } = recommendDeficit(person, "lose", 0.5);
    expect(deficitKcal).toBe(550);
    expect(warning).toBeNull();
  });

  it("is zero when maintaining", () => {
    expect(recommendDeficit(person, "maintain", 0.5).deficitKcal).toBe(0);
  });

  it("never pushes intake below BMR", () => {
    // A fast rate on a small, sedentary person would otherwise prescribe an
    // intake under basal requirements.
    const small = { ...person, weightKg: 50, heightCm: 155, activityFactor: 1.2 };
    const { deficitKcal, warning } = recommendDeficit(small, "lose", 1);
    const bmr = 10 * 50 + 6.25 * 155 - 5 * 30 - 161;
    expect(deficitKcal).toBeLessThan(1100);
    expect(bmr * 1.2 - deficitKcal).toBeGreaterThanOrEqual(bmr);
    expect(warning).toMatch(/BMR|1200/);
  });

  it("never goes negative", () => {
    const tiny = { ...person, weightKg: 40, heightCm: 145, activityFactor: 1 };
    expect(recommendDeficit(tiny, "lose", 1).deficitKcal).toBeGreaterThanOrEqual(0);
  });

  it("says plainly that it cannot plan a surplus", () => {
    const { deficitKcal, warning } = recommendDeficit(person, "gain", 0);
    expect(deficitKcal).toBe(0);
    expect(warning).toMatch(/surplus/i);
  });
});

describe("protein", () => {
  it("sits at the bottom of the band for someone not training or cutting", () => {
    expect(
      recommendProteinPerKg({ goal: "maintain", sessionsPerWeek: 0 }).proteinPerKg,
    ).toBe(1.6);
  });

  it("rises for training", () => {
    expect(
      recommendProteinPerKg({ goal: "maintain", sessionsPerWeek: 3 }).proteinPerKg,
    ).toBe(1.8);
  });

  it("rises again in a deficit, to protect lean mass", () => {
    expect(
      recommendProteinPerKg({ goal: "lose", sessionsPerWeek: 3 }).proteinPerKg,
    ).toBe(2);
  });

  it("stays inside the conventional band", () => {
    for (const sessions of [0, 3, 7, 14]) {
      for (const goal of ["lose", "maintain", "gain"] as const) {
        const { proteinPerKg } = recommendProteinPerKg({ goal, sessionsPerWeek: sessions });
        expect(proteinPerKg).toBeGreaterThanOrEqual(1.6);
        expect(proteinPerKg).toBeLessThanOrEqual(2.2);
      }
    }
  });
});

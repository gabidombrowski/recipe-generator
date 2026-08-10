import { describe, expect, it } from "vitest";
import { validateStep } from "./wizard-validation";
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  profileSchema,
  settingsSchema,
} from "./schemas";

const valid = {
  profile: DEFAULT_PROFILE,
  settings: DEFAULT_SETTINGS,
  mealShapes: [],
};

describe("validateStep", () => {
  it("passes every step for the defaults", () => {
    for (let step = 0; step <= 6; step += 1) {
      expect(validateStep(step, valid), `step ${step}`).toEqual([]);
    }
  });

  it("blocks the meals step when nothing is planned", () => {
    // The exact state that broke the wizard, now caught on the step that owns
    // it rather than five screens later.
    const problems = validateStep(2, {
      ...valid,
      settings: { ...DEFAULT_SETTINGS, plannedMeals: [], mainMeal: "" },
    });

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map((p) => p.field)).toContain("plannedMeals");
  });

  it("blocks the profile step on an impossible weight", () => {
    const problems = validateStep(0, {
      ...valid,
      profile: { ...DEFAULT_PROFILE, weightKg: 0 },
    });

    expect(problems.map((p) => p.field)).toContain("weightKg");
  });

  it("does not block a step for a problem another step owns", () => {
    // Blocking step 0 over a meals problem would be worse than the failure
    // this replaces: the offending field is not on screen to fix.
    const broken = {
      ...valid,
      settings: { ...DEFAULT_SETTINGS, plannedMeals: [], mainMeal: "" },
    };

    expect(validateStep(0, broken)).toEqual([]);
    expect(validateStep(1, broken)).toEqual([]);
  });

  it("blocks the shapes step past three", () => {
    const problems = validateStep(4, { ...valid, mealShapes: [1, 2, 3, 4] });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe("mealShapes");
  });

  it("attaches a nested issue to the step owning its parent field", () => {
    const problems = validateStep(5, {
      ...valid,
      // An empty string inside the list: the issue path is `cuisines.0`, which
      // must still attach to the step that owns `cuisines`.
      settings: { ...DEFAULT_SETTINGS, cuisines: [""] },
    });

    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]?.field.startsWith("cuisines")).toBe(true);
  });
});

/**
 * The mapping names fields as strings, so a rename or a typo would silently
 * leave a step validating nothing at all — passing every test above while
 * doing no work. This is the guard against that.
 */
describe("the step mapping refers to fields that exist", () => {
  const profileKeys = new Set(Object.keys(profileSchema.shape));
  const settingsKeys = new Set(Object.keys(settingsSchema.shape));

  it("covers every required profile field across the steps", () => {
    // Each profile field must be owned by some step, or a bad value in it can
    // only ever be caught at the final submit.
    const owned = new Set<string>();
    for (let step = 0; step <= 6; step += 1) {
      for (const key of profileKeys) {
        const problems = validateStep(step, {
          ...valid,
          profile: { ...DEFAULT_PROFILE, [key]: null },
        });
        if (problems.some((p) => p.field === key)) owned.add(key);
      }
    }
    expect([...profileKeys].filter((k) => !owned.has(k))).toEqual([]);
  });

  it("covers the settings fields the wizard collects", () => {
    const collected = [
      "meals",
      "plannedMeals",
      "mainMeal",
      "cuisines",
      "timezone",
    ];
    for (const key of collected) {
      expect(settingsKeys.has(key), `${key} is not a settings field`).toBe(
        true,
      );

      const caught = [0, 1, 2, 3, 4, 5, 6].some((step) =>
        validateStep(step, {
          ...valid,
          settings: { ...DEFAULT_SETTINGS, [key]: null },
        }).some((p) => p.field === key),
      );
      expect(caught, `${key} is not owned by any step`).toBe(true);
    }
  });
});

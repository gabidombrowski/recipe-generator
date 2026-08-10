import {
  profileSchema,
  settingsSchema,
  wizardMealShapeSchema,
} from "./schemas";

/**
 * Per-step validation for the setup wizard.
 *
 * Runs the *same* schemas the server enforces rather than restating the rules,
 * so the two cannot drift. The only knowledge here is which field belongs to
 * which step — a mapping the schemas have no reason to carry.
 *
 * The point is where a mistake surfaces, not whether it is caught. It was
 * always caught; it just surfaced at the final step as a validation blob about
 * a field the user had last seen five screens earlier.
 */

/** Field paths owned by each step, in the order the wizard presents them. */
const STEP_FIELDS: Record<number, { profile?: string[]; settings?: string[] }> =
  {
    0: { profile: ["weightKg", "heightCm", "age", "sex"] },
    1: {
      profile: [
        "activityFactor",
        "deficitKcal",
        "proteinPerKg",
        "fatPerKg",
        "trainingDays",
      ],
    },
    2: { settings: ["meals", "plannedMeals", "mainMeal"] },
    3: {
      settings: ["timezone", "shoppingDay", "repeatWindowWeeks"],
      profile: ["cookDays", "assemblyDays"],
    },
    // 4 is meal shapes, checked separately — it is an array, not named fields.
    5: { settings: ["cuisines"] },
  };

export interface StepProblem {
  /** Dotted field path, e.g. `plannedMeals`. Empty for whole-object issues. */
  field: string;
  message: string;
}

/**
 * Problems belonging to `step`, or an empty list when it is ready to leave.
 *
 * Issues for fields owned by *other* steps are deliberately ignored: blocking
 * step 0 because of something on step 5 would be worse than the failure this
 * replaces, since the offending field is not on screen to fix.
 */
export function validateStep(
  step: number,
  draft: { profile: unknown; settings: unknown; mealShapes: unknown[] },
): StepProblem[] {
  if (step === 4) {
    // The wizard collects at most three; the server's `.max(3)` agrees.
    if (draft.mealShapes.length > 3) {
      return [{ field: "mealShapes", message: "Keep this to three or fewer." }];
    }
    const bad = draft.mealShapes
      .map((shape, index) => ({
        index,
        result: wizardMealShapeSchema.safeParse(shape),
      }))
      .filter((entry) => !entry.result.success);

    return bad.map((entry) => ({
      field: `mealShapes.${entry.index}`,
      message:
        entry.result.success === false
          ? (entry.result.error.issues[0]?.message ?? "Not valid.")
          : "Not valid.",
    }));
  }

  const owned = STEP_FIELDS[step];
  if (!owned) return [];

  const problems: StepProblem[] = [];

  const collect = (
    schema: typeof profileSchema | typeof settingsSchema,
    value: unknown,
    fields: string[] | undefined,
  ) => {
    if (!fields) return;
    const result = schema.safeParse(value);
    if (result.success) return;

    for (const issue of result.error.issues) {
      const field = issue.path.join(".");
      // `startsWith` so an issue deep inside `plannedMeals.0` still attaches to
      // the step that owns `plannedMeals`.
      if (fields.some((f) => field === f || field.startsWith(`${f}.`))) {
        problems.push({ field, message: issue.message });
      }
    }
  };

  collect(profileSchema, draft.profile, owned.profile);
  collect(settingsSchema, draft.settings, owned.settings);

  return problems;
}

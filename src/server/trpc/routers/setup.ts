import { z } from "zod";
import { protectedProcedure, router } from "../init";
import {
  completeSetup,
  reopenSetup,
  getProfile,
  getSettings,
  updateProfile,
  updateSettings,
} from "~/server/db/state";
import { refreshScheduler } from "~/server/scheduler/cron";
import { isLlmConfigured } from "~/server/llm/client";
import { addConstraints, getDietaryConfig, listConstraints, removeConstraint } from "~/server/db/config";
import {
  computeMacroPlan,
  formulaTrace,
  perMealProtein,
  splitAcrossMeals,
} from "~/lib/macros";
import { mealTypeSchema, profileSchema, settingsSchema } from "~/lib/schemas";

/** What the wizard edits about a meal type — a subset of `meal_shape`. */
const wizardMealShapeSchema = z.object({
  mealType: mealTypeSchema,
  servings: z.number().int().min(1).max(12).nullable(),
  maxMinutes: z.number().int().min(0).max(240).nullable(),
});

/**
 * Replaces the `meal_shape` constraint for each meal type the wizard covers.
 *
 * The merge matters. The wizard only asks about servings and cook time, but a
 * `meal_shape` can also carry `minMinutes` and required closing-step phrases set
 * in Kitchen. Writing the wizard's view wholesale would silently delete those,
 * so anything it does not ask about is carried across from the existing rule.
 *
 * Meal types absent from the input are left alone rather than cleared — a
 * partial write should not look like a deletion.
 */
function writeMealShapes(shapes: z.infer<typeof wizardMealShapeSchema>[]): void {
  if (shapes.length === 0) return;

  const existing = listConstraints().filter((c) => c.constraint.kind === "meal_shape");
  const touched = new Set(shapes.map((s) => s.mealType));

  for (const row of existing) {
    if (row.constraint.kind !== "meal_shape") continue;
    if (touched.has(row.constraint.mealType)) removeConstraint(row.id);
  }

  addConstraints(
    shapes.map((shape) => {
      const previous = existing.find(
        (row) =>
          row.constraint.kind === "meal_shape" &&
          row.constraint.mealType === shape.mealType,
      )?.constraint;
      const carried =
        previous?.kind === "meal_shape"
          ? {
              minMinutes: previous.minMinutes,
              requiredFinalStepPhrases: previous.requiredFinalStepPhrases,
            }
          : { minMinutes: null, requiredFinalStepPhrases: [] };

      return {
        kind: "meal_shape" as const,
        mealType: shape.mealType,
        servings: shape.servings,
        maxMinutes: shape.maxMinutes,
        ...carried,
      };
    }),
  );
}

/**
 * Profile, settings, and the derived macro plan.
 *
 * Everything the Settings page and the first-run wizard need. The macro plan is
 * returned alongside the raw values so the page can render the formulas with
 * live numbers without duplicating the engine on the client.
 */
export const setupRouter = router({
  state: protectedProcedure.query(() => {
    const profile = getProfile();
    const settings = getSettings();
    const plan = computeMacroPlan(profile);

    return {
      profile,
      settings,
      plan,
      // Flattened to what the wizard edits. The wizard deliberately does not
      // surface `minMinutes` or the required closing-step phrases — those are
      // refinements, and round-tripping them through here would let the wizard
      // silently drop rules set in Kitchen.
      mealShapes: getDietaryConfig().mealShapes.map((shape) => ({
        mealType: shape.mealType,
        servings: shape.servings,
        maxMinutes: shape.maxMinutes,
      })),
      formulas: formulaTrace(profile, plan),
      perMealProtein: perMealProtein(plan, settings.meals.length),
      mealSplit: splitAcrossMeals(plan.training, settings.meals),
      llmConfigured: isLlmConfigured(),
    };
  }),

  /**
   * Live recomputation for the Settings page: the client sends the values
   * currently in the form and gets back the macro plan they would produce,
   * without saving anything. Keeps one implementation of the engine.
   */
  preview: protectedProcedure.input(profileSchema).query(({ input }) => {
    const plan = computeMacroPlan(input);
    const meals = getSettings().meals;
    return {
      plan,
      formulas: formulaTrace(input, plan),
      perMealProtein: perMealProtein(plan, meals.length),
      mealSplit: splitAcrossMeals(plan.training, meals),
    };
  }),

  saveProfile: protectedProcedure
    .input(profileSchema)
    .mutation(({ input }) => updateProfile(input)),

  saveSettings: protectedProcedure.input(settingsSchema).mutation(({ input }) => {
    const saved = updateSettings(input);
    // The generation day, time, or timezone may have moved.
    refreshScheduler();
    return saved;
  }),

  /** Completes the first-run wizard in one write. */
  completeWizard: protectedProcedure
    .input(
      z.object({
        profile: profileSchema,
        settings: settingsSchema,
        mealShapes: z.array(wizardMealShapeSchema).max(3).default([]),
      }),
    )
    .mutation(({ input }) => {
      updateProfile(input.profile);
      updateSettings(input.settings);
      writeMealShapes(input.mealShapes);
      completeSetup();
      refreshScheduler();
      return { profile: getProfile(), settings: getSettings() };
    }),

  /**
   * Re-opens the wizard.
   *
   * Only clears the completion flag — every value stays put, and the wizard
   * seeds each step from what is stored. Wiping the profile here would make
   * "change one meal shape" cost you everything else you had entered.
   */
  reopenWizard: protectedProcedure.mutation(() => {
    reopenSetup();
    return { ok: true };
  }),
});

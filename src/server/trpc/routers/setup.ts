import { z } from "zod";
import { protectedProcedure, router } from "../init";
import {
  completeSetup,
  getProfile,
  getSettings,
  updateProfile,
  updateSettings,
} from "~/server/db/state";
import { refreshScheduler } from "~/server/scheduler/cron";
import { isLlmConfigured } from "~/server/llm/client";
import { computeMacroPlan, formulaTrace, perMealProtein } from "~/lib/macros";
import { profileSchema, settingsSchema } from "~/lib/schemas";

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
      formulas: formulaTrace(profile, plan),
      perMealProtein: perMealProtein(plan),
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
    return {
      plan,
      formulas: formulaTrace(input, plan),
      perMealProtein: perMealProtein(plan),
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
    .input(z.object({ profile: profileSchema, settings: settingsSchema }))
    .mutation(({ input }) => {
      updateProfile(input.profile);
      updateSettings(input.settings);
      completeSetup();
      refreshScheduler();
      return { profile: getProfile(), settings: getSettings() };
    }),
});

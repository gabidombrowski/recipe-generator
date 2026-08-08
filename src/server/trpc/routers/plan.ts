import { z } from "zod";
import { protectedProcedure, router } from "../init";
import {
  assignSlot,
  excludedLower,
  flaggedTags,
  getRecipe,
  getSlot,
  getWeekSlots,
  latestSchedulerRuns,
  listLeftovers,
  listRecipes,
  recentRecipeIds,
  setSlotMealSource,
  weekExists,
  writeSlots,
} from "~/server/db/queries";
import { getProfile, getSettings } from "~/server/db/state";
import { getDietaryConfig } from "~/server/db/config";
import { runWeeklyGeneration } from "~/server/scheduler/run";
import { planWeekDeterministically } from "~/server/scheduler/deterministic";
import { deriveSlotRoles, eligibleMealTypes } from "~/server/scheduler/rules";
import { isLlmConfigured } from "~/server/llm/client";
import {
  addDays,
  dayOfWeekFor,
  daysBetween,
  todayInTimezone,
  weekStartFor,
} from "~/lib/days";
import { computeMacroPlan, isTrainingDay } from "~/lib/macros";
import { isoDateSchema, mealSourceSchema } from "~/lib/schemas";

/**
 * The Today and Weekly plan views.
 *
 * Day *type* (training vs rest) comes from the profile; day *role* (cook,
 * leftover, assembly, quick) comes from the plan slot, which the scheduler
 * derived from settings. Both are overridable — the role by editing the slot,
 * the type by a client-side toggle passed in as `trainingOverride`, because a
 * one-off swapped gym day should not require editing the profile.
 */

/** Fridge portions are next-day food. Past that, the badge turns into a warning. */
export const FRIDGE_SAFE_DAYS = 1;

function guidanceFor(role: string): string {
  switch (role) {
    case "cook":
      return "Cook day: pick a cook recipe, double it, refrigerate the second portion promptly.";
    case "leftover":
      return "Leftover day: eat yesterday's refrigerated portion.";
    case "assembly":
      return "Assembly day: no cooking — put something together from what's in the house.";
    default:
      return "Quick day: 5-10 minutes, one pan.";
  }
}

export const planRouter = router({
  today: protectedProcedure
    .input(
      z.object({
        /** Overrides the profile's training-day detection for today only. */
        trainingOverride: z.boolean().nullable().default(null),
        /** Lets the UI preview another date. */
        date: isoDateSchema.optional(),
      }),
    )
    .query(({ input }) => {
      const profile = getProfile();
      const settings = getSettings();
      const date = input.date ?? todayInTimezone(settings.timezone);
      const day = dayOfWeekFor(date);

      const training = input.trainingOverride ?? isTrainingDay(profile, day);
      const plan = computeMacroPlan(profile);
      const targets = training ? plan.training : plan.rest;

      const slot = getSlot(date);
      // Fall back to the derived role when the scheduler has not run yet.
      const derivedRole =
        deriveSlotRoles(weekStartFor(date, settings.generationDay), profile).find(
          (s) => s.date === date,
        )?.mealSource ?? "quick";
      const role = slot?.mealSource ?? derivedRole;

      const recipe = slot?.recipeId ? getRecipe(slot.recipeId) : null;

      const leftovers = listLeftovers().map((item) => {
        const ageDays = daysBetween(item.cookedDate, date);
        return {
          ...item,
          ageDays,
          // Freezer items never warn; fridge items warn the day after cooking.
          atRisk: item.storage === "fridge" && ageDays > FRIDGE_SAFE_DAYS,
          dueToday: item.storage === "fridge" && ageDays === FRIDGE_SAFE_DAYS,
        };
      });

      return {
        date,
        day,
        training,
        trainingIsOverridden: input.trainingOverride !== null,
        role,
        guidance: guidanceFor(role),
        targets,
        recipe,
        // Today's exposure to whatever the user's guidelines limit, counted
        // from what is actually planned.
        flaggedTags: flaggedTags(),
        flaggedIngredients:
          recipe?.ingredients
            .filter((i) => i.tags.some((t) => flaggedTags().includes(t.toLowerCase())))
            .map((i) => i.name) ?? [],
        leftovers,
        yesterdayWasCookDay:
          getSlot(addDays(date, -1))?.mealSource === "cook",
      };
    }),

  week: protectedProcedure
    .input(z.object({ weekStart: isoDateSchema.optional() }))
    .query(({ input }) => {
      const profile = getProfile();
      const settings = getSettings();
      const today = todayInTimezone(settings.timezone);
      const weekStart = input.weekStart ?? weekStartFor(today, settings.generationDay);

      const macroPlan = computeMacroPlan(profile);
      const slots = getWeekSlots(weekStart);
      const byDate = new Map(slots.map((s) => [s.date, s]));
      const derived = deriveSlotRoles(weekStart, profile);

      const days = derived.map(({ date, mealSource }) => {
        const slot = byDate.get(date);
        const role = slot?.mealSource ?? mealSource;
        const training = isTrainingDay(profile, dayOfWeekFor(date));
        return {
          date,
          day: dayOfWeekFor(date),
          isToday: date === today,
          training,
          targets: training ? macroPlan.training : macroPlan.rest,
          mealSource: role,
          derivedMealSource: mealSource,
          recipe: slot?.recipeId ? getRecipe(slot.recipeId) : null,
          eligibleMealTypes: eligibleMealTypes(role),
        };
      });

      return {
        weekStart,
        exists: weekExists(weekStart),
        days,
        flaggedTags: flaggedTags(),
        plannerMode: settings.plannerMode,
        llmConfigured: isLlmConfigured(),
        aiNovelRecipesPerWeek: settings.aiNovelRecipesPerWeek,
        lastRuns: latestSchedulerRuns(5),
      };
    }),

  assign: protectedProcedure
    .input(
      z.object({
        date: isoDateSchema,
        recipeId: z.number().int().positive().nullable(),
      }),
    )
    .mutation(({ input }) => {
      // Create the slot if the scheduler has not been here yet, so a user can
      // plan a week by hand without waiting for Sunday.
      if (!getSlot(input.date)) {
        const profile = getProfile();
        const settings = getSettings();
        const role =
          deriveSlotRoles(weekStartFor(input.date, settings.generationDay), profile).find(
            (s) => s.date === input.date,
          )?.mealSource ?? "quick";
        writeSlots([{ date: input.date, mealSource: role, recipeId: null }], true);
      }
      assignSlot(input.date, input.recipeId);
      return { ok: true };
    }),

  setMealSource: protectedProcedure
    .input(z.object({ date: isoDateSchema, mealSource: mealSourceSchema }))
    .mutation(({ input }) => {
      setSlotMealSource(input.date, input.mealSource);
      return { ok: true };
    }),

  /** "Generate week now" — the same code path the cron takes. */
  generateWeek: protectedProcedure
    .input(z.object({ weekStart: isoDateSchema.optional(), force: z.boolean().default(false) }))
    .mutation(async ({ input }) =>
      runWeeklyGeneration({
        weekStart: input.weekStart,
        force: input.force,
        trigger: "manual",
      }),
    ),

  /** Re-picks a single slot, leaving the rest of the week untouched. */
  regenerateSlot: protectedProcedure
    .input(z.object({ date: isoDateSchema }))
    .mutation(({ input }) => {
      const profile = getProfile();
      const settings = getSettings();
      const weekStart = weekStartFor(input.date, settings.generationDay);

      // Everything else in the week counts as "recently used" so the swap
      // cannot duplicate a dish already on the board.
      const used = new Set(
        getWeekSlots(weekStart)
          .filter((s) => s.date !== input.date && s.recipeId !== null)
          .map((s) => s.recipeId!),
      );
      for (const id of recentRecipeIds(weekStart, settings.repeatWindowWeeks)) {
        used.add(id);
      }

      const current = getSlot(input.date);
      if (current?.recipeId) used.add(current.recipeId);

      const plan = planWeekDeterministically({
        weekStart,
        profile,
        settings,
        recipes: listRecipes(),
        excludedLower: excludedLower(),
        recentRecipeIds: used,
        config: getDietaryConfig(),
      });

      const replacement = plan.slots.find((s) => s.date === input.date);
      if (!replacement || replacement.recipeId === null) {
        return { ok: false as const, message: "No other recipe fits this slot." };
      }

      assignSlot(input.date, replacement.recipeId);
      return { ok: true as const, recipeId: replacement.recipeId };
    }),

  schedulerRuns: protectedProcedure.query(() => latestSchedulerRuns(20)),
});

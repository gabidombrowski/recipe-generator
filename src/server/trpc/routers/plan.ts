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
  weekIsPlanned,
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
  weekDates,
  weekStartFor,
} from "~/lib/days";
import {
  computeMacroPlan,
  isTrainingDay,
  splitAcrossMeals,
} from "~/lib/macros";
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
    case "eat_out":
      return "Eating out: a restaurant, a party, someone else's table. Nothing to plan, nothing to buy — the targets stay as a reference, not a rule.";
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

      // One entry per planned meal. The derived roles are the fallback for any
      // meal the scheduler has not written a slot for yet.
      const derived = deriveSlotRoles(
        weekStartFor(date, settings.generationDay),
        profile,
        { meals: settings.plannedMeals, mainMeal: settings.mainMeal },
      ).filter((s) => s.date === date);

      const meals = settings.plannedMeals.map((meal) => {
        const slot = getSlot(date, meal);
        const role =
          slot?.mealSource ??
          derived.find((d) => d.meal === meal)?.mealSource ??
          "quick";
        const mealRecipe = slot?.recipeId ? getRecipe(slot.recipeId) : null;
        return {
          meal,
          isMain: meal === settings.mainMeal,
          role,
          guidance: guidanceFor(role),
          recipe: mealRecipe,
          eligibleMealTypes: eligibleMealTypes(role),
        };
      });

      // The main meal still drives the page's headline state, so existing
      // callers keep working while the UI grows a per-meal view.
      const main = meals.find((m) => m.isMain) ?? meals[0];
      const role = main?.role ?? "quick";
      const recipe = main?.recipe ?? null;

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
        meals,
        mainMeal: settings.mainMeal,
        /** Each planned meal's share of the day, split evenly. */
        mealTargets: splitAcrossMeals(targets, settings.meals),
        // Today's exposure to whatever the user's guidelines limit, counted
        // from what is actually planned.
        flaggedTags: flaggedTags(),
        flaggedIngredients:
          recipe?.ingredients
            .filter((i) =>
              i.tags.some((t) => flaggedTags().includes(t.toLowerCase())),
            )
            .map((i) => i.name) ?? [],
        leftovers,
        yesterdayWasCookDay:
          getSlot(addDays(date, -1), settings.mainMeal)?.mealSource === "cook",
      };
    }),

  /**
   * The next day that still needs a recipe, starting from today.
   *
   * This is what "use it for my next meal" resolves to. Leftover days are
   * skipped because they are eaten from the fridge and never hold a recipe —
   * queueing into one would look like it worked and change nothing.
   *
   * Searches two weeks: the current one and the next, so the answer does not
   * become "nothing" merely because today is Saturday.
   */
  nextOpenSlot: protectedProcedure.query(() => {
    const profile = getProfile();
    const settings = getSettings();
    const today = todayInTimezone(settings.timezone);
    const thisWeek = weekStartFor(today, settings.generationDay);

    const options = {
      meals: settings.plannedMeals,
      mainMeal: settings.mainMeal,
    };
    const candidates = [
      ...deriveSlotRoles(thisWeek, profile, options),
      ...deriveSlotRoles(addDays(thisWeek, 7), profile, options),
    ].filter((slot) => slot.date >= today);

    for (const { date, meal, mealSource: derivedRole } of candidates) {
      const slot = getSlot(date, meal);
      const role = slot?.mealSource ?? derivedRole;
      if (role === "leftover") continue;
      if (slot?.recipeId) continue;
      return { date, meal, day: dayOfWeekFor(date), mealSource: role };
    }
    return null;
  }),

  week: protectedProcedure
    .input(z.object({ weekStart: isoDateSchema.optional() }))
    .query(({ input }) => {
      const profile = getProfile();
      const settings = getSettings();
      const today = todayInTimezone(settings.timezone);
      const weekStart =
        input.weekStart ?? weekStartFor(today, settings.generationDay);

      const macroPlan = computeMacroPlan(profile);
      const slots = getWeekSlots(weekStart);
      // Keyed on date *and* meal. A `date -> slot` map silently kept whichever
      // slot happened to come last once a day could hold more than one.
      const byKey = new Map(slots.map((s) => [`${s.date}|${s.meal}`, s]));
      const derived = deriveSlotRoles(weekStart, profile, {
        meals: settings.plannedMeals,
        mainMeal: settings.mainMeal,
      });

      const days = weekDates(weekStart).map((date) => {
        const training = isTrainingDay(profile, dayOfWeekFor(date));
        const targets = training ? macroPlan.training : macroPlan.rest;

        const meals = derived
          .filter((d) => d.date === date)
          .map(({ meal, mealSource }) => {
            const slot = byKey.get(`${date}|${meal}`);
            const role = slot?.mealSource ?? mealSource;
            return {
              meal,
              isMain: meal === settings.mainMeal,
              mealSource: role,
              derivedMealSource: mealSource,
              recipe: slot?.recipeId ? getRecipe(slot.recipeId) : null,
              eligibleMealTypes: eligibleMealTypes(role),
            };
          });

        // The main meal's values stay at the top level so the grid, the
        // generator's day picker and the e2e selectors keep working while the
        // per-meal view is `meals`.
        const main = meals.find((m) => m.isMain) ?? meals[0];

        return {
          date,
          day: dayOfWeekFor(date),
          isToday: date === today,
          training,
          targets,
          mealTargets: splitAcrossMeals(targets, settings.meals),
          meals,
          mealSource: main?.mealSource ?? "quick",
          derivedMealSource: main?.derivedMealSource ?? "quick",
          recipe: main?.recipe ?? null,
          eligibleMealTypes: main?.eligibleMealTypes ?? [],
        };
      });

      return {
        weekStart,
        exists: weekIsPlanned(weekStart),
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
        /** Defaults to the main meal, so existing callers keep working. */
        meal: z.string().min(1).max(40).optional(),
        recipeId: z.number().int().positive().nullable(),
      }),
    )
    .mutation(({ input }) => {
      const settings = getSettings();
      const meal = input.meal ?? settings.mainMeal;

      // Create the slot if the scheduler has not been here yet, so a user can
      // plan a week by hand without waiting for Sunday.
      if (!getSlot(input.date, meal)) {
        const profile = getProfile();
        const role =
          deriveSlotRoles(
            weekStartFor(input.date, settings.generationDay),
            profile,
            {
              meals: settings.plannedMeals,
              mainMeal: settings.mainMeal,
            },
          ).find((s) => s.date === input.date && s.meal === meal)?.mealSource ??
          "quick";
        writeSlots(
          [{ date: input.date, meal, mealSource: role, recipeId: null }],
          true,
        );
      }
      assignSlot(input.date, meal, input.recipeId);
      return { ok: true };
    }),

  setMealSource: protectedProcedure
    .input(
      z.object({
        date: isoDateSchema,
        /** Defaults to the main meal, which is what the Today page edits. */
        meal: z.string().min(1).max(40).optional(),
        mealSource: mealSourceSchema,
      }),
    )
    .mutation(({ input }) => {
      setSlotMealSource(
        input.date,
        input.meal ?? getSettings().mainMeal,
        input.mealSource,
      );
      return { ok: true };
    }),

  /** "Generate week now" — the same code path the cron takes. */
  generateWeek: protectedProcedure
    .input(
      z.object({
        weekStart: isoDateSchema.optional(),
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) =>
      runWeeklyGeneration({
        weekStart: input.weekStart,
        force: input.force,
        trigger: "manual",
      }),
    ),

  /** Re-picks a single slot, leaving the rest of the week untouched. */
  regenerateSlot: protectedProcedure
    .input(
      z.object({
        date: isoDateSchema,
        meal: z.string().min(1).max(40).optional(),
      }),
    )
    .mutation(({ input }) => {
      const profile = getProfile();
      const settings = getSettings();
      const weekStart = weekStartFor(input.date, settings.generationDay);

      // Everything else in the week counts as "recently used" so the swap
      // cannot duplicate a dish already on the board.
      const meal = input.meal ?? settings.mainMeal;
      const used = new Set(
        getWeekSlots(weekStart)
          .filter(
            (s) =>
              !(s.date === input.date && s.meal === meal) &&
              s.recipeId !== null,
          )
          .map((s) => s.recipeId!),
      );
      for (const id of recentRecipeIds(weekStart, settings.repeatWindowWeeks)) {
        used.add(id);
      }

      const current = getSlot(input.date, meal);
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

      const replacement = plan.slots.find(
        (s) => s.date === input.date && s.meal === meal,
      );
      if (!replacement || replacement.recipeId === null) {
        return {
          ok: false as const,
          message: "No other recipe fits this slot.",
        };
      }

      assignSlot(input.date, meal, replacement.recipeId);
      return { ok: true as const, recipeId: replacement.recipeId };
    }),

  schedulerRuns: protectedProcedure.query(() => latestSchedulerRuns(20)),
});

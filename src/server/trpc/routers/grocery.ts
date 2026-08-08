import { z } from "zod";
import { protectedProcedure, router } from "../init";
import {
  checkedLineKeys,
  flaggedTags,
  clearChecks,
  excludedLower,
  getWeekMeals,
  listPantry,
  setLineChecked,
} from "~/server/db/queries";
import { getSettings } from "~/server/db/state";
import { buildGroceryList, groceryListToText } from "~/server/grocery";
import { todayInTimezone, weekStartFor } from "~/lib/days";
import { isoDateSchema } from "~/lib/schemas";

/**
 * The grocery list.
 *
 * Every read rebuilds the list from the current plan, so an assignment made a
 * second ago is already reflected. There is no generate step and nothing to
 * invalidate.
 */
export const groceryRouter = router({
  list: protectedProcedure
    .input(z.object({ weekStart: isoDateSchema.optional() }).default({}))
    .query(({ input }) => {
      const settings = getSettings();
      const weekStart =
        input.weekStart ??
        weekStartFor(todayInTimezone(settings.timezone), settings.generationDay);

      return buildGroceryList({
        weekStart,
        settings,
        meals: getWeekMeals(weekStart),
        excluded: excludedLower(),
        pantryStaples: listPantry(),
        flaggedTags: flaggedTags(),
        checkedKeys: checkedLineKeys(weekStart),
      });
    }),

  asText: protectedProcedure
    .input(z.object({ weekStart: isoDateSchema.optional() }).default({}))
    .query(({ input }) => {
      const settings = getSettings();
      const weekStart =
        input.weekStart ??
        weekStartFor(todayInTimezone(settings.timezone), settings.generationDay);

      return groceryListToText(
        buildGroceryList({
          weekStart,
          settings,
          meals: getWeekMeals(weekStart),
          excluded: excludedLower(),
          pantryStaples: listPantry(),
          flaggedTags: flaggedTags(),
          checkedKeys: checkedLineKeys(weekStart),
        }),
      );
    }),

  setChecked: protectedProcedure
    .input(
      z.object({
        weekStart: isoDateSchema,
        key: z.string().min(1),
        checked: z.boolean(),
      }),
    )
    .mutation(({ input }) => {
      setLineChecked(input.weekStart, input.key, input.checked);
      return { ok: true };
    }),

  clearChecks: protectedProcedure
    .input(z.object({ weekStart: isoDateSchema }))
    .mutation(({ input }) => {
      clearChecks(input.weekStart);
      return { ok: true };
    }),
});

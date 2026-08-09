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
import { getDietaryConfig } from "~/server/db/config";
import { buildGroceryList, groceryListToMarkdown, groceryListToText } from "~/server/grocery";
import { todayInTimezone, weekStartFor } from "~/lib/days";
import { isoDateSchema } from "~/lib/schemas";

/**
 * The grocery list.
 *
 * Every read rebuilds the list from the current plan, so an assignment made a
 * second ago is already reflected. There is no generate step and nothing to
 * invalidate.
 */

const weekInput = z.object({ weekStart: isoDateSchema.optional() }).default({});

/**
 * Builds the list for a week, defaulting to the current one.
 *
 * All three read procedures need exactly this, and the two that render it would
 * otherwise each restate the eight-argument call — where a divergence (one
 * forgetting `checkedKeys`, say) would show up only as an export that quietly
 * disagrees with the screen.
 */
function listFor(weekStart?: string) {
  const settings = getSettings();
  const config = getDietaryConfig();
  const resolved =
    weekStart ?? weekStartFor(todayInTimezone(settings.timezone), settings.generationDay);

  return buildGroceryList({
    weekStart: resolved,
    settings,
    // Only the meals currently planned. Slots for a meal that has since been
    // un-planned stay in the table — deleting a user's plan because they
    // unticked a checkbox would be worse — but their food must not keep
    // appearing on the shopping list.
    meals: getWeekMeals(resolved, settings.plannedMeals),
    excluded: excludedLower(),
    pantryStaples: listPantry(),
    flaggedTags: flaggedTags(),
    dailyStaples: config.dailyStaples,
    mealShapes: config.mealShapes,
    checkedKeys: checkedLineKeys(resolved),
  });
}

export const groceryRouter = router({
  list: protectedProcedure
    .input(weekInput)
    .query(({ input }) => listFor(input.weekStart)),

  /**
   * The list as copyable text, in whichever format the settings ask for.
   *
   * Resolving the format here rather than exposing one procedure per format
   * keeps the page down to a single button: the client copies what it is given
   * and only needs the format to label the control.
   */
  copyText: protectedProcedure.input(weekInput).query(({ input }) => {
    const format = getSettings().groceryCopyFormat;
    const list = listFor(input.weekStart);
    return {
      format,
      content: format === "markdown" ? groceryListToMarkdown(list) : groceryListToText(list),
    };
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

import { addDays, type IsoDate } from "~/lib/days";
import { planPortions, slotKey, type ServingSlot } from "~/lib/servings";
import { type Profile, type Settings } from "~/lib/schemas";
import { getWeekSlots } from "~/server/db/queries";
import { deriveSlotRoles } from "~/server/scheduler/rules";

/**
 * The portion plan for a week, as both the Week page and the grocery list see
 * it.
 *
 * Built over three weeks — the one before, this one, and the one after — so a
 * leftover day on the first morning can name the cook day it came from, and a
 * cook day on the last evening can count the leftover day just past the
 * boundary. A slot the scheduler has not written yet takes its derived role,
 * the same fallback every other plan view uses.
 */
export function weekPortions(
  weekStart: IsoDate,
  profile: Pick<Profile, "cookDays" | "assemblyDays">,
  settings: Pick<Settings, "plannedMeals" | "mainMeal" | "mealServings">,
) {
  const planned = new Set(settings.plannedMeals);
  const slots: ServingSlot[] = [];

  for (const start of [addDays(weekStart, -7), weekStart, addDays(weekStart, 7)]) {
    const stored = new Map(
      getWeekSlots(start).map((s) => [slotKey(s.date, s.meal), s]),
    );
    for (const derived of deriveSlotRoles(start, profile, {
      meals: settings.plannedMeals,
      mainMeal: settings.mainMeal,
    })) {
      if (!planned.has(derived.meal)) continue;
      const slot = stored.get(slotKey(derived.date, derived.meal));
      slots.push({
        date: derived.date,
        meal: derived.meal,
        mealSource: slot?.mealSource ?? derived.mealSource,
        servings: slot?.servings ?? null,
      });
    }
  }

  return planPortions(slots, settings.mealServings);
}

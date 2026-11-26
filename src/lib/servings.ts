import { addDays, type IsoDate } from "~/lib/days";
import { type MealSource } from "~/lib/schemas";

/**
 * How many portions each slot needs, including the ones cooked for later.
 *
 * Every slot has a plate count: the people eating that meal, from the slot's
 * own override or else the meal's default (Settings), or 1. A cook day then
 * cooks for itself *plus* every leftover day that eats from it — the run of
 * consecutive leftover days for the same meal that follows it. Change a
 * leftover day to two people and the cook day before it, and the shopping
 * list, both grow by two.
 *
 * This replaces the fixed "a cook day is two servings" rule, which was only
 * ever right for one person with exactly one leftover day.
 */

export interface ServingSlot {
  date: IsoDate;
  meal: string;
  mealSource: MealSource;
  /** The slot's own override; null falls back to the meal default. */
  servings: number | null;
}

export interface PortionPlan {
  /** People eating this slot. */
  eat: number;
  /** Extra portions cooked today for later leftover days (cook slots only). */
  leftover: number;
  /** Portions to cook and buy for: `eat + leftover` on a cook day, else `eat`. */
  total: number;
  /** The leftover days this cook day feeds, in order. */
  leftoverDates: IsoDate[];
  /** For a leftover slot, the cook day it eats from, if there is one. */
  cookedOn: IsoDate | null;
}

export const slotKey = (date: IsoDate, meal: string) => `${date}|${meal}`;

export function defaultServingsFor(
  meal: string,
  mealServings: Readonly<Record<string, number>>,
): number {
  return mealServings[meal] ?? 1;
}

/**
 * Plans portions for a run of slots. Pass every slot that could be a leftover
 * of a cook day you care about — for a week, include the first days of the
 * next week, or a Saturday cook day feeding Sunday would not see Sunday.
 */
export function planPortions(
  slots: readonly ServingSlot[],
  mealServings: Readonly<Record<string, number>>,
): Map<string, PortionPlan> {
  const byKey = new Map(slots.map((s) => [slotKey(s.date, s.meal), s]));
  const eatFor = (slot: ServingSlot) =>
    slot.mealSource === "eat_out"
      ? 0
      : (slot.servings ?? defaultServingsFor(slot.meal, mealServings));

  const plans = new Map<string, PortionPlan>();
  for (const slot of slots) {
    const eat = eatFor(slot);
    const plan: PortionPlan = {
      eat,
      leftover: 0,
      total: eat,
      leftoverDates: [],
      cookedOn: null,
    };

    if (slot.mealSource === "cook") {
      for (let day = addDays(slot.date, 1); ; day = addDays(day, 1)) {
        const next = byKey.get(slotKey(day, slot.meal));
        if (next?.mealSource !== "leftover") break;
        plan.leftover += eatFor(next);
        plan.leftoverDates.push(day);
      }
      plan.total = eat + plan.leftover;
    }

    if (slot.mealSource === "leftover") {
      for (let day = addDays(slot.date, -1); ; day = addDays(day, -1)) {
        const previous = byKey.get(slotKey(day, slot.meal));
        if (previous?.mealSource === "cook") plan.cookedOn = day;
        if (previous?.mealSource !== "leftover") break;
      }
    }

    plans.set(slotKey(slot.date, slot.meal), plan);
  }
  return plans;
}

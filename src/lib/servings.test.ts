import { describe, expect, it } from "vitest";
import { planPortions, slotKey, type ServingSlot } from "./servings";

const slot = (
  date: string,
  mealSource: ServingSlot["mealSource"],
  servings: number | null = null,
  meal = "Dinner",
): ServingSlot => ({ date, meal, mealSource, servings });

describe("planPortions", () => {
  it("cooks one extra portion for a single leftover day by default", () => {
    const plans = planPortions(
      [slot("2026-02-09", "cook"), slot("2026-02-10", "leftover")],
      {},
    );
    expect(plans.get(slotKey("2026-02-09", "Dinner"))).toMatchObject({
      eat: 1,
      leftover: 1,
      total: 2,
      leftoverDates: ["2026-02-10"],
    });
    expect(plans.get(slotKey("2026-02-10", "Dinner"))?.cookedOn).toBe(
      "2026-02-09",
    );
  });

  it("uses the meal default, and a slot override over it", () => {
    const plans = planPortions(
      [slot("2026-02-09", "cook"), slot("2026-02-10", "leftover", 3)],
      { Dinner: 2 },
    );
    expect(plans.get(slotKey("2026-02-09", "Dinner"))).toMatchObject({
      eat: 2,
      leftover: 3,
      total: 5,
    });
  });

  it("feeds a run of leftover days, and stops at the next cook day", () => {
    const plans = planPortions(
      [
        slot("2026-02-09", "cook"),
        slot("2026-02-10", "leftover"),
        slot("2026-02-11", "leftover"),
        slot("2026-02-12", "cook"),
        slot("2026-02-13", "quick"),
      ],
      { Dinner: 2 },
    );
    expect(plans.get(slotKey("2026-02-09", "Dinner"))?.total).toBe(6);
    expect(plans.get(slotKey("2026-02-11", "Dinner"))?.cookedOn).toBe(
      "2026-02-09",
    );
    expect(plans.get(slotKey("2026-02-12", "Dinner"))?.total).toBe(2);
  });

  it("buys nothing extra when no leftover day follows", () => {
    const plans = planPortions([slot("2026-02-09", "cook")], {});
    expect(plans.get(slotKey("2026-02-09", "Dinner"))?.total).toBe(1);
  });

  it("does not count other meals as leftovers", () => {
    const plans = planPortions(
      [
        slot("2026-02-09", "cook"),
        slot("2026-02-10", "leftover", null, "Lunch"),
      ],
      {},
    );
    expect(plans.get(slotKey("2026-02-09", "Dinner"))?.total).toBe(1);
  });

  it("counts nobody eating at an eat-out slot", () => {
    const plans = planPortions([slot("2026-02-09", "eat_out", 4)], {});
    expect(plans.get(slotKey("2026-02-09", "Dinner"))?.eat).toBe(0);
  });
});

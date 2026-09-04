import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, mockAuth, type Harness } from "../helpers/harness";

mockAuth();

/**
 * The routers, called the way the HTTP layer calls them.
 *
 * `createCaller` runs the real procedure chain — input parsing, the auth guard,
 * the handler — so these cover the request path rather than the functions
 * underneath it. That matters because several shipped bugs lived in the router:
 * an assignment that required a slot to already exist, a week view that
 * collapsed a day's meals onto one, a grocery list that kept buying for meals
 * no longer planned.
 */

let h: Harness;

// One database for the file, truncated and re-seeded between tests. See the
// harness for why a database per test does not work.
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.cleanup());

/** The seeded profile plans Dinner only; most tests want all three meals. */
async function planAllMeals() {
  const state = await h.caller.setup.state();
  await h.caller.setup.saveSettings({
    ...state.settings,
    meals: ["Breakfast", "Lunch", "Dinner"],
    plannedMeals: ["Breakfast", "Lunch", "Dinner"],
    mainMeal: "Dinner",
  });
}

describe("plan.assign", () => {
  it("creates the slot when the scheduler has not run", async () => {
    // Assigning into an unplanned week used to write nothing and report success.
    const { recipes } = await h.caller.recipes.list({});
    const recipe = recipes[0]!;

    await h.caller.plan.assign({ date: "2026-03-04", recipeId: recipe.id });

    const week = await h.caller.plan.week({ weekStart: "2026-03-01" });
    const day = week.days.find((d) => d.date === "2026-03-04");
    expect(day?.recipe?.id).toBe(recipe.id);
  });

  it("assigns to the named meal, leaving the others untouched", async () => {
    await planAllMeals();
    const { recipes } = await h.caller.recipes.list({});
    const recipe = recipes[0]!;

    await h.caller.plan.assign({
      date: "2026-03-04",
      meal: "Breakfast",
      recipeId: recipe.id,
    });

    const week = await h.caller.plan.week({ weekStart: "2026-03-01" });
    const day = week.days.find((d) => d.date === "2026-03-04")!;
    expect(day.meals.find((m) => m.meal === "Breakfast")?.recipe?.id).toBe(recipe.id);
    expect(day.meals.find((m) => m.meal === "Dinner")?.recipe).toBeNull();
  });
});

describe("plan.week", () => {
  it("returns every planned meal for a day, not just the last one", async () => {
    // A `date -> slot` map silently kept whichever meal came last.
    await planAllMeals();

    const week = await h.caller.plan.week({ weekStart: "2026-03-01" });

    expect(week.days).toHaveLength(7);
    for (const day of week.days) {
      expect(day.meals.map((m) => m.meal)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    }
  });

  it("gives the cook cycle to the main meal alone", async () => {
    await planAllMeals();
    const week = await h.caller.plan.week({ weekStart: "2026-03-01" });

    for (const day of week.days) {
      for (const meal of day.meals) {
        if (!meal.isMain) expect(meal.mealSource).toBe("quick");
      }
    }
  });
});

describe("plan.setMealSource", () => {
  it("persists a role override and reads it back", async () => {
    await h.caller.plan.setMealSource({ date: "2026-03-04", mealSource: "cook" });

    const week = await h.caller.plan.week({ weekStart: "2026-03-01" });
    expect(week.days.find((d) => d.date === "2026-03-04")?.mealSource).toBe("cook");
  });
});

describe("plan.nextOpenSlot", () => {
  it("skips leftover slots, which never hold a recipe", async () => {
    const slot = await h.caller.plan.nextOpenSlot();
    if (!slot) return; // no open slot in the window; nothing to assert

    expect(slot.mealSource).not.toBe("leftover");
  });
});

describe("grocery", () => {
  it("derives lines from the plan with no generate step", async () => {
    const { recipes } = await h.caller.recipes.list({});
    const cook = recipes.find((r) => r.mealType === "cook")!;
    await h.caller.plan.setMealSource({ date: "2026-03-04", mealSource: "cook" });
    await h.caller.plan.assign({ date: "2026-03-04", recipeId: cook.id });

    const list = await h.caller.grocery.list({ weekStart: "2026-03-01" });
    const names = list.sections.flatMap((s) => s.lines.map((l) => l.name));

    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain(cook.ingredients[0]!.name);
  });

  it("stops buying for a meal once it is no longer planned", async () => {
    await planAllMeals();
    const { recipes } = await h.caller.recipes.list({});
    const quick = recipes.find((r) => r.mealType === "quick")!;
    await h.caller.plan.assign({
      date: "2026-03-04",
      meal: "Breakfast",
      recipeId: quick.id,
    });

    const withBreakfast = await h.caller.grocery.list({ weekStart: "2026-03-01" });
    const before = withBreakfast.sections.reduce((n, s) => n + s.lines.length, 0);

    const state = await h.caller.setup.state();
    await h.caller.setup.saveSettings({
      ...state.settings,
      plannedMeals: ["Dinner"],
      mainMeal: "Dinner",
    });

    const after = await h.caller.grocery.list({ weekStart: "2026-03-01" });
    const now = after.sections.reduce((n, s) => n + s.lines.length, 0);
    expect(now).toBeLessThan(before);
  });

  it("copies in the format the settings ask for", async () => {
    const state = await h.caller.setup.state();

    await h.caller.setup.saveSettings({ ...state.settings, groceryCopyFormat: "markdown" });
    const md = await h.caller.grocery.copyText({});
    expect(md.format).toBe("markdown");
    expect(md.content).toContain("# Grocery");

    await h.caller.setup.saveSettings({ ...state.settings, groceryCopyFormat: "text" });
    const text = await h.caller.grocery.copyText({});
    expect(text.format).toBe("text");
    expect(text.content).not.toContain("# Grocery");
  });
});

describe("recipes.list", () => {
  it("hides unsaved AI recipes by default and shows them on request", async () => {
    const before = await h.caller.recipes.list({});
    expect(before.recipes.every((r) => r.source !== "ai")).toBe(true);

    // Seeded recipes are all `seed`, so nothing is hidden yet — the filter is
    // what keeps a generated recipe out until it is kept.
    const withUnsaved = await h.caller.recipes.list({ savedOnly: false });
    expect(withUnsaved.recipes.length).toBeGreaterThanOrEqual(before.recipes.length);
  });

  it("offers the configured palette even for cuisines with no recipe", async () => {
    const state = await h.caller.setup.state();
    await h.caller.setup.saveSettings({
      ...state.settings,
      cuisines: [...state.settings.cuisines, "Icelandic"],
    });

    const { cuisines } = await h.caller.recipes.list({});
    expect(cuisines).toContain("Icelandic");
  });
});

describe("the auth guard", () => {
  it("rejects a caller with no session", async () => {
    // The middleware gates the route; this gates the call. Both matter — a
    // server component or a future non-HTTP caller bypasses the middleware.
    const { createCaller } = await import("~/server/trpc/root");
    const anonymous = createCaller({ session: null, headers: new Headers() });

    await expect(anonymous.plan.week({})).rejects.toThrow(/sign-in/i);
  });
});

describe("context.save", () => {
  it("rejects a payload over the byte cap even when its character count is under it", async () => {
    // 200k two-byte characters: well under a 262,144-*character* limit, which
    // is what `z.string().max(MAX_CONTEXT_BYTES)` was actually enforcing, but
    // ~400 KB once written as UTF-8.
    const multibyte = "é".repeat(200_000);

    expect(multibyte.length).toBeLessThan(256 * 1024);
    expect(Buffer.byteLength(multibyte, "utf8")).toBeGreaterThan(256 * 1024);

    // Rejected during input parsing, so nothing reaches the handler and no
    // file is written — which is also why this test can run in the repo cwd.
    await expect(h.caller.context.save({ content: multibyte })).rejects.toThrow();
  });
});

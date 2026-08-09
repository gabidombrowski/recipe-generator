import { expect, test } from "@playwright/test";

/**
 * Three smoke tests, each covering a failure that would be silent and serious.
 */

test.describe("auth gate", () => {
  // No storage state: this context is genuinely signed out.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirects an unauthenticated visitor to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByRole("button", { name: /continue with github/i })).toBeVisible();
  });

  test("rejects unauthenticated API calls without redirecting", async ({ request }) => {
    // An API caller should get a status it can act on, not an HTML login page.
    const response = await request.get("/api/trpc/plan.week?input=%7B%7D");
    expect(response.status()).toBe(401);
  });

  test("leaves /healthz open for probes", async ({ request }) => {
    const response = await request.get("/healthz");
    expect(response.ok()).toBe(true);
    expect((await response.json()).status).toBe("ok");
  });
});

test.describe("signed in", () => {
  test("completes setup, generates a week, and updates the grocery list", async ({ page }) => {
    // ---- Setup ------------------------------------------------------------
    //
    // Which path this takes is environment-dependent, and legitimately so: on a
    // machine with a gitignored `seed.local.json` the seeder applies it and
    // marks setup complete, while CI has no such file and gets the wizard.
    // Both are correct, so the test exercises whichever it lands on rather than
    // pinning behaviour that varies by design.
    await page.goto("/");

    if (new URL(page.url()).pathname === "/setup") {
      // Walk to the last step rather than clicking a fixed number of times, so
      // adding a wizard step does not silently turn this into a test that
      // finishes setup from halfway through.
      // `exact` matters: the default is a substring match, which also catches a
      // day-picker button on the profile step and trips strict mode.
      const next = page.getByRole("button", { name: "Next", exact: true });

      // Wait for the wizard to actually render before testing visibility. It
      // shows a spinner while it loads stored settings, and `isVisible()` does
      // not wait — so without this the loop evaluated false on the spinner,
      // walked zero steps, and passed by doing nothing.
      await next.waitFor({ state: "visible" });
      while (await next.isVisible()) await next.click();

      // Every step must have been reachable, and the last one must show live
      // macro arithmetic rather than a stub.
      await expect(page.getByText(/BMR \(Mifflin-St Jeor\)/)).toBeVisible();
      await page.getByRole("button", { name: "Finish setup" }).click();
    }

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // ---- Day role override survives a reload --------------------------------
    //
    // This runs before any week is generated, so there is no plan_slots row for
    // today — the precondition under which the override used to be written by a
    // bare UPDATE, match zero rows, report success, and silently revert.
    // Matches by prefix: the label now names the meal, and the page shows one
    // select per planned meal. `.first()` is the main meal.
    const roleSelect = page.getByLabel(/Override the day role for/).first();
    const otherRole = (await roleSelect.inputValue()) === "cook" ? "quick" : "cook";
    await roleSelect.selectOption(otherRole);

    // Wait for the guidance to follow the new role before reloading. The select
    // is controlled by the query, so this only changes once the mutation has
    // landed and the refetch has come back — `selectOption` alone returns as
    // soon as the DOM event is dispatched, and the reload would then race the
    // in-flight write.
    await expect(
      page.getByText(otherRole === "cook" ? /^Cook day:/ : /^Quick day:/),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/Override the day role for/).first()).toHaveValue(
      otherRole,
    );

    // ---- Week generation --------------------------------------------------
    await page.goto("/week");
    // The heading is the page noun; the week it is actually showing moved into
    // the subtitle. Both are asserted — a hardcoded title alone would still
    // pass if the date never rendered.
    await expect(page.getByRole("heading", { name: /^Week$/ })).toBeVisible();
    // Long form, e.g. "Of August 2, 2026" — dates stay ISO in the database and
    // on the wire, and are formatted only at the point of display.
    await expect(page.getByText(/Of [A-Z][a-z]+ \d{1,2}, \d{4}/)).toBeVisible();

    await page.getByRole("button", { name: "Generate week now" }).click();
    // `skipped` is a legitimate outcome — it means the week was already planned
    // and the run was correctly idempotent. The assertion that matters is the
    // one below: that the week actually ends up planned.
    await expect(page.getByText(/^(success|skipped):/)).toBeVisible({ timeout: 30_000 });

    const selects = page.locator('select[aria-label^="Recipe for"]');
    await expect(selects.first()).toBeVisible();
    const assigned = await selects.evaluateAll(
      (nodes) => nodes.filter((n) => (n as HTMLSelectElement).value !== "").length,
    );
    expect(assigned).toBeGreaterThan(0);

    // ---- Grocery list reacts to a plan change -----------------------------
    await page.goto("/grocery");
    await expect(page.getByRole("heading", { name: /^Grocery$/ })).toBeVisible();
    await expect(page.getByText(/Shopping day:/)).toBeVisible();
    const before = await page.getByRole("checkbox").count();
    expect(before).toBeGreaterThan(0);

    // Clear one slot; the derived list must shrink without any regenerate step.
    await page.goto("/week");
    const firstAssigned = selects.filter({ has: page.locator("option:checked:not([value=''])") }).first();
    await firstAssigned.selectOption("");

    await page.goto("/grocery");
    await expect
      .poll(async () => page.getByRole("checkbox").count(), { timeout: 15_000 })
      .toBeLessThan(before);
  });
});

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
      await page.getByRole("button", { name: "Next" }).click(); // profile defaults
      await page.getByRole("button", { name: "Next" }).click(); // schedule defaults
      // The wizard's third step must show live macro arithmetic, not a stub.
      await expect(page.getByText(/BMR \(Mifflin-St Jeor\)/)).toBeVisible();
      await page.getByRole("button", { name: "Finish setup" }).click();
    }

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // ---- Week generation --------------------------------------------------
    await page.goto("/week");
    await expect(page.getByRole("heading", { name: /Week of/ })).toBeVisible();

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
    await expect(page.getByRole("heading", { name: /Shopping day:/ })).toBeVisible();
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

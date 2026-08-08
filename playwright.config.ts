import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests only.
 *
 * Three flows that would each be a silent, serious breakage: the auth gate,
 * week generation, and the grocery list reacting to a plan change. Everything
 * else is covered by the unit suite, which is far faster.
 *
 * The server is started by Playwright against a throwaway database, so a run
 * never touches the developer's real data.
 */
const PORT = 3111;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    storageState: "tests/e2e/.auth/state.json",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Packs and runs the real standalone artifact — the same thing the deploy
    // workflow ships — rather than `next start`, which does not serve a
    // standalone build.
    command: "npm run pack && npm start",
    port: PORT,
    // Never reuse. `globalSetup` deletes the test database, and a reused server
    // still holds the old one open — which surfaced as a week that was already
    // planned and a confusing "skipped" result.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DB_PATH: "./data/e2e.db",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-not-used-in-production",
      ALLOWED_EMAIL: "e2e@example.test",
      AUTH_URL: `http://127.0.0.1:${PORT}`,
      // Keep the exporter off a port a parallel job might want.
      METRICS_PORT: "9465",
      LOG_LEVEL: "warn",
    },
  },
});

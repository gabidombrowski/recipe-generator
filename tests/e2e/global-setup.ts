import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { encode } from "next-auth/jwt";
import { sessionCookieName } from "../../src/server/auth-cookie";

/** Must match `playwright.config.ts`. */
const TEST_PORT = 3111;

/**
 * Mints a real Auth.js session cookie for the test browser.
 *
 * Using the library's own `encode` with the same `AUTH_SECRET` means the tests
 * exercise the genuine session path — the middleware verifies the JWT exactly
 * as it would in production. The alternative, a `SKIP_AUTH=1` bypass, would
 * mean the auth gate is untested precisely where it matters and would ship a
 * production footgun to save a few lines here.
 */

const AUTH_DIR = "tests/e2e/.auth";
const STATE_FILE = `${AUTH_DIR}/state.json`;

export default async function globalSetup(): Promise<void> {
  // Start each run from a clean database so assertions about generated weeks
  // are not affected by a previous run.
  rmSync("./data/e2e.db", { force: true });
  rmSync("./data/e2e.db-wal", { force: true });
  rmSync("./data/e2e.db-shm", { force: true });

  const secret = process.env.AUTH_SECRET ?? "e2e-secret-not-used-in-production";
  // Computed from the same function the server uses, against the same AUTH_URL
  // the webServer is configured with — so the names cannot drift apart.
  const cookieName = sessionCookieName(`http://127.0.0.1:${TEST_PORT}`);

  const token = await encode({
    token: {
      email: "e2e@example.test",
      name: "E2E",
      sub: "e2e",
    },
    secret,
    salt: cookieName,
    maxAge: 60 * 60,
  });

  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        cookies: [
          {
            name: cookieName,
            value: token,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
            expires: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        origins: [],
      },
      null,
      2,
    ),
  );
}

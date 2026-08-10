import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type * as Config from "~/server/db/config";
import type * as Queries from "~/server/db/queries";
import type * as State from "~/server/db/state";

/**
 * A real database and a real tRPC caller, for testing the request path.
 *
 * The unit suite used to cover only pure functions, which left the database
 * layer, every router and the whole request path untested — and that is exactly
 * where the bugs were. The recurring one could not be caught by a pure test even
 * in principle: a mutation that matched zero rows, reported success, and let the
 * reader silently show the old value. Catching that needs a real write followed
 * by a real read.
 *
 * **One database per file, reset between tests.** The obvious approach — a new
 * database per test via `vi.resetModules()` — does not work: the connection is
 * memoised in a module-level variable that survives the reset, so every test
 * quietly shared the first test's database and passed or failed by ordering.
 * Truncating and re-seeding is slower per test but honest about what it does,
 * and does not depend on module-registry semantics.
 *
 * A temp file rather than `:memory:`, so sqlite-vec and the WAL settings behave
 * as they do in production. The point is to test the real thing.
 */

/** A GitHub account id is numeric, so the fixture looks like one. */
export const TEST_ACCOUNT_ID = "1000001";

/**
 * Stubs Auth.js, which cannot load in a Node test environment.
 *
 * Call at module scope: `vi.mock` is hoisted, so a call inside a test runs too
 * late. It stubs the *session*, not the procedures, so `protectedProcedure`'s
 * real guard still runs — a test can still prove an anonymous caller is refused.
 */
export function mockAuth(id: string = TEST_ACCOUNT_ID): void {
  vi.mock("~/server/auth", () => ({
    auth: async () => ({ user: { id, name: "Harness" }, expires: "" }),
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
  }));
}

/** Everything a test may write to. Order matters: children before parents. */
const MUTABLE_TABLES = [
  "grocery_checks",
  "plan_slots",
  "leftover_items",
  "generation_feedback",
  "scheduler_runs",
  "constraints",
  "ingredient_tags",
  "excluded_ingredients",
  "pantry_staples",
  "recipe_embeddings",
  "recipes",
  "settings",
  "profile",
] as const;

export interface Harness {
  /** Calls procedures exactly as the HTTP layer does, guards included. */
  caller: Awaited<ReturnType<typeof buildCaller>>;
  db: typeof Queries;
  state: typeof State;
  config: typeof Config;
  /** Truncates and re-seeds. Call between tests. */
  reset: () => void;
  cleanup: () => void;
}

async function buildCaller(id: string) {
  const { createCaller } = await import("~/server/trpc/root");
  // `id` and not `email`: `protectedProcedure` keys on the account id, because
  // GitHub discloses no address for an account with a private one.
  return createCaller({
    session: { user: { id, name: "Harness" }, expires: "" },
    headers: new Headers(),
  });
}

export async function createHarness(options: { accountId?: string } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "recipe-harness-"));
  vi.stubEnv("DB_PATH", join(dir, "test.db"));
  vi.resetModules();

  const { runMigrations } = await import("~/server/db/migrate");
  const { seedDatabase } = await import("~/server/db/seed");
  const { sqlite } = await import("~/server/db/index");

  runMigrations();

  const reset = () => {
    // Foreign keys are off by default in SQLite, so a plain delete in this
    // order is enough and avoids depending on cascade behaviour.
    for (const table of MUTABLE_TABLES) {
      try {
        sqlite.prepare(`DELETE FROM ${table}`).run();
      } catch {
        // A table that does not exist in this schema version is not a problem;
        // the list is deliberately broader than any single migration state.
      }
    }
    try {
      sqlite.prepare("DELETE FROM vec_recipes").run();
    } catch {
      // sqlite-vec may not have loaded; the virtual table is then absent.
    }
    // `dir` as the cwd so a developer's own `seed.local.json` cannot leak real
    // values into a test and make it pass or fail by accident.
    seedDatabase(dir);
  };

  reset();

  return {
    caller: await buildCaller(options.accountId ?? TEST_ACCOUNT_ID),
    db: await import("~/server/db/queries"),
    state: await import("~/server/db/state"),
    config: await import("~/server/db/config"),
    reset,
    cleanup: () => {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

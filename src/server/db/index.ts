import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * The database connection.
 *
 * One process, one SQLite file, one connection. better-sqlite3 is synchronous,
 * which for a single-user app is a feature rather than a limitation: there is
 * no pool to exhaust and no await to forget.
 *
 * The connection is cached on `globalThis` because Next's dev server re-imports
 * modules on every edit, and a fresh `Database` per reload would leak file
 * handles until the WAL lock started failing.
 *
 * One convention worth stating, because getting it wrong fails quietly: with
 * the synchronous driver, query builders are *not* results. Always terminate
 * them —
 *
 *   db.query.recipes.findFirst({ ... }).sync()
 *   db.select().from(recipes).all()
 *   db.insert(recipes).values(...).returning().all()
 *   db.update(recipes).set(...).where(...).run()
 *
 * An un-terminated `findFirst()` returns a builder object, which is truthy, so
 * `if (existing)` silently takes the wrong branch instead of throwing.
 */

export const DEFAULT_DB_PATH = "./data/nutrition.db";

export function resolveDbPath(): string {
  return resolve(process.env.DB_PATH?.trim() || DEFAULT_DB_PATH);
}

export interface Connection {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle<typeof schema>>;
  /** False when the sqlite-vec extension could not be loaded. */
  vectorSearchAvailable: boolean;
}

function openConnection(): Connection {
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);

  // WAL lets the cron job write while a request reads. `NORMAL` synchronous is
  // the standard WAL pairing: durable across process crashes, and only at risk
  // from an OS-level crash, which for this app is an acceptable trade.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  // Fail fast rather than hang if the cron and a request collide.
  sqlite.pragma("busy_timeout = 5000");

  let vectorSearchAvailable = false;
  try {
    sqliteVec.load(sqlite);
    vectorSearchAvailable = true;
  } catch (error) {
    // Semantic search is an enhancement, not a dependency. If the native
    // extension will not load on this platform, keyword search still works and
    // the library page hides the semantic toggle.
    console.warn(
      "[db] sqlite-vec unavailable; semantic search disabled:",
      error instanceof Error ? error.message : error,
    );
  }

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    vectorSearchAvailable,
  };
}

const globalForDb = globalThis as unknown as { __dbConnection?: Connection };

/**
 * Opened on first *use*, not on import.
 *
 * Importing a module must not have the side effect of opening a file handle.
 * Next evaluates route modules at build time to read their config exports, and
 * an eager connection meant `next build` opened — and locked — the database,
 * which fails outright when another process holds it. Laziness also means a
 * container that builds before its volume is mounted builds fine.
 */
function getConnection(): Connection {
  globalForDb.__dbConnection ??= openConnection();
  return globalForDb.__dbConnection;
}

/**
 * Defers opening the database to the first property access, so `db` and
 * `sqlite` can stay plain exports that call sites use normally.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get: (_target, property) => Reflect.get(resolve(), property) as unknown,
  });
}

export const connection: Connection = lazy(getConnection);
export const db = lazy(() => getConnection().db);
export const sqlite = lazy(() => getConnection().sqlite);
export const vectorSearchAvailable = () => getConnection().vectorSearchAvailable;

export { schema };

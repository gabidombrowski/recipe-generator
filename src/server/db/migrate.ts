import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { connection, resolveDbPath } from "./index";
import { VEC_TABLE_DDL } from "./schema";

/**
 * Applies the drizzle-kit migrations, then the sqlite-vec virtual table that
 * the migration generator cannot see.
 *
 * Safe to run on every boot: drizzle's migrator tracks what it has applied, and
 * the vec DDL is `IF NOT EXISTS`.
 */
export function runMigrations(): void {
  migrate(connection.db, { migrationsFolder: "./drizzle" });

  if (connection.vectorSearchAvailable) {
    connection.sqlite.exec(VEC_TABLE_DDL);
  }
}

// Allow `npm run db:migrate` to drive this directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  console.log(`Migrations applied to ${resolveDbPath()}`);
  if (!connection.vectorSearchAvailable) {
    console.warn("sqlite-vec did not load; vector table was not created.");
  }
}

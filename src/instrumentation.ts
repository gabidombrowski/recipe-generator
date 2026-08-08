/**
 * Process bootstrap.
 *
 * Next calls `register()` once per server process, before any request is
 * handled — which makes it the right and only place to start things that must
 * exist exactly once: the OpenTelemetry SDK, the database migrations, and the
 * weekly scheduler's cron registration.
 *
 * Everything is guarded on the Node runtime. The same file is evaluated for the
 * edge runtime (which the middleware uses), where none of these modules can
 * load, so the guard is what keeps the edge build working.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported lazily so the edge bundle never pulls in native modules.
  const { startTelemetry } = await import("./server/otel-sdk");
  const { runMigrations } = await import("./server/db/migrate");
  const { seedDatabase } = await import("./server/db/seed");
  const { registerScheduler } = await import("./server/scheduler/cron");
  const { loggerFor } = await import("./server/logger");

  const log = loggerFor("bootstrap");

  startTelemetry();

  // Migrate before seeding, and seed before the scheduler can fire: a cron that
  // wakes to an empty database would log a failure for no reason.
  runMigrations();
  const seed = seedDatabase();
  log.info(
    {
      usedLocalSeed: seed.usedLocalSeed,
      recipesCreated: seed.recipesCreated,
      pantryCreated: seed.pantryCreated,
    },
    "database ready",
  );

  registerScheduler();
}

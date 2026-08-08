import cron, { type ScheduledTask } from "node-cron";
import { getSettings } from "~/server/db/state";
import { loggerFor } from "~/server/logger";
import { weeklyCronExpression } from "~/lib/days";
import { runWeeklyGeneration } from "./run";

/**
 * Cron registration.
 *
 * Registered exactly once from `instrumentation.ts`. The module-level guard is
 * belt and braces for Next's dev server, which re-imports modules on edit and
 * would otherwise stack a new schedule on every save until the same week was
 * being planned a dozen times.
 */

const log = loggerFor("cron");

const globalForCron = globalThis as unknown as {
  __schedulerTask?: ScheduledTask;
  __schedulerExpression?: string;
};

export function registerScheduler(): void {
  const settings = getSettings();
  const expression = weeklyCronExpression(settings.generationDay, settings.generationTime);

  // Settings can change the schedule; tear down the old task rather than
  // leaving both running.
  if (globalForCron.__schedulerTask) {
    if (globalForCron.__schedulerExpression === expression) return;
    void globalForCron.__schedulerTask.destroy();
    globalForCron.__schedulerTask = undefined;
  }

  if (!cron.validate(expression)) {
    log.error({ expression }, "invalid cron expression; scheduler not registered");
    return;
  }

  globalForCron.__schedulerTask = cron.schedule(
    expression,
    () => {
      log.info({ expression, timezone: settings.timezone }, "scheduler fired");
      void runWeeklyGeneration({ trigger: "cron" }).catch((error: unknown) => {
        // runWeeklyGeneration handles its own failures; anything reaching here
        // is unexpected, and must not take the process down.
        log.error({ err: error }, "unhandled error in scheduled run");
      });
    },
    { timezone: settings.timezone },
  );
  globalForCron.__schedulerExpression = expression;

  log.info(
    {
      expression,
      timezone: settings.timezone,
      generationDay: settings.generationDay,
      generationTime: settings.generationTime,
    },
    "weekly scheduler registered",
  );
}

/** Re-reads settings and re-registers. Called after the settings are saved. */
export function refreshScheduler(): void {
  registerScheduler();
}

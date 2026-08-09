import { DAYS_OF_WEEK, type DayOfWeek } from "./schemas";

/**
 * Calendar-date helpers.
 *
 * Dates are handled as bare `YYYY-MM-DD` strings, never as `Date` objects with
 * an implied instant. A plan slot on "Tuesday the 4th" is a calendar fact, not
 * a moment in time, and treating it as one is what avoids the classic
 * off-by-one where a UTC server decides it is still Monday.
 *
 * The configured timezone is used only to interpret "now" in the user's local
 * context — deciding today's calendar date and current wall-clock time. All
 * arithmetic after that is plain calendar arithmetic done in UTC, which is
 * safe because the inputs carry no time.
 */

export type IsoDate = string;

/** Today's calendar date in the given IANA timezone. */
export function todayInTimezone(
  timezone: string,
  now: Date = new Date(),
): IsoDate {
  try {
    // `en-CA` formats as YYYY-MM-DD, which is exactly our wire format.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An invalid zone should degrade to UTC, not crash the scheduler.
    return now.toISOString().slice(0, 10);
  }
}

/** Wall-clock `HH:MM` in the given timezone. */
export function timeInTimezone(
  timezone: string,
  now: Date = new Date(),
): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

function toUtcMillis(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function fromUtcMillis(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMillis(toUtcMillis(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / DAY_MS);
}

export function dayOfWeekFor(date: IsoDate): DayOfWeek {
  // DAYS_OF_WEEK is Sunday-first, matching getUTCDay()'s 0 = Sunday.
  return DAYS_OF_WEEK[new Date(toUtcMillis(date)).getUTCDay()]!;
}

export function dayIndex(day: DayOfWeek): number {
  return DAYS_OF_WEEK.indexOf(day);
}

/**
 * The most recent `startDay` on or before `date` — i.e. the first day of the
 * week that `date` belongs to, where the week is defined by the user's
 * configured generation day rather than by a locale convention.
 */
export function weekStartFor(date: IsoDate, startDay: DayOfWeek): IsoDate {
  const offset =
    (new Date(toUtcMillis(date)).getUTCDay() - dayIndex(startDay) + 7) % 7;
  return addDays(date, -offset);
}

/** The seven consecutive dates beginning at `start`. */
export function weekDates(start: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** `Tue 4 Feb` — compact label for grid headers. */
export function formatShortDate(date: IsoDate): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(toUtcMillis(date)));
}

/**
 * `August 8, 2026` — the long form used wherever a date is read as prose.
 *
 * `timeZone: "UTC"` is not optional here. An `IsoDate` is a calendar day with
 * no time attached, and parsing one yields UTC midnight — formatted in a
 * negative-offset zone that renders as the *previous* day, so a shopping list
 * for the 8th would be labelled the 7th anywhere west of Greenwich.
 *
 * Dates stay ISO in the database, on the wire and in URLs, where they sort and
 * compare correctly. This is presentation only.
 */
export function formatLongDate(date: IsoDate): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(toUtcMillis(date)));
}

/**
 * A node-cron expression for the configured weekly generation moment.
 * node-cron applies the timezone itself via its `timezone` option, so the
 * expression stays in local wall-clock terms.
 */
export function weeklyCronExpression(
  generationDay: DayOfWeek,
  generationTime: string,
): string {
  const [hour, minute] = generationTime.split(":");
  return `${Number(minute)} ${Number(hour)} * * ${dayIndex(generationDay)}`;
}

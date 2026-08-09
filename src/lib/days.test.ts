import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeekFor,
  daysBetween,
  formatLongDate,
  todayInTimezone,
  weekDates,
  weeklyCronExpression,
  weekStartFor,
} from "./days";

describe("calendar helpers", () => {
  it("identifies the day of week", () => {
    // 2026-02-08 is a Sunday.
    expect(dayOfWeekFor("2026-02-08")).toBe("Sunday");
    expect(dayOfWeekFor("2026-02-10")).toBe("Tuesday");
  });

  it("adds and subtracts days across month boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses a leap day correctly", () => {
    // 2028 is a leap year.
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-02-08", "2026-02-15")).toBe(7);
    expect(daysBetween("2026-02-15", "2026-02-08")).toBe(-7);
    expect(daysBetween("2026-02-08", "2026-02-08")).toBe(0);
  });

  it("finds the week start for a configured first day", () => {
    // Wednesday the 11th, weeks starting Sunday → Sunday the 8th.
    expect(weekStartFor("2026-02-11", "Sunday")).toBe("2026-02-08");
    // Same date, weeks starting Monday → Monday the 9th.
    expect(weekStartFor("2026-02-11", "Monday")).toBe("2026-02-09");
    // On the start day itself, the week starts today.
    expect(weekStartFor("2026-02-08", "Sunday")).toBe("2026-02-08");
  });

  it("produces seven consecutive dates", () => {
    const dates = weekDates("2026-02-08");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-02-08");
    expect(dates[6]).toBe("2026-02-14");
  });

  it("resolves today against a timezone, not the server clock", () => {
    // 03:30 UTC on the 9th is still the 8th in Chicago (UTC-6).
    const instant = new Date("2026-02-09T03:30:00Z");
    expect(todayInTimezone("America/Denver", instant)).toBe("2026-02-08");
    expect(todayInTimezone("UTC", instant)).toBe("2026-02-09");
    expect(todayInTimezone("Asia/Tokyo", instant)).toBe("2026-02-09");
  });

  it("falls back to UTC for an invalid timezone rather than throwing", () => {
    const instant = new Date("2026-02-09T03:30:00Z");
    expect(todayInTimezone("Not/AZone", instant)).toBe("2026-02-09");
  });

  it("builds a weekly cron expression", () => {
    expect(weeklyCronExpression("Sunday", "06:00")).toBe("0 6 * * 0");
    expect(weeklyCronExpression("Thursday", "18:30")).toBe("30 18 * * 4");
  });
});

describe("formatLongDate", () => {
  it("renders the long prose form", () => {
    expect(formatLongDate("2026-08-08")).toBe("August 8, 2026");
  });

  it("does not shift the day in a negative-offset timezone", () => {
    // An IsoDate is a calendar day, not an instant. Parsed as UTC midnight and
    // formatted in local time, this would render as August 7 anywhere west of
    // Greenwich — mislabelling every date in the app by a day.
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatLongDate("2026-08-08")).toBe("August 8, 2026");
    } finally {
      process.env.TZ = original;
    }
  });

  it("handles a single-digit day without padding", () => {
    expect(formatLongDate("2026-01-01")).toBe("January 1, 2026");
  });
});

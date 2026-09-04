/**
 * Regression: a session held on 4 September was shown, invoiced and exported as
 * 3 September.
 *
 * The billing API serializes the appointment date as a bare "2026-09-04", and
 * the page did `new Date("2026-09-04").toLocaleDateString("fr-CA", …)`. JS
 * parses a date-ONLY string as UTC midnight, which in Montréal is 20:00 the
 * previous day.
 */
import { describe, it, expect } from "vitest";
import { formatCalendarDate, isDateOnly } from "./format-calendar-date";

// The zone that produced the bug. Every assertion below is made in it.
const MTL = "America/Toronto";
const DAY = { year: "numeric", month: "2-digit", day: "2-digit" } as const;

const inMontreal = (value: string | Date) =>
  formatCalendarDate(value, "en-CA", { ...DAY, timeZone: MTL });

describe("isDateOnly", () => {
  it("recognises a bare calendar day", () => {
    expect(isDateOnly("2026-09-04")).toBe(true);
    expect(isDateOnly("  2026-09-04  ")).toBe(true);
  });

  it("rejects timestamps and rubbish", () => {
    expect(isDateOnly("2026-09-04T12:00:00.000Z")).toBe(false);
    expect(isDateOnly("2026-09")).toBe(false);
    expect(isDateOnly(new Date())).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });
});

describe("formatCalendarDate", () => {
  it("keeps a bare calendar day on its own day, even viewed from Montréal", () => {
    // THE bug: this used to render 2026-09-03.
    expect(formatCalendarDate("2026-09-04", "en-CA", { ...DAY, timeZone: MTL }))
      .toBe("2026-09-04");
  });

  it("forces UTC for a calendar day, so no viewer timezone can shift it", () => {
    // Even a zone far to the west of UTC must not roll it back.
    expect(
      formatCalendarDate("2026-09-04", "en-CA", { ...DAY, timeZone: "Pacific/Honolulu" }),
    ).toBe("2026-09-04");
    // ...nor far to the east roll it forward.
    expect(
      formatCalendarDate("2026-09-04", "en-CA", { ...DAY, timeZone: "Pacific/Kiritimati" }),
    ).toBe("2026-09-04");
  });

  it("keeps a UTC-noon anchored appointment Date on its day", () => {
    // This is how appointment dates are actually stored.
    const stored = new Date("2026-09-04T12:00:00.000Z");
    expect(inMontreal(stored)).toBe("2026-09-04");
  });

  it("still renders a genuine timestamp in local time", () => {
    // paidAt / createdAt are instants, not calendar days: 00:30 UTC on the 5th
    // really is the evening of the 4th in Montréal.
    expect(inMontreal("2026-09-05T00:30:00.000Z")).toBe("2026-09-04");
  });

  it("handles the month and year boundary", () => {
    expect(formatCalendarDate("2026-01-01", "en-CA", { ...DAY, timeZone: MTL }))
      .toBe("2026-01-01");
    expect(formatCalendarDate("2025-12-31", "en-CA", { ...DAY, timeZone: MTL }))
      .toBe("2025-12-31");
  });

  it("survives the DST changeover", () => {
    // Montréal springs forward on 2026-03-08.
    expect(formatCalendarDate("2026-03-08", "en-CA", { ...DAY, timeZone: MTL }))
      .toBe("2026-03-08");
    expect(formatCalendarDate("2026-11-01", "en-CA", { ...DAY, timeZone: MTL }))
      .toBe("2026-11-01");
  });

  it("renders a readable French long date by default", () => {
    expect(formatCalendarDate("2026-09-04")).toMatch(/4 septembre 2026/);
  });

  it("returns a dash rather than 'Invalid Date'", () => {
    expect(formatCalendarDate(null)).toBe("—");
    expect(formatCalendarDate(undefined)).toBe("—");
    expect(formatCalendarDate("")).toBe("—");
    expect(formatCalendarDate("not a date")).toBe("—");
    expect(formatCalendarDate(new Date("nonsense"))).toBe("—");
  });
});

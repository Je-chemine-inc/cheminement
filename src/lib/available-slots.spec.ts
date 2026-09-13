import { describe, expect, it } from "vitest";
import {
  addDays,
  computeFreeSlots,
  daysBetween,
  generateTimeSlots,
  isDayKey,
  isSlotTime,
  normalizeClock,
  slotGridOf,
  slotStartsAt,
  torontoDayKey,
  weekdayOf,
  workingHoursOf,
  type WeeklyAvailability,
} from "@/lib/available-slots";

const morning = (day: string, isWorkDay = true) => ({ day, isWorkDay, startTime: "09:00", endTime: "12:00" });

/** 09:00 to 12:00, 60-minute sessions and 15-minute breaks: 09:00 and 10:15. */
const week: WeeklyAvailability = {
  days: [morning("Monday"), morning("Tuesday"), morning("Wednesday"), morning("Saturday", false)],
  sessionDurationMinutes: 60,
  breakDurationMinutes: 15,
};

const busy = (from: string, to: string) => ({ startsAt: new Date(from), endsAt: new Date(to) });

describe("the weekly grid", () => {
  it("steps by a session and a break while a whole session fits, as the legacy route did", () => {
    expect(generateTimeSlots("09:00", "17:00", 60, 15)).toEqual(["09:00", "10:15", "11:30", "12:45", "14:00", "15:15"]);
    expect(generateTimeSlots("9:00", "11:00", 50, 10)).toEqual(["09:00", "10:00"]);
  });

  it("yields nothing for hours it cannot read", () => {
    expect(generateTimeSlots("nine", "17:00", 60, 15)).toEqual([]);
    expect(generateTimeSlots("09:00", "25:00", 60, 15)).toEqual([]);
    expect(generateTimeSlots("09:00", "17:00", 0, 0)).toEqual([]);
  });

  it("keeps a break of 0 and defaults only what is missing or absurd", () => {
    expect(slotGridOf({ sessionDurationMinutes: 50, breakDurationMinutes: 0 })).toEqual({ sessionMinutes: 50, breakMinutes: 0 });
    expect(slotGridOf({})).toEqual({ sessionMinutes: 60, breakMinutes: 15 });
    expect(slotGridOf({ sessionDurationMinutes: 0, breakDurationMinutes: -5 })).toEqual({ sessionMinutes: 60, breakMinutes: 15 });
    expect(slotGridOf(null)).toEqual({ sessionMinutes: 60, breakMinutes: 15 });
  });

  it("reads working hours by the Montréal weekday of the day", () => {
    expect(weekdayOf("2026-09-14")).toBe("Monday");
    expect(workingHoursOf(week, "2026-09-14")).toEqual({ startTime: "09:00", endTime: "12:00" });
    expect(workingHoursOf(week, "2026-09-19")).toBeNull(); // Saturday, not a work day
    expect(workingHoursOf(week, "2026-09-17")).toBeNull(); // Thursday, not listed
    expect(workingHoursOf(week, "2026-02-30")).toBeNull();
  });
});

describe("Montréal days and times", () => {
  it("names the Montréal day, not the UTC one", () => {
    expect(torontoDayKey(new Date("2026-09-15T03:30:00Z"))).toBe("2026-09-14");
    expect(torontoDayKey(new Date("2026-09-15T04:30:00Z"))).toBe("2026-09-15");
  });

  it("converts a wall-clock time with the offset of its own date", () => {
    expect(slotStartsAt("2026-09-16", "10:00")).toEqual(new Date("2026-09-16T14:00:00Z"));
    expect(slotStartsAt("2026-12-01", "10:00")).toEqual(new Date("2026-12-01T15:00:00Z"));
  });

  it("drops the hour the clocks skip, and takes the first of the hour that repeats", () => {
    expect(slotStartsAt("2026-03-08", "02:30")).toBeNull();
    expect(slotStartsAt("2026-03-08", "03:30")).toEqual(new Date("2026-03-08T07:30:00Z"));
    expect(slotStartsAt("2026-11-01", "01:30")).toEqual(new Date("2026-11-01T05:30:00Z"));
  });

  it("validates days and times strictly", () => {
    expect(isDayKey("2026-09-14")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("14/09/2026")).toBe(false);
    expect(isSlotTime("09:15")).toBe(true);
    expect(isSlotTime("9:15")).toBe(false);
    expect(isSlotTime("24:00")).toBe(false);
    expect(normalizeClock("9:05")).toBe("09:05");
    expect(normalizeClock("24:30")).toBeNull();
  });

  it("counts calendar days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-14", "2026-09-27")).toBe(13);
  });
});

describe("computeFreeSlots", () => {
  // Monday 2026-09-14, 09:00 in Montréal.
  const now = new Date("2026-09-14T13:00:00Z");

  it("removes times too soon and times that overlap anything busy", () => {
    const days = computeFreeSlots({
      availability: week,
      fromDay: "2026-09-14",
      days: 7,
      now,
      minLeadMinutes: 120,
      busy: [
        busy("2026-09-15T14:30:00Z", "2026-09-15T15:30:00Z"), // Tuesday 10:30-11:30, off the grid
        busy("2026-09-16T13:00:00Z", "2026-09-16T14:00:00Z"), // Wednesday 09:00, a held request
      ],
    });
    expect(days).toEqual([
      { day: "2026-09-14", slots: [] },
      { day: "2026-09-15", slots: ["09:00"] },
      { day: "2026-09-16", slots: ["10:15"] },
      { day: "2026-09-17", slots: [] },
      { day: "2026-09-18", slots: [] },
      { day: "2026-09-19", slots: [] },
      { day: "2026-09-20", slots: [] },
    ]);
  });

  it("checks the overlap with the consultation's own length", () => {
    const run = (durationMinutes?: number) =>
      computeFreeSlots({
        availability: week,
        fromDay: "2026-09-15",
        days: 1,
        now,
        minLeadMinutes: 0,
        durationMinutes,
        busy: [busy("2026-09-15T14:45:00Z", "2026-09-15T15:45:00Z")], // 10:45-11:45
      })[0].slots;
    expect(run()).toEqual(["09:00"]);
    expect(run(30)).toEqual(["09:00", "10:15"]); // 10:15-10:45 ends as the session starts
  });

  it("offers only times strictly after now when there is no lead time", () => {
    const tuesdayNine = new Date("2026-09-15T13:00:00Z");
    expect(
      computeFreeSlots({ availability: week, fromDay: "2026-09-15", days: 1, now: tuesdayNine, minLeadMinutes: 0, busy: [] })[0]
        .slots,
    ).toEqual(["10:15"]);
  });

  it("never offers a time that does not exist on the day the clocks change", () => {
    const sunday: WeeklyAvailability = {
      days: [{ day: "Sunday", isWorkDay: true, startTime: "01:00", endTime: "04:00" }],
      sessionDurationMinutes: 60,
      breakDurationMinutes: 15,
    };
    expect(
      computeFreeSlots({
        availability: sunday,
        fromDay: "2026-03-08",
        days: 1,
        now: new Date("2026-03-01T12:00:00Z"),
        minLeadMinutes: 0,
        busy: [],
      })[0].slots,
    ).toEqual(["01:00"]);
  });

  it("returns nothing for an unreadable start day or no availability at all", () => {
    expect(computeFreeSlots({ availability: week, fromDay: "soon", days: 3, now, minLeadMinutes: 0, busy: [] })).toEqual([]);
    expect(
      computeFreeSlots({ availability: null, fromDay: "2026-09-15", days: 2, now, minLeadMinutes: 0, busy: [] }),
    ).toEqual([
      { day: "2026-09-15", slots: [] },
      { day: "2026-09-16", slots: [] },
    ]);
  });
});

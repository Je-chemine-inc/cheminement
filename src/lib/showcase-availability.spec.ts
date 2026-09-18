import { describe, it, expect } from "vitest";
import { firstFreeTime, showcaseAvailabilityState, showcaseWorkDays } from "@/lib/showcase-availability";
import type { ShowcaseBookingOption } from "@/lib/showcase-booking-types";

const standard: ShowcaseBookingOption = { service: "standard", minutes: 50, price: 195, first: { day: "2026-09-22", time: "13:00" } };
const quick: ShowcaseBookingOption = { service: "quick", minutes: 30, price: 95, first: { day: "2026-09-22", time: "09:30" } };
const on = { standard: true, quick: false };

describe("showcaseAvailabilityState (spec 003 phase 3b)", () => {
  it("is off until the professional switches a consultation on, whatever else is true", () => {
    expect(
      showcaseAvailabilityState({ services: { standard: false, quick: false }, pageLive: true, hoursConfirmed: true, options: [standard] }),
    ).toBe("off");
  });

  it("says when the page itself is not online", () => {
    expect(showcaseAvailabilityState({ services: on, pageLive: false, hoursConfirmed: true, options: [] })).toBe("pageHidden");
  });

  it("waits for hours the professional saved themselves", () => {
    expect(showcaseAvailabilityState({ services: on, pageLive: true, hoursConfirmed: false, options: [] })).toBe("needsHours");
    expect(showcaseAvailabilityState({ services: { standard: false, quick: true }, pageLive: true, hoursConfirmed: false, options: [] })).toBe(
      "needsHours",
    );
  });

  it("is live only with a free time ahead, and says so when there is none", () => {
    expect(showcaseAvailabilityState({ services: on, pageLive: true, hoursConfirmed: true, options: [] })).toBe("noFreeTime");
    expect(showcaseAvailabilityState({ services: on, pageLive: true, hoursConfirmed: true, options: [standard] })).toBe("live");
  });
});

describe("firstFreeTime", () => {
  it("is the earliest time among the consultations shown", () => {
    expect(firstFreeTime([standard, quick])).toEqual({ day: "2026-09-22", time: "09:30" });
    expect(firstFreeTime([{ ...standard, first: { day: "2026-09-21", time: "16:00" } }, quick])).toEqual({ day: "2026-09-21", time: "16:00" });
  });

  it("is null when the page shows no time", () => {
    expect(firstFreeTime([])).toBeNull();
  });
});

describe("showcaseWorkDays", () => {
  it("keeps the working days, Monday first, with their hours", () => {
    expect(
      showcaseWorkDays([
        { day: "Thursday", isWorkDay: true, startTime: "13:00", endTime: "17:00" },
        { day: "Monday", isWorkDay: false, startTime: "09:00", endTime: "17:00" },
        { day: "Tuesday", isWorkDay: true, startTime: "13:00", endTime: "17:00" },
      ]),
    ).toEqual([
      { day: "Tuesday", start: "13:00", end: "17:00" },
      { day: "Thursday", start: "13:00", end: "17:00" },
    ]);
  });

  it("leaves out unknown days, repeated days, and hours that make no span", () => {
    expect(
      showcaseWorkDays([
        { day: "Funday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
        { day: "Friday", isWorkDay: true, startTime: "17:00", endTime: "09:00" },
        { day: "Friday", isWorkDay: true, startTime: "09:00", endTime: "12:00" },
        { day: "Saturday", isWorkDay: true, startTime: "9:00", endTime: "12:00" },
        { day: "Sunday", isWorkDay: true, startTime: "10:00", endTime: "10:00" },
        null,
      ]),
    ).toEqual([]);
    expect(showcaseWorkDays(undefined)).toEqual([]);
  });
});

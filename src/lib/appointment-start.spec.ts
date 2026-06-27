import { describe, it, expect } from "vitest";
import { getAppointmentStartAt } from "./appointment-start";

// Date is stored anchored at UTC noon (parseAppointmentDate), time is the
// Montréal wall-clock time. The start must resolve to the real UTC instant.
const day = (y: number, mo: number, d: number) =>
  new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));

describe("getAppointmentStartAt", () => {
  it("interprets the time as Montréal wall-clock in summer (EDT = UTC-4)", () => {
    const start = getAppointmentStartAt({ date: day(2026, 6, 24), time: "13:00" });
    // 13:00 EDT = 17:00 UTC
    expect(start?.toISOString()).toBe("2026-06-24T17:00:00.000Z");
  });

  it("interprets the time as Montréal wall-clock in winter (EST = UTC-5)", () => {
    const start = getAppointmentStartAt({ date: day(2026, 1, 15), time: "13:00" });
    // 13:00 EST = 18:00 UTC
    expect(start?.toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });

  it("keeps the calendar day even for late local times that cross UTC midnight", () => {
    const start = getAppointmentStartAt({ date: day(2026, 6, 24), time: "22:00" });
    // 22:00 EDT = 02:00 UTC next day
    expect(start?.toISOString()).toBe("2026-06-25T02:00:00.000Z");
  });

  it("passes through an explicit scheduledStartAt", () => {
    const at = new Date("2026-06-24T17:30:00.000Z");
    expect(getAppointmentStartAt({ scheduledStartAt: at })?.toISOString()).toBe(
      "2026-06-24T17:30:00.000Z",
    );
  });

  it("returns null when there is no date", () => {
    expect(getAppointmentStartAt({ time: "13:00" })).toBeNull();
  });
});

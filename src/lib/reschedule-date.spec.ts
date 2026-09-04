/**
 * Regression: rescheduling a session landed it a day early, and the clock was
 * unusable in Safari.
 *
 * The reschedule dialog sent `new Date(rescheduleDate)` — a bare "2026-09-09"
 * from an <input type="date">. JS parses that as UTC **midnight**, which is
 * 20:00 on the 8th in Montréal, so the session moved to the wrong day. The
 * update endpoint stored it verbatim, without the UTC-noon anchor every other
 * appointment date goes through.
 *
 * These pin the anchoring rule itself. The endpoint now runs every incoming
 * date through `parseAppointmentDate`, so a caller sending either shape is safe.
 */
import { describe, it, expect } from "vitest";
import { appointmentDayKey, parseAppointmentDate } from "./appointment-date";

const MTL = "America/Toronto";
const dayInMontreal = (d: Date) =>
  d.toLocaleDateString("en-CA", {
    timeZone: MTL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

describe("rescheduling anchors the calendar day", () => {
  it("keeps a rescheduled day on its own date in Montréal", () => {
    // THE bug: `new Date("2026-09-09")` is 2026-09-08 20:00 in Montréal.
    expect(dayInMontreal(new Date("2026-09-09"))).toBe("2026-09-08");
    // The anchored value survives.
    expect(dayInMontreal(parseAppointmentDate("2026-09-09")!)).toBe("2026-09-09");
  });

  it("anchors a bare calendar day at UTC noon", () => {
    expect(parseAppointmentDate("2026-09-09")!.toISOString()).toBe(
      "2026-09-09T12:00:00.000Z",
    );
  });

  it("round-trips: the day sent is the day stored and read back", () => {
    // What the dialog now sends is exactly what the API anchors and what the
    // day-key reads back — so prefilling the dialog cannot drift either.
    const chosen = "2026-09-09";
    const stored = parseAppointmentDate(chosen)!;
    expect(appointmentDayKey(stored)).toBe(chosen);
  });

  it("reads a legacy UTC-midnight row back as its intended day", () => {
    // Rows written before the anchor existed must still report the right day.
    expect(appointmentDayKey(new Date("2026-09-09T00:00:00.000Z"))).toBe(
      "2026-09-09",
    );
  });

  it("survives the DST changeover", () => {
    expect(dayInMontreal(parseAppointmentDate("2026-03-08")!)).toBe("2026-03-08");
    expect(dayInMontreal(parseAppointmentDate("2026-11-01")!)).toBe("2026-11-01");
  });

  it("rejects an unusable date instead of storing garbage", () => {
    expect(parseAppointmentDate("")).toBeNull();
    expect(parseAppointmentDate(null)).toBeNull();
    expect(parseAppointmentDate("not-a-date")).toBeNull();
  });

  it("leaves a real instant alone", () => {
    // scheduledStartAt-style values carry a time and must not be re-anchored.
    const instant = new Date("2026-09-09T13:30:00.000Z");
    expect(parseAppointmentDate(instant)!.toISOString()).toBe(
      "2026-09-09T13:30:00.000Z",
    );
  });
});

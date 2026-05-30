/**
 * 24h-shift fix: a "YYYY-MM-DD" booking must render on the SAME calendar day for
 * a negative-UTC viewer (Montreal/Toronto). Anchoring at UTC noon guarantees it.
 */
import { describe, it, expect } from "vitest";
import { parseAppointmentDate, appointmentDayKey } from "@/lib/appointment-date";

describe("parseAppointmentDate", () => {
  it("anchors a date-only string at UTC noon", () => {
    const d = parseAppointmentDate("2026-05-30");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(4); // May (0-indexed)
    expect(d!.getUTCDate()).toBe(30);
    expect(d!.getUTCHours()).toBe(12);
  });

  it("renders on the booked day in Montreal/Toronto (the bug it fixes)", () => {
    const fixed = parseAppointmentDate("2026-05-30")!;
    const shown = fixed.toLocaleDateString("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    expect(shown).toBe("2026-05-30");

    // The old behavior (plain new Date) would have shown the day before.
    const buggy = new Date("2026-05-30").toLocaleDateString("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    expect(buggy).toBe("2026-05-29");
  });

  it("passes through a full datetime string unchanged", () => {
    const d = parseAppointmentDate("2026-05-30T09:30:00Z");
    expect(d!.getUTCHours()).toBe(9);
    expect(d!.getUTCMinutes()).toBe(30);
  });

  it("passes through a Date instance", () => {
    const orig = new Date("2026-05-30T09:30:00Z");
    expect(parseAppointmentDate(orig)).toBe(orig);
  });

  it("returns null for empty / invalid input", () => {
    expect(parseAppointmentDate("")).toBeNull();
    expect(parseAppointmentDate(null)).toBeNull();
    expect(parseAppointmentDate(undefined)).toBeNull();
    expect(parseAppointmentDate("not-a-date")).toBeNull();
  });
});

describe("appointmentDayKey", () => {
  it("reads the calendar day from UTC parts (correct for UTC-noon storage)", () => {
    expect(appointmentDayKey(parseAppointmentDate("2026-05-30"))).toBe(
      "2026-05-30",
    );
  });

  it("is also correct for legacy UTC-midnight rows", () => {
    expect(appointmentDayKey(new Date("2026-05-30T00:00:00Z"))).toBe(
      "2026-05-30",
    );
  });

  it("returns empty for missing/invalid dates", () => {
    expect(appointmentDayKey(undefined)).toBe("");
    expect(appointmentDayKey("nope")).toBe("");
  });
});

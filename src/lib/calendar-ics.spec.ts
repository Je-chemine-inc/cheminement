import { describe, it, expect } from "vitest";
import { buildProfessionalCalendarIcs, type IcsEvent } from "./calendar-ics";

const NOW = new Date("2026-06-20T10:00:00Z");
// UTC-noon-anchored calendar day, as stored by parseAppointmentDate.
const day = (y: number, mo: number, d: number) =>
  new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));

const base: IcsEvent = {
  uid: "appt1",
  date: day(2026, 6, 24),
  time: "13:00",
  durationMinutes: 50,
  summary: "Je chemine — Rendez-vous",
};

const build = (events: IcsEvent[]) =>
  buildProfessionalCalendarIcs(events, { calendarName: "Je chemine", now: NOW });

describe("buildProfessionalCalendarIcs", () => {
  it("wraps a valid VCALENDAR with the America/Toronto VTIMEZONE", () => {
    const ics = build([base]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:America/Toronto");
    expect(ics).toContain("VERSION:2.0");
    // RFC requires CRLF line endings throughout.
    expect(ics.includes("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("emits TZID wall-clock DTSTART/DTEND with end = start + duration", () => {
    const ics = build([base]);
    expect(ics).toContain("DTSTART;TZID=America/Toronto:20260624T130000");
    expect(ics).toContain("DTEND;TZID=America/Toronto:20260624T135000");
    expect(ics).toContain("DTSTAMP:20260620T100000Z");
    expect(ics).toContain("UID:appt1@jechemine.ca");
  });

  it("rolls the end time past midnight onto the next day", () => {
    const ics = build([{ ...base, time: "23:30", durationMinutes: 90 }]);
    expect(ics).toContain("DTSTART;TZID=America/Toronto:20260624T233000");
    expect(ics).toContain("DTEND;TZID=America/Toronto:20260625T010000");
  });

  it("escapes commas, semicolons and newlines in text fields", () => {
    const ics = build([
      { ...base, summary: "A, B; C", description: "line1\nline2" },
    ]);
    expect(ics).toContain("SUMMARY:A\\, B\\; C");
    expect(ics).toContain("DESCRIPTION:line1\\nline2");
  });

  it("folds lines longer than 75 octets onto continuation lines", () => {
    const longDesc = "x".repeat(200);
    const ics = build([{ ...base, description: longDesc }]);
    // No single physical line may exceed 75 octets.
    const enc = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    }
    // Continuation lines begin with a single space.
    expect(ics).toMatch(/\r\n x/);
  });

  it("marks a cancelled event and includes LAST-MODIFIED", () => {
    const ics = build([
      {
        ...base,
        status: "cancelled",
        lastModified: new Date("2026-06-19T08:30:00Z"),
      },
    ]);
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("LAST-MODIFIED:20260619T083000Z");
  });

  it("skips events whose date/time cannot be parsed", () => {
    const ics = build([
      { ...base, uid: "good" },
      { ...base, uid: "bad-time", time: "" },
      { ...base, uid: "bad-date", date: "not-a-date" },
    ]);
    expect(ics).toContain("UID:good@jechemine.ca");
    expect(ics).not.toContain("UID:bad-time@jechemine.ca");
    expect(ics).not.toContain("UID:bad-date@jechemine.ca");
    // exactly one VEVENT
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
  });
});

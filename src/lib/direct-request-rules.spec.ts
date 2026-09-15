import { describe, expect, it } from "vitest";
import { directRequestDeadline, isDirectRequestService } from "@/lib/direct-request-rules";

const now = new Date("2026-09-14T13:00:00Z");
const inHours = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000);

describe("directRequestDeadline", () => {
  it("gives the professional 24 hours for a standard consultation", () => {
    expect(directRequestDeadline({ now, startsAt: inHours(72), service: "standard" })).toEqual(inHours(24));
  });

  it("gives 12 hours for a quick consultation", () => {
    expect(directRequestDeadline({ now, startsAt: inHours(72), service: "quick" })).toEqual(inHours(12));
  });

  it("never lets the answer come later than one hour before the slot", () => {
    expect(directRequestDeadline({ now, startsAt: inHours(10), service: "standard" })).toEqual(inHours(9));
    expect(directRequestDeadline({ now, startsAt: inHours(5), service: "quick" })).toEqual(inHours(4));
  });

  it("refuses a slot too close to answer for", () => {
    expect(directRequestDeadline({ now, startsAt: inHours(1), service: "standard" })).toBeNull();
    expect(directRequestDeadline({ now, startsAt: inHours(0.5), service: "quick" })).toBeNull();
    expect(directRequestDeadline({ now, startsAt: inHours(-3), service: "standard" })).toBeNull();
  });
});

describe("isDirectRequestService", () => {
  it("knows the two consultations a page offers", () => {
    expect(isDirectRequestService("standard")).toBe(true);
    expect(isDirectRequestService("quick")).toBe(true);
    expect(isDirectRequestService("couple")).toBe(false);
    expect(isDirectRequestService(undefined)).toBe(false);
  });
});

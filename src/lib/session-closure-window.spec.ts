/**
 * Regression (JC-2026-000014): a session booked for 9 September was closed as
 * "completed" on 31 August — three hours after it was created, nine days early.
 * That issued an invoice and ran the client through the whole dunning cascade
 * for a session she had never attended.
 */
import { describe, it, expect } from "vitest";
import {
  EARLY_CLOSURE_GRACE_MS,
  canCloseSession,
  sessionClosureWindow,
} from "./session-closure-window";

const at = (iso: string) => new Date(iso).getTime();

describe("sessionClosureWindow", () => {
  it("refuses the real case: closing a 9 Sept session on 31 Aug", () => {
    const start = new Date("2026-09-09T16:00:00.000Z"); // 12:00 America/Toronto
    const v = sessionClosureWindow(start, at("2026-08-31T21:07:50.000Z"));

    expect(v.closable).toBe(false);
    // Just over nine days of waiting, minus the grace window.
    expect(v.waitMs).toBeGreaterThan(8 * 24 * 60 * 60 * 1000);
  });

  it("allows closing a session that has already happened", () => {
    const start = new Date("2026-08-31T17:00:00.000Z");
    expect(canCloseSession(start, at("2026-09-01T14:14:49.000Z"))).toBe(true);
  });

  it("allows closing a session in progress", () => {
    const start = new Date("2026-09-02T16:00:00.000Z");
    expect(canCloseSession(start, at("2026-09-02T16:30:00.000Z"))).toBe(true);
  });

  it("allows the grace window — a no-show closed just before the start", () => {
    const start = new Date("2026-09-02T16:00:00.000Z");
    const justInside = at("2026-09-02T16:00:00.000Z") - EARLY_CLOSURE_GRACE_MS + 1000;
    const justOutside = at("2026-09-02T16:00:00.000Z") - EARLY_CLOSURE_GRACE_MS - 1000;

    expect(canCloseSession(start, justInside)).toBe(true);
    expect(canCloseSession(start, justOutside)).toBe(false);
  });

  it("is exact at the boundary", () => {
    const start = new Date("2026-09-02T16:00:00.000Z");
    expect(canCloseSession(start, start.getTime() - EARLY_CLOSURE_GRACE_MS)).toBe(true);
  });

  it("refuses a session even one day out", () => {
    const start = new Date("2026-09-03T16:00:00.000Z");
    expect(canCloseSession(start, at("2026-09-02T16:00:00.000Z"))).toBe(false);
  });

  it("says nothing about an appointment with no start yet", () => {
    // Still awaiting scheduling — other guards decide; manual invoicing relies
    // on this staying permissive.
    expect(canCloseSession(null, at("2026-09-02T16:00:00.000Z"))).toBe(true);
    expect(canCloseSession(undefined, at("2026-09-02T16:00:00.000Z"))).toBe(true);
    expect(canCloseSession(new Date("nonsense"), at("2026-09-02T16:00:00.000Z"))).toBe(true);
  });

  it("reports zero wait once closing is allowed", () => {
    const start = new Date("2026-09-02T16:00:00.000Z");
    expect(sessionClosureWindow(start, at("2026-09-02T18:00:00.000Z")).waitMs).toBe(0);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  holds: [] as Record<string, unknown>[],
  sessionFilters: [] as Record<string, unknown>[],
  holdFilters: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/Appointment", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.sessionFilters.push(filter);
      return { select: () => ({ lean: async () => h.sessions }) };
    },
  },
}));
vi.mock("@/models/SlotHold", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.holdFilters.push(filter);
      return { select: () => ({ lean: async () => h.holds }) };
    },
  },
}));

import {
  findSlotCollision,
  loadOccupiedIntervals,
  sessionInterval,
  slotCollisionError,
} from "@/lib/slot-occupancy";

const PRO = "0123456789abcdef01234567";
const OTHER = "0123456789abcdef0123cccc";
const now = new Date("2026-09-14T13:00:00Z");

beforeEach(() => {
  h.sessions = [];
  h.holds = [];
  h.sessionFilters = [];
  h.holdFilters = [];
});

describe("sessionInterval", () => {
  it("places a session by its stored day and Montréal time", () => {
    // Stored at UTC noon, as parseAppointmentDate writes it.
    expect(sessionInterval({ date: new Date("2026-09-16T12:00:00Z"), time: "10:00", duration: 50 })).toEqual({
      startsAt: new Date("2026-09-16T14:00:00Z"),
      endsAt: new Date("2026-09-16T14:50:00Z"),
    });
    // A legacy row at UTC midnight is the same day.
    expect(sessionInterval({ date: new Date("2026-09-16T00:00:00Z"), time: "9:00" })).toEqual({
      startsAt: new Date("2026-09-16T13:00:00Z"),
      endsAt: new Date("2026-09-16T14:00:00Z"),
    });
    expect(sessionInterval({ date: new Date("2026-09-16T12:00:00Z"), time: null })).toBeNull();
  });
});

describe("loadOccupiedIntervals", () => {
  it("reads sessions under way or scheduled, and live holds, a day either side", async () => {
    h.sessions = [{ _id: "s1", date: new Date("2026-09-16T12:00:00Z"), time: "10:00", duration: 60 }];
    h.holds = [{ _id: "h1", startsAt: new Date("2026-09-16T17:00:00Z"), durationMinutes: 30 }];
    const occupied = await loadOccupiedIntervals({ professionalId: PRO, fromDay: "2026-09-16", toDay: "2026-09-17", now });
    expect(occupied).toEqual([
      { kind: "session", id: "s1", startsAt: new Date("2026-09-16T14:00:00Z"), endsAt: new Date("2026-09-16T15:00:00Z") },
      { kind: "hold", id: "h1", startsAt: new Date("2026-09-16T17:00:00Z"), endsAt: new Date("2026-09-16T17:30:00Z") },
    ]);
    expect(h.sessionFilters[0]).toMatchObject({
      status: { $in: ["scheduled", "ongoing"] },
      date: { $gte: new Date("2026-09-15T00:00:00Z"), $lt: new Date("2026-09-19T00:00:00Z") },
    });
    expect(String(h.sessionFilters[0].professionalId)).toBe(PRO);
    expect(h.holdFilters[0]).toMatchObject({
      dayKey: { $gte: "2026-09-15", $lte: "2026-09-18" },
      expiresAt: { $gt: now },
    });
  });

  it("leaves the request itself out of both", async () => {
    await loadOccupiedIntervals({ professionalId: PRO, fromDay: "2026-09-16", toDay: "2026-09-16", exceptAppointmentId: OTHER });
    expect(String((h.sessionFilters[0]._id as { $ne: unknown }).$ne)).toBe(OTHER);
    expect(String((h.holdFilters[0].appointmentId as { $ne: unknown }).$ne)).toBe(OTHER);
  });

  it("does not query for a malformed professional or day", async () => {
    expect(await loadOccupiedIntervals({ professionalId: "nope", fromDay: "2026-09-16", toDay: "2026-09-16" })).toEqual([]);
    expect(await loadOccupiedIntervals({ professionalId: PRO, fromDay: "soon", toDay: "2026-09-16" })).toEqual([]);
    expect(h.sessionFilters).toEqual([]);
  });
});

describe("findSlotCollision", () => {
  const at = { professionalId: PRO, dayKey: "2026-09-16", time: "10:00", durationMinutes: 60, now };

  it("names a session before a hold when both overlap", async () => {
    h.sessions = [{ _id: "s1", date: new Date("2026-09-16T12:00:00Z"), time: "10:30", duration: 60 }];
    h.holds = [{ _id: "h1", startsAt: new Date("2026-09-16T14:00:00Z"), durationMinutes: 60 }];
    const collision = await findSlotCollision(at);
    expect(collision).toMatchObject({ kind: "session", id: "s1" });
    expect(slotCollisionError(collision!)).toEqual({ error: "This time slot is already booked", code: "SLOT_CONFLICT" });
  });

  it("looks only at holds when asked", async () => {
    h.sessions = [{ _id: "s1", date: new Date("2026-09-16T12:00:00Z"), time: "10:00", duration: 60 }];
    expect(await findSlotCollision({ ...at, holdsOnly: true })).toBeNull();
    h.holds = [{ _id: "h1", startsAt: new Date("2026-09-16T14:30:00Z"), durationMinutes: 60 }];
    const collision = await findSlotCollision({ ...at, holdsOnly: true });
    expect(collision).toMatchObject({ kind: "hold", id: "h1" });
    expect(slotCollisionError(collision!).code).toBe("SLOT_HELD");
  });

  it("lets a consultation end exactly when the next one starts", async () => {
    h.sessions = [{ _id: "s1", date: new Date("2026-09-16T12:00:00Z"), time: "11:00", duration: 60 }];
    expect(await findSlotCollision(at)).toBeNull();
  });

  it("finds nothing for a time it cannot place", async () => {
    expect(await findSlotCollision({ ...at, time: "ten" })).toBeNull();
    expect(h.sessionFilters).toEqual([]);
  });
});

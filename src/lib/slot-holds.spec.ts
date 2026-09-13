import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  createError: null as unknown,
  takenOver: null as Record<string, unknown> | null,
  live: null as Record<string, unknown> | null,
  deletedCount: 1,
  modifiedCount: 1,
  created: [] as Record<string, unknown>[],
  takeoverCalls: [] as [Record<string, unknown>, Record<string, unknown>][],
  deleteFilters: [] as Record<string, unknown>[],
  updateCalls: [] as [Record<string, unknown>, Record<string, unknown>][],
  findFilters: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/SlotHold", () => {
  const lean = (value: () => unknown) => ({ select: () => ({ lean: async () => value() }) });
  return {
    default: {
      create: async (doc: Record<string, unknown>) => {
        h.created.push(doc);
        if (h.createError) throw h.createError;
        return { _id: "hold-new" };
      },
      findOneAndUpdate: (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        h.takeoverCalls.push([filter, update]);
        return lean(() => h.takenOver);
      },
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        h.updateCalls.push([filter, update]);
        return { modifiedCount: h.modifiedCount };
      },
      deleteOne: async (filter: Record<string, unknown>) => {
        h.deleteFilters.push(filter);
        return { deletedCount: h.deletedCount };
      },
      findOne: (filter: Record<string, unknown>) => {
        h.findFilters.push(filter);
        return lean(() => h.live);
      },
    },
  };
});

import {
  acquireSlotHold,
  attachSlotHoldToAppointment,
  findLiveSlotHold,
  releaseSlotHold,
} from "@/lib/slot-holds";

const PRO = "0123456789abcdef01234567";
const APPOINTMENT = "0123456789abcdef0123aaaa";
const now = new Date("2026-09-14T13:00:00Z");
const slot = {
  professionalId: PRO,
  dayKey: "2026-09-16",
  time: "10:00",
  startsAt: new Date("2026-09-16T14:00:00Z"),
  durationMinutes: 50,
  kind: "direct_request" as const,
  expiresAt: new Date("2026-09-15T13:00:00Z"),
  now,
};

beforeEach(() => {
  h.createError = null;
  h.takenOver = null;
  h.live = null;
  h.deletedCount = 1;
  h.modifiedCount = 1;
  h.created = [];
  h.takeoverCalls = [];
  h.deleteFilters = [];
  h.updateCalls = [];
  h.findFilters = [];
});

describe("acquireSlotHold", () => {
  it("holds a free slot: the first insert wins", async () => {
    expect(await acquireSlotHold(slot)).toEqual({ ok: true, holdId: "hold-new" });
    expect(String(h.created[0].professionalId)).toBe(PRO);
    expect(h.created[0]).toMatchObject({ dayKey: "2026-09-16", time: "10:00", kind: "direct_request", durationMinutes: 50 });
    expect(h.takeoverCalls).toEqual([]);
  });

  it("refuses a slot somebody holds", async () => {
    h.createError = { code: 11000 };
    expect(await acquireSlotHold(slot)).toEqual({ ok: false, code: "SLOT_TAKEN" });
  });

  it("takes over a hold that already expired, only while it is still expired", async () => {
    h.createError = { code: 11000 };
    h.takenOver = { _id: "hold-old" };
    expect(await acquireSlotHold(slot)).toEqual({ ok: true, holdId: "hold-old" });
    const [filter, update] = h.takeoverCalls[0];
    expect(filter).toMatchObject({ dayKey: "2026-09-16", time: "10:00", expiresAt: { $lte: now } });
    expect(String(filter.professionalId)).toBe(PRO);
    // The previous holder's links are cleared, never carried over.
    expect(update).toMatchObject({ $set: { durationMinutes: 50 }, $unset: { appointmentId: "", waitlistEntryId: "" } });
  });

  it("does not swallow other database errors", async () => {
    h.createError = new Error("connection lost");
    await expect(acquireSlotHold(slot)).rejects.toThrow("connection lost");
  });
});

describe("attachSlotHoldToAppointment", () => {
  it("records the request only on a hold nobody claimed", async () => {
    expect(await attachSlotHoldToAppointment("0123456789abcdef0123bbbb", APPOINTMENT)).toBe(true);
    expect(h.updateCalls[0][0]).toEqual({ _id: "0123456789abcdef0123bbbb", appointmentId: { $exists: false } });
    h.modifiedCount = 0;
    expect(await attachSlotHoldToAppointment("0123456789abcdef0123bbbb", APPOINTMENT)).toBe(false);
    expect(await attachSlotHoldToAppointment("nope", APPOINTMENT)).toBe(false);
  });
});

describe("releaseSlotHold", () => {
  it("frees the hold only while its owner still holds it", async () => {
    expect(await releaseSlotHold("0123456789abcdef0123bbbb", { appointmentId: APPOINTMENT })).toBe(true);
    expect(h.deleteFilters[0]).toEqual({ _id: "0123456789abcdef0123bbbb", appointmentId: APPOINTMENT });
    h.deletedCount = 0;
    expect(await releaseSlotHold("0123456789abcdef0123bbbb", { appointmentId: APPOINTMENT })).toBe(false);
  });

  it("does not query with a malformed id", async () => {
    expect(await releaseSlotHold("../x")).toBe(false);
    expect(h.deleteFilters).toEqual([]);
  });
});

describe("findLiveSlotHold", () => {
  it("finds a live hold, never an expired one", async () => {
    h.live = { _id: "hold-1", kind: "direct_request", appointmentId: APPOINTMENT };
    expect(await findLiveSlotHold({ professionalId: PRO, dayKey: "2026-09-16", time: "10:00" }, now)).toEqual({
      holdId: "hold-1",
      kind: "direct_request",
      appointmentId: APPOINTMENT,
    });
    expect(h.findFilters[0]).toMatchObject({ dayKey: "2026-09-16", time: "10:00", expiresAt: { $gt: now } });
  });
});

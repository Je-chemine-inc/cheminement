/**
 * Admin substitution edit/cancel: PATCH/DELETE /api/admin/appointments/[id].
 * Pins the guard (admin + manageUsers), the reschedule guards (past-date 400,
 * double-booking 409), and that a real slot move / cancel notifies BOTH parties
 * (actor "admin") via sendAppointmentChangeNotification.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";
const ADMIN_ID = "d1d1d1d1d1d1d1d1d1d1d1d1";
const CLIENT_ID = "c1c1c1c1c1c1c1c1c1c1c1c1";
const PRO_ID = "b1b1b1b1b1b1b1b1b1b1b1b1";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const notify = vi.fn().mockResolvedValue({ clientOk: true, proOk: true });
  const conflictFindOne = vi.fn();
  const store: {
    appointment: Record<string, unknown>;
    admin: unknown;
  } = { appointment: {}, admin: { permissions: { manageUsers: true } } };
  const makeQuery = (result: unknown) => ({
    populate() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });
  return { getServerSession, notify, conflictFindOne, store, makeQuery };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  after: (fn: () => void) => {
    fn();
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications", () => ({
  sendAppointmentChangeNotification: h.notify,
}));
vi.mock("@/models/Admin", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(h.store.admin) }) }),
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => h.makeQuery(h.store.appointment),
    findOne: h.conflictFindOne,
  },
}));

import {
  PATCH as adminPATCH,
  DELETE as adminDELETE,
} from "@/app/api/admin/appointments/[id]/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const callPatch = (
  body: Record<string, unknown>,
  role = "admin",
  userId = ADMIN_ID,
): Res => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return adminPATCH(
    { json: async () => body } as never,
    { params: Promise.resolve({ id: APPT_ID }) },
  ) as unknown as Res;
};

const callDelete = (role = "admin", userId = ADMIN_ID): Res => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return adminDELETE(
    {} as never,
    { params: Promise.resolve({ id: APPT_ID }) },
  ) as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.admin = { permissions: { manageUsers: true } };
  h.conflictFindOne.mockResolvedValue(null);
  h.store.appointment = {
    _id: APPT_ID,
    clientId: {
      _id: CLIENT_ID,
      firstName: "Alex",
      lastName: "Client",
      email: "client@example.com",
      language: "fr",
    },
    professionalId: {
      _id: PRO_ID,
      firstName: "Dr",
      lastName: "Pro",
      email: "pro@example.com",
      language: "en",
    },
    date: new Date("2099-01-15T00:00:00Z"),
    time: "14:00",
    duration: 50,
    type: "video",
    status: "scheduled",
    save: vi.fn().mockResolvedValue(undefined),
  };
});

describe("PATCH /api/admin/appointments/[id] — guards", () => {
  it("rejects a non-admin (401)", async () => {
    const res = await callPatch({ time: "15:00" }, "professional", PRO_ID);
    expect(res.status).toBe(401);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("rejects an admin without manageUsers (403)", async () => {
    h.store.admin = { permissions: { manageBilling: true } };
    const res = await callPatch({ time: "15:00" });
    expect(res.status).toBe(403);
  });

  it("rejects a double-booking conflict (409) and does not save/notify", async () => {
    h.conflictFindOne.mockResolvedValueOnce({ _id: "other" });
    const res = await callPatch({ date: "2099-02-20", time: "10:00" });
    expect(res.status).toBe(409);
    expect(h.store.appointment.save).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("rejects moving into the past (400)", async () => {
    const res = await callPatch({ date: "2000-01-01", time: "10:00" });
    expect(res.status).toBe(400);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/appointments/[id] — reschedule notifies both", () => {
  it("moves the slot, saves, and notifies both parties (actor admin)", async () => {
    const res = await callPatch({ date: "2099-02-20", time: "10:00" });
    expect(res.status).toBe(200);
    expect(h.store.appointment.save).toHaveBeenCalledTimes(1);
    expect(h.store.appointment.time).toBe("10:00");
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][0]).toMatchObject({
      action: "rescheduled",
      actor: "admin",
      clientEmail: "client@example.com",
      professionalEmail: "pro@example.com",
    });
  });

  it("a fields-only edit (no slot change) does NOT notify", async () => {
    const res = await callPatch({ notes: "call ahead" });
    expect(res.status).toBe(200);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/appointments/[id] — cancel on behalf", () => {
  it("cancels, stamps admin, and notifies both parties", async () => {
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(h.store.appointment.status).toBe("cancelled");
    expect(h.store.appointment.cancelledBy).toBe("admin");
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][0]).toMatchObject({
      action: "cancelled",
      actor: "admin",
    });
  });

  it("is idempotent when already cancelled (no second notify)", async () => {
    h.store.appointment.status = "cancelled";
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ alreadyCancelled: true });
    expect(h.notify).not.toHaveBeenCalled();
  });
});

/**
 * Professional self-service edit/cancel: PATCH/DELETE
 * /api/professional/appointments/[id]. Pins ownership (only the assigned pro),
 * the reschedule guards (past-date 400, double-booking 409), and that a real
 * slot move / cancel notifies the CLIENT (actor "professional").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT_ID = "a2a2a2a2a2a2a2a2a2a2a2a2";
const CLIENT_ID = "c2c2c2c2c2c2c2c2c2c2c2c2";
const PRO_ID = "b2b2b2b2b2b2b2b2b2b2b2b2";
const OTHER_PRO_ID = "e2e2e2e2e2e2e2e2e2e2e2e2";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const notify = vi.fn().mockResolvedValue({ clientOk: true, proOk: false });
  const conflictFindOne = vi.fn();
  const store: { appointment: Record<string, unknown> } = { appointment: {} };
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
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => h.makeQuery(h.store.appointment),
    findOne: h.conflictFindOne,
  },
}));

import {
  PATCH as proPATCH,
  DELETE as proDELETE,
} from "@/app/api/professional/appointments/[id]/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const callPatch = (
  body: Record<string, unknown>,
  role = "professional",
  userId = PRO_ID,
): Res => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return proPATCH(
    { json: async () => body } as never,
    { params: Promise.resolve({ id: APPT_ID }) },
  ) as unknown as Res;
};

const callDelete = (role = "professional", userId = PRO_ID): Res => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return proDELETE(
    {} as never,
    { params: Promise.resolve({ id: APPT_ID }) },
  ) as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
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
      language: "fr",
    },
    date: new Date("2099-01-15T00:00:00Z"),
    time: "14:00",
    duration: 50,
    type: "video",
    status: "scheduled",
    save: vi.fn().mockResolvedValue(undefined),
  };
});

describe("PATCH /api/professional/appointments/[id] — ownership", () => {
  it("rejects a non-professional (401)", async () => {
    const res = await callPatch({ time: "15:00" }, "client", CLIENT_ID);
    expect(res.status).toBe(401);
  });

  it("rejects a professional who does not own the appointment (403)", async () => {
    const res = await callPatch({ time: "15:00" }, "professional", OTHER_PRO_ID);
    expect(res.status).toBe(403);
    expect(h.store.appointment.save).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/professional/appointments/[id] — reschedule", () => {
  it("rejects a double-booking conflict (409)", async () => {
    h.conflictFindOne.mockResolvedValueOnce({ _id: "other" });
    const res = await callPatch({ date: "2099-02-20", time: "10:00" });
    expect(res.status).toBe(409);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("rejects moving into the past (400)", async () => {
    const res = await callPatch({ date: "2000-01-01" });
    expect(res.status).toBe(400);
  });

  it("moves the slot, saves, and notifies the client (actor professional)", async () => {
    const res = await callPatch({ date: "2099-02-20", time: "10:00" });
    expect(res.status).toBe(200);
    expect(h.store.appointment.save).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][0]).toMatchObject({
      action: "rescheduled",
      actor: "professional",
      clientEmail: "client@example.com",
    });
  });
});

describe("DELETE /api/professional/appointments/[id] — cancel own", () => {
  it("rejects a non-owner professional (403)", async () => {
    const res = await callDelete("professional", OTHER_PRO_ID);
    expect(res.status).toBe(403);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("cancels own appointment and notifies the client", async () => {
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(h.store.appointment.status).toBe("cancelled");
    expect(h.store.appointment.cancelledBy).toBe("professional");
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][0]).toMatchObject({
      action: "cancelled",
      actor: "professional",
    });
  });
});

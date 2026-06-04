/**
 * §4 "Fixer directement un rendez-vous": the admin schedules a pending
 * service-request dossier IN PLACE (assign pro + date + time → scheduled) from
 * the Demande de service / Pool Général queues. The "raison du rendez-vous"
 * (motif) must be STRICTLY OPTIONAL and never block the action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const REQ_ID = "a4a4a4a4a4a4a4a4a4a4a4a4";
const PRO_ID = "b4b4b4b4b4b4b4b4b4b4b4b4";
const ADMIN_ID = "d4d4d4d4d4d4d4d4d4d4d4d4";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const notif = {
    sendAppointmentConfirmation: vi.fn().mockResolvedValue(true),
    sendProfessionalNotification: vi.fn().mockResolvedValue(true),
  };
  const store: { appointment: Record<string, unknown> } = { appointment: {} };
  const makeQuery = (result: unknown) => ({
    populate() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });
  return { getServerSession, notif, store, makeQuery };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  // Run after() callbacks synchronously so we can assert the emails fired.
  after: (cb: () => unknown) => {
    const r = cb();
    if (r && typeof (r as Promise<unknown>).catch === "function") {
      (r as Promise<unknown>).catch(() => {});
    }
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi.fn().mockResolvedValue({
    sessionPrice: 120,
    platformFee: 20,
    professionalPayout: 100,
  }),
}));
vi.mock("@/lib/notifications", () => h.notif);
vi.mock("@/models/Admin", () => ({
  default: { findOne: () => Promise.resolve({ permissions: { manageUsers: true } }) },
}));
vi.mock("@/models/User", () => ({
  default: {
    findOne: () =>
      Promise.resolve({
        _id: PRO_ID,
        firstName: "Dr",
        lastName: "Pro",
        email: "pro@example.com",
      }),
  },
}));
vi.mock("@/models/Profile", () => ({
  default: { findOne: () => Promise.resolve({ availability: { sessionDurationMinutes: 50 } }) },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => h.makeQuery(h.store.appointment),
    findOne: () => Promise.resolve(null), // no double-booking conflict
  },
}));

import { POST as schedulePOST } from "@/app/api/admin/service-requests/[id]/schedule/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (body: Record<string, unknown>): Res => {
  h.getServerSession.mockResolvedValueOnce({
    user: { id: ADMIN_ID, role: "admin" },
  });
  return schedulePOST(
    { json: async () => body } as never,
    { params: Promise.resolve({ id: REQ_ID }) },
  ) as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.appointment = {
    _id: REQ_ID,
    status: "pending",
    routingStatus: "awaiting_admin",
    type: "video",
    therapyType: "solo",
    duration: 60,
    issueType: "Anxiété",
    proposedTo: [PRO_ID],
    payment: { price: 0, platformFee: 0, professionalPayout: 0, status: "pending" },
    clientId: {
      _id: "c4c4c4c4c4c4c4c4c4c4c4c4",
      firstName: "Alex",
      lastName: "Test",
      email: "client@example.com",
      language: "fr",
    },
    save: vi.fn().mockResolvedValue(undefined),
  };
});

describe("admin direct schedule (§4 Fixer un rendez-vous)", () => {
  it("schedules a dossier in place WITHOUT a motif (reason is optional)", async () => {
    const res = await call({
      professionalId: PRO_ID,
      date: "2099-01-15",
      time: "10:00",
      type: "video",
      duration: 50,
      // no motif on purpose
    });

    const appt = h.store.appointment;
    expect(res.status).toBe(200);
    expect(appt.status).toBe("scheduled");
    expect(appt.routingStatus).toBe("accepted");
    expect(String(appt.professionalId)).toBe(PRO_ID);
    expect(appt.time).toBe("10:00");
    expect(appt.matchedAt).toBeInstanceOf(Date);
    // proposal bookkeeping cleared
    expect(appt.proposedTo).toBeUndefined();
    // existing problématique preserved when no motif is given
    expect(appt.issueType).toBe("Anxiété");
    // pricing refreshed to the chosen pro
    expect((appt.payment as { price: number }).price).toBe(120);
    // both parties confirmed
    expect(h.notif.sendAppointmentConfirmation).toHaveBeenCalledTimes(1);
    expect(h.notif.sendProfessionalNotification).toHaveBeenCalledTimes(1);
    expect(h.store.appointment.save).toHaveBeenCalled();
  });

  it("stores the motif when one IS provided", async () => {
    await call({
      professionalId: PRO_ID,
      date: "2099-01-15",
      time: "11:00",
      motif: "Dépression",
    });
    expect(h.store.appointment.issueType).toBe("Dépression");
    expect(h.store.appointment.needs).toEqual(["Dépression"]);
  });

  it("rejects when date/time are missing", async () => {
    const res = await call({ professionalId: PRO_ID });
    expect(res.status).toBe(400);
    expect(h.store.appointment.status).toBe("pending"); // untouched
  });

  it("rejects scheduling a dossier that is not pending (409)", async () => {
    h.store.appointment.status = "scheduled";
    const res = await call({
      professionalId: PRO_ID,
      date: "2099-01-15",
      time: "12:00",
    });
    expect(res.status).toBe(409);
  });
});

/**
 * Authorization regression for PATCH /api/appointments/[id].
 *
 * This route used to check only that a session existed — any authenticated user
 * could patch / cancel / reschedule ANY appointment by id. These tests pin the
 * ownership guard: a professional who isn't assigned and a client who doesn't
 * own (and isn't a guardian) both get 403 with no write; the assigned
 * professional is allowed through.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT_ID = "f1f1f1f1f1f1f1f1f1f1f1f1";
const CLIENT_ID = "c3c3c3c3c3c3c3c3c3c3c3c3";
const PRO_ID = "b3b3b3b3b3b3b3b3b3b3b3b3";
const OTHER_ID = "e3e3e3e3e3e3e3e3e3e3e3e3";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const canAccessAccount = vi.fn().mockResolvedValue(false);
  const findByIdAndUpdate = vi.fn();
  const store: { appointment: Record<string, unknown> } = { appointment: {} };
  const makeQuery = (result: unknown) => ({
    populate() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });
  return { getServerSession, canAccessAccount, findByIdAndUpdate, store, makeQuery };
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
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => h.makeQuery(h.store.appointment),
    findByIdAndUpdate: h.findByIdAndUpdate,
  },
}));
vi.mock("@/models/User", () => ({
  default: { findById: () => Promise.resolve(null) },
}));
vi.mock("@/lib/notifications", () => ({
  sendGuestPaymentConfirmation: vi.fn(),
  sendPaymentInvitation: vi.fn(),
  sendMeetingLinkNotification: vi.fn(),
  sendCancellationNotification: vi.fn().mockResolvedValue(true),
  sendRefundConfirmation: vi.fn(),
  sendAdminRequestReturnedToQueueAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/guardian-utils", () => ({
  resolveAppointmentRecipient: () => ({
    name: "Alex",
    email: "client@example.com",
    language: "fr",
  }),
  canAccessAccount: h.canAccessAccount,
}));
vi.mock("@/lib/client-portal-urls", () => ({ resolveBillingUrl: vi.fn() }));
vi.mock("@/lib/payment-settlement", () => ({ voidReceiptForRefund: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: { refunds: { create: vi.fn() } } }));
vi.mock("@/lib/provision-guest-as-client", () => ({
  provisionGuestAsClient: vi.fn(),
}));

import { PATCH as apptPATCH } from "@/app/api/appointments/[id]/route";
import {
  sendCancellationNotification,
  sendAdminRequestReturnedToQueueAlert,
} from "@/lib/notifications";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const callPatch = (
  body: Record<string, unknown>,
  role: string,
  userId: string,
): Res => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return apptPATCH(
    { json: async () => body } as never,
    { params: Promise.resolve({ id: APPT_ID }) },
  ) as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.canAccessAccount.mockResolvedValue(false);
  h.findByIdAndUpdate.mockImplementation(() => h.makeQuery(h.store.appointment));
  h.store.appointment = {
    _id: APPT_ID,
    clientId: CLIENT_ID,
    professionalId: PRO_ID,
    status: "scheduled",
    date: new Date("2099-01-15T00:00:00Z"),
    time: "14:00",
    type: "video",
    payment: { status: "pending" },
    toObject: () => ({ _id: APPT_ID, status: "scheduled" }),
  };
});

describe("PATCH /api/appointments/[id] — ownership guard", () => {
  it("rejects a professional who is not assigned to the appointment (403)", async () => {
    const res = await callPatch({ time: "15:00" }, "professional", OTHER_ID);
    expect(res.status).toBe(403);
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a client who does not own it and is not a guardian (403)", async () => {
    const res = await callPatch({ status: "cancelled" }, "client", OTHER_ID);
    expect(res.status).toBe(403);
    expect(h.canAccessAccount).toHaveBeenCalledWith(OTHER_ID, CLIENT_ID);
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("allows the assigned professional through (200)", async () => {
    const res = await callPatch({ notes: "call ahead" }, "professional", PRO_ID);
    expect(res.status).toBe(200);
    expect(h.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  it("allows a guardian of the client (200)", async () => {
    h.canAccessAccount.mockResolvedValue(true);
    const res = await callPatch({ notes: "from guardian" }, "client", OTHER_ID);
    expect(res.status).toBe(200);
    expect(h.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/appointments/[id] — professional refusing a demande", () => {
  beforeEach(() => {
    // An UNASSIGNED, PENDING service request (a "demande"), proposed to a pro.
    h.store.appointment = {
      _id: APPT_ID,
      clientId: CLIENT_ID,
      professionalId: null,
      status: "pending",
      type: "video",
      payment: { status: "pending" },
      toObject: () => ({ _id: APPT_ID, status: "pending" }),
    };
  });

  it("does NOT email the client; returns the demande to the admin queue + alerts admins", async () => {
    const res = await callPatch({ status: "cancelled" }, "professional", PRO_ID);
    expect(res.status).toBe(200);

    // The update was rewritten: not a cancellation, but a return-to-queue.
    const updateArg = h.findByIdAndUpdate.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(updateArg.status).toBeUndefined();
    expect(updateArg.routingStatus).toBe("awaiting_admin");
    expect(updateArg.$addToSet).toEqual({ refusedBy: PRO_ID });

    // Client stays silent; only the admin is alerted (the "drapeau").
    expect(sendCancellationNotification).not.toHaveBeenCalled();
    expect(sendAdminRequestReturnedToQueueAlert).toHaveBeenCalledTimes(1);
  });
});

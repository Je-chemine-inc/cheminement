/**
 * C1 regression: POST /api/payments/refund must be ADMIN-ONLY.
 *
 * This route is orphaned (no UI caller) but authenticated-reachable. It used to
 * authorize the appointment's client or professional, letting a client POST
 * their own appointmentId and claw back a full, policy-free Stripe refund —
 * even after attending a paid session. These tests pin the lock-down: only an
 * admin reaches stripe.refunds.create; a client or professional gets 403 and no
 * refund is issued. (The legitimate, policy-gated refund-on-cancel lives in
 * PATCH /api/appointments/[id] and is unaffected.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const CLIENT_ID = "cccccccccccccccccccccccc";
const PRO_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ADMIN_ID = "dddddddddddddddddddddddd";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const refundsCreate = vi.fn().mockResolvedValue({
    id: "re_test_1",
    amount: 12000,
    status: "succeeded",
  });
  const sendRefundConfirmation = vi.fn().mockResolvedValue(true);
  const store: { appointment: Record<string, unknown> } = { appointment: {} };
  const makeQuery = (result: unknown) => ({
    populate() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });
  return { getServerSession, refundsCreate, sendRefundConfirmation, store, makeQuery };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/stripe", () => ({
  stripe: { refunds: { create: h.refundsCreate } },
}));
vi.mock("@/lib/notifications", () => ({
  sendRefundConfirmation: h.sendRefundConfirmation,
}));
vi.mock("@/lib/guardian-utils", () => ({
  resolveAppointmentRecipient: () => ({
    name: "Alex Test",
    email: "client@example.com",
    language: "en",
  }),
}));
vi.mock("@/models/Appointment", () => ({
  default: { findById: () => h.makeQuery(h.store.appointment) },
}));
vi.mock("@/lib/payment-settlement", () => ({
  voidReceiptForRefund: vi.fn().mockResolvedValue(undefined),
}));

import { POST as refundPOST } from "@/app/api/payments/refund/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.store.appointment = {
    _id: APPT_ID,
    clientId: {
      _id: CLIENT_ID,
      firstName: "Alex",
      lastName: "Test",
      email: "client@example.com",
      language: "en",
    },
    professionalId: { _id: PRO_ID, firstName: "Dr", lastName: "Pro" },
    bookingFor: "self",
    date: new Date("2099-01-15T10:00:00Z"),
    payment: { stripePaymentIntentId: "pi_test_1", status: "paid", price: 120 },
    save: async () => {},
  };
});

const callRefund = (role: string, userId: string) => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return refundPOST({
    json: async () => ({ appointmentId: APPT_ID, reason: "test" }),
  } as never) as unknown as Promise<{
    status: number;
    body: Record<string, unknown>;
  }>;
};

describe("POST /api/payments/refund — admin-only (C1)", () => {
  it("rejects a client refunding their own appointment (403, no Stripe refund)", async () => {
    const res = await callRefund("client", CLIENT_ID);
    expect(res.status).toBe(403);
    expect(h.refundsCreate).not.toHaveBeenCalled();
    // payment status untouched
    expect((h.store.appointment.payment as Record<string, unknown>).status).toBe(
      "paid",
    );
  });

  it("rejects the assigned professional (403, no Stripe refund)", async () => {
    const res = await callRefund("professional", PRO_ID);
    expect(res.status).toBe(403);
    expect(h.refundsCreate).not.toHaveBeenCalled();
  });

  it("allows an admin to refund (200, Stripe refund issued once, status flips)", async () => {
    const res = await callRefund("admin", ADMIN_ID);
    expect(res.status).toBe(200);
    expect(h.refundsCreate).toHaveBeenCalledTimes(1);
    expect((h.store.appointment.payment as Record<string, unknown>).status).toBe(
      "refunded",
    );
  });
});

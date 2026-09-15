/**
 * POST /api/payments/refund — admin-only (C1), and the refund goes through the idempotent refund
 * (lib/appointment-refund.ts): a double click or a retry never refunds twice.
 *
 * This route is orphaned (no UI caller) but authenticated-reachable. It used to authorize the
 * appointment's client or professional, letting a client claw back a full, policy-free refund.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const CLIENT_ID = "cccccccccccccccccccccccc";
const PRO_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ADMIN_ID = "dddddddddddddddddddddddd";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const refund = vi.fn();
  const sendRefundConfirmation = vi.fn().mockResolvedValue(true);
  const store: { appointment: Record<string, unknown> | null } = { appointment: {} };
  const makeQuery = (result: () => unknown) => ({
    populate() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result()).then(res, rej);
    },
  });
  return { getServerSession, refund, sendRefundConfirmation, store, makeQuery };
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
vi.mock("@/lib/appointment-refund", () => ({ refundAppointmentPayment: h.refund }));
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
  default: { findById: () => h.makeQuery(() => h.store.appointment) },
}));

import { POST as refundPOST } from "@/app/api/payments/refund/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.refund.mockResolvedValue({ outcome: "refunded", stripeRefundId: "re_test_1", amountCents: 12000, full: true, pending: false });
  h.store.appointment = {
    _id: APPT_ID,
    clientId: { _id: CLIENT_ID, firstName: "Alex", lastName: "Test", email: "client@example.com", language: "en" },
    professionalId: { _id: PRO_ID, firstName: "Dr", lastName: "Pro" },
    bookingFor: "self",
    date: new Date("2099-01-15T10:00:00Z"),
    payment: { stripePaymentIntentId: "pi_test_1", status: "paid", price: 120 },
  };
});

const callRefund = (role: string, userId: string, body: Record<string, unknown> = { appointmentId: APPT_ID, reason: "test" }) => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return refundPOST({ json: async () => body } as never) as unknown as Promise<{
    status: number;
    body: Record<string, unknown>;
  }>;
};

describe("POST /api/payments/refund — admin-only (C1)", () => {
  it("rejects a client refunding their own appointment (403, no refund)", async () => {
    const res = await callRefund("client", CLIENT_ID);
    expect(res.status).toBe(403);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("rejects the assigned professional (403, no refund)", async () => {
    const res = await callRefund("professional", PRO_ID);
    expect(res.status).toBe(403);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("lets an admin refund the full price through the idempotent refund, and tells the client", async () => {
    const res = await callRefund("admin", ADMIN_ID);
    expect(res.status).toBe(200);
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(h.refund).toHaveBeenCalledWith({ appointmentId: APPT_ID, amountCents: 12000, by: "admin", byUserId: ADMIN_ID, reason: "test" });
    expect(res.body).toMatchObject({ refund: { id: "re_test_1", amount: 120, status: "succeeded" }, appointment: { paymentStatus: "refunded" } });
    expect(h.sendRefundConfirmation).toHaveBeenCalledWith(expect.objectContaining({ amount: 120, email: "client@example.com" }));
  });
});

describe("POST /api/payments/refund — never twice", () => {
  it("refuses before any refund when already refunded, not paid, or with no card payment", async () => {
    for (const payment of [
      { stripePaymentIntentId: "pi_test_1", status: "refunded", price: 120 },
      { stripePaymentIntentId: "pi_test_1", status: "partially_refunded", price: 120 },
      { stripePaymentIntentId: "pi_test_1", status: "pending", price: 120 },
      { status: "paid", price: 120 },
    ]) {
      (h.store.appointment as Record<string, unknown>).payment = payment;
      expect((await callRefund("admin", ADMIN_ID)).status).toBe(400);
    }
    h.store.appointment = null;
    expect((await callRefund("admin", ADMIN_ID)).status).toBe(404);
    expect((await callRefund("admin", ADMIN_ID, {})).status).toBe(400);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("answers 409 when another request is refunding it or it was refunded meanwhile, and emails no one", async () => {
    h.refund.mockResolvedValueOnce({ outcome: "in_progress" });
    let res = await callRefund("admin", ADMIN_ID);
    expect(res).toMatchObject({ status: 409, body: { code: "REFUND_IN_PROGRESS" } });
    h.refund.mockResolvedValueOnce({ outcome: "not_refundable" });
    res = await callRefund("admin", ADMIN_ID);
    expect(res).toMatchObject({ status: 409, body: { code: "NOT_REFUNDABLE" } });
    expect(h.sendRefundConfirmation).not.toHaveBeenCalled();
  });

  it("says when Stripe refused, and when Stripe did not confirm (check before retrying)", async () => {
    h.refund.mockResolvedValueOnce({ outcome: "refused", message: "Charge already refunded" });
    let res = await callRefund("admin", ADMIN_ID);
    expect(res).toMatchObject({ status: 400, body: { code: "STRIPE_REFUSED", details: "Charge already refunded" } });
    h.refund.mockResolvedValueOnce({ outcome: "unconfirmed" });
    res = await callRefund("admin", ADMIN_ID);
    expect(res).toMatchObject({ status: 502, body: { code: "REFUND_UNCONFIRMED" } });
    expect(h.sendRefundConfirmation).not.toHaveBeenCalled();
  });
});

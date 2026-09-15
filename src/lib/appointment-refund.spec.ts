/**
 * Refunding a session's payment (admin refund and cancellation): claimed before Stripe, one
 * idempotency key per attempt, the real amount recorded, and neither a refusal nor an unknown
 * outcome ever turned into « nothing happened ». Stripe and the database are mocked; Stripe's error
 * classes are the real ones.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

const APPT = "0123456789abcdef0123aaaa";
const ADMIN = "0123456789abcdef0123dddd";
const now = new Date("2026-09-16T15:00:00Z");

const h = vi.hoisted(() => ({
  appointment: null as Record<string, unknown> | null,
  updates: [] as [Record<string, unknown>, Record<string, Record<string, unknown>>][],
  modified: [] as number[],
  create: vi.fn(),
  list: vi.fn(),
  voided: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/stripe", () => ({ stripe: { refunds: { create: h.create, list: h.list } } }));
vi.mock("@/lib/payment-settlement", () => ({
  voidReceiptForRefund: async (id: string) => {
    h.voided.push(id);
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: async () => h.appointment }) }),
    updateOne: async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      h.updates.push([filter, update]);
      return { modifiedCount: h.modified.length > 0 ? h.modified.shift() : 1 };
    },
  },
}));

import { APPOINTMENT_REFUND_CHECK_AFTER_MS, refundAppointmentPayment } from "@/lib/appointment-refund";

const paid = (over: Record<string, unknown> = {}) => ({
  _id: APPT,
  payment: { status: "paid", price: 120, stripePaymentIntentId: "pi_1", ...over },
});
const refund = (over: Partial<Stripe.Refund> = {}) =>
  ({ id: "re_1", amount: 12000, status: "succeeded", metadata: {}, ...over }) as Stripe.Refund;
const refuse = () => new Stripe.errors.StripeInvalidRequestError({ message: "Charge already refunded", statusCode: 400 } as never);
const unknown = () => new Stripe.errors.StripeAPIError({ message: "Stripe is down", statusCode: 500 } as never);
const run = (amountCents = 12000) =>
  refundAppointmentPayment({ appointmentId: APPT, amountCents, by: "admin", byUserId: ADMIN, reason: "Séance annulée", now });

beforeEach(() => {
  h.appointment = paid();
  h.updates = [];
  h.modified = [];
  h.voided = [];
  h.create.mockReset();
  h.list.mockReset();
  h.create.mockResolvedValue(refund());
});

describe("refundAppointmentPayment", () => {
  it("passes the caller's context to Stripe, but never lets it overwrite the refund's own keys", async () => {
    await refundAppointmentPayment({
      appointmentId: APPT,
      amountCents: 10200,
      by: "cancellation",
      reason: "Annulée",
      metadata: { cancelledBy: "client", cancellationFeeCents: "1800", type: "forged", attempt: "99" },
      now,
    });
    expect(h.create.mock.calls[0][0].metadata).toEqual({
      cancelledBy: "client",
      cancellationFeeCents: "1800",
      type: "appointment_refund",
      appointmentId: APPT,
      attempt: "1",
      by: "cancellation",
      refundReason: "Annulée",
    });
  });

  it("claims the refund first, asks Stripe once with the attempt's key, then records a full refund and voids the receipt", async () => {
    expect(await run()).toEqual({ outcome: "refunded", amountCents: 12000, stripeRefundId: "re_1", full: true, pending: false });
    const [claimFilter, claim] = h.updates[0];
    expect(claimFilter).toEqual({
      _id: APPT,
      "payment.status": "paid",
      "payment.stripePaymentIntentId": "pi_1",
      "payment.refundRequest": { $exists: false },
    });
    expect(claim.$set["payment.refundRequest"]).toMatchObject({ status: "requested", attempt: 1, amountCents: 12000, by: "admin", requestedAt: now });
    expect(h.create).toHaveBeenCalledTimes(1);
    const [params, options] = h.create.mock.calls[0];
    expect(params).toMatchObject({ payment_intent: "pi_1", amount: 12000, metadata: { type: "appointment_refund", appointmentId: APPT, attempt: "1" } });
    expect(options).toEqual({ idempotencyKey: `apptref_${APPT}_1` });
    const [adoptFilter, adopted] = h.updates[1];
    expect(adoptFilter).toEqual({ _id: APPT, "payment.refundRequest.attempt": 1, "payment.refundRequest.status": "requested" });
    expect(adopted.$set).toMatchObject({
      "payment.refundRequest.status": "succeeded",
      "payment.refundRequest.stripeRefundId": "re_1",
      "payment.status": "refunded",
      "payment.refundedAmount": 120,
    });
    expect(h.voided).toEqual([APPT]);
  });

  it("records a refund after a cancellation fee as partial, and keeps the receipt", async () => {
    h.create.mockResolvedValue(refund({ amount: 10200 }));
    expect(await run(10200)).toMatchObject({ outcome: "refunded", amountCents: 10200, full: false });
    expect(h.updates[1][1].$set).toMatchObject({ "payment.status": "partially_refunded", "payment.refundedAmount": 102 });
    expect(h.voided).toEqual([]);
  });

  it("asks nothing of Stripe for a payment that is not paid by card, already refunded, or an amount that is not positive", async () => {
    for (const appointment of [paid({ status: "pending" }), paid({ stripePaymentIntentId: undefined }), paid({ refundRequest: { status: "succeeded", attempt: 1 } }), null]) {
      h.appointment = appointment;
      expect(await run()).toEqual({ outcome: "not_refundable" });
    }
    h.appointment = paid();
    expect(await run(0)).toEqual({ outcome: "not_refundable" });
    expect(await refundAppointmentPayment({ appointmentId: "../x", amountCents: 100, by: "admin", reason: "", now })).toEqual({ outcome: "not_refundable" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("lets only one of two racing requests reach Stripe", async () => {
    h.modified = [0];
    expect(await run()).toEqual({ outcome: "in_progress" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("records a definitive refusal as failed, and a later attempt uses a new key", async () => {
    h.create.mockRejectedValueOnce(refuse());
    expect(await run()).toEqual({ outcome: "refused", message: "Charge already refunded" });
    expect(h.updates[1]).toEqual([
      { _id: APPT, "payment.refundRequest.attempt": 1, "payment.refundRequest.status": "requested" },
      { $set: { "payment.refundRequest.status": "failed", "payment.refundRequest.failureReason": "Charge already refunded" } },
    ]);

    h.updates = [];
    h.appointment = paid({ refundRequest: { status: "failed", attempt: 1, requestedAt: now, amountCents: 12000 } });
    expect(await run()).toMatchObject({ outcome: "refunded" });
    expect(h.updates[0][0]).toMatchObject({ "payment.refundRequest.attempt": 1, "payment.refundRequest.status": "failed" });
    expect(h.updates[0][1].$set["payment.refundRequest"]).toMatchObject({ attempt: 2 });
    expect(h.create.mock.calls.at(-1)?.[1]).toEqual({ idempotencyKey: `apptref_${APPT}_2` });
  });

  it("treats a refund Stripe created as failed as a refusal", async () => {
    h.create.mockResolvedValue(refund({ status: "failed", failure_reason: "expired_or_canceled_card" } as Partial<Stripe.Refund>));
    expect(await run()).toEqual({ outcome: "refused", message: "expired_or_canceled_card" });
    expect(h.updates[1][1].$set).toMatchObject({ "payment.refundRequest.status": "failed" });
    expect(h.voided).toEqual([]);
  });

  it("keeps the claim on an unknown outcome, and never sends again blind", async () => {
    h.create.mockRejectedValueOnce(unknown());
    expect(await run()).toEqual({ outcome: "unconfirmed" });
    expect(h.updates).toHaveLength(1);

    const requested = { status: "requested", attempt: 1, requestedAt: new Date(now.getTime() - 60_000), amountCents: 12000 };
    h.appointment = paid({ refundRequest: requested });
    h.updates = [];
    h.create.mockClear();
    expect(await run()).toEqual({ outcome: "in_progress" });
    expect(h.list).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("later, adopts the refund Stripe did make for that attempt instead of refunding again", async () => {
    h.appointment = paid({ refundRequest: { status: "requested", attempt: 1, requestedAt: new Date(now.getTime() - APPOINTMENT_REFUND_CHECK_AFTER_MS - 1), amountCents: 12000 } });
    h.list.mockResolvedValue({ data: [refund({ id: "re_made", metadata: { appointmentId: APPT, attempt: "1" } })] });
    expect(await run()).toMatchObject({ outcome: "refunded", stripeRefundId: "re_made" });
    expect(h.list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 20 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("later, when Stripe never got that attempt, marks it failed and sends a new one", async () => {
    h.appointment = paid({ refundRequest: { status: "requested", attempt: 1, requestedAt: new Date(now.getTime() - APPOINTMENT_REFUND_CHECK_AFTER_MS - 1), amountCents: 12000 } });
    h.list.mockResolvedValue({ data: [refund({ id: "re_other", metadata: { appointmentId: "someone-else", attempt: "1" } })] });
    expect(await run()).toMatchObject({ outcome: "refunded" });
    expect(h.updates[0][1].$set).toMatchObject({ "payment.refundRequest.status": "failed", "payment.refundRequest.failureReason": "not found at Stripe" });
    expect(h.create.mock.calls[0][1]).toEqual({ idempotencyKey: `apptref_${APPT}_2` });
  });

  it("answers « unconfirmed » when Stripe cannot be asked about that attempt", async () => {
    h.appointment = paid({ refundRequest: { status: "requested", attempt: 1, requestedAt: new Date(0), amountCents: 12000 } });
    h.list.mockRejectedValue(unknown());
    expect(await run()).toEqual({ outcome: "unconfirmed" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });
});

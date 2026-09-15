import "server-only";
import mongoose from "mongoose";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { voidReceiptForRefund } from "@/lib/payment-settlement";
import { isDefinitiveStripeError } from "@/lib/stripe-errors";

/**
 * Refunding a session's Stripe payment, for the admin's refund and for a cancellation — the
 * organization-invoice pattern (lib/organization-invoice-refund.ts):
 *
 *  1. the refund is claimed on the appointment (`payment.refundRequest`, one conditional write), so
 *     two clicks or two cancellations racing send Stripe one request;
 *  2. Stripe is asked with an idempotency key made of the appointment and the attempt;
 *  3. the answer is recorded: « refunded » or « partially refunded » with the real amount (the
 *     receipt is voided only on a full refund).
 *
 * A definitive refusal marks the attempt failed (a later attempt uses a new key). An unknown outcome
 * (network, Stripe 5xx) keeps the claim: nothing is sent again blind; after CHECK_AFTER_MS the next
 * call asks Stripe what became of that attempt before deciding. The caller tells the team about a
 * refusal or an unknown outcome — never only a log line.
 */

export const APPOINTMENT_REFUND_TYPE = "appointment_refund";
/** An attempt younger than this may still be on its way to Stripe. */
export const APPOINTMENT_REFUND_CHECK_AFTER_MS = 10 * 60 * 1000;

export type AppointmentRefundResult =
  | { outcome: "refunded"; amountCents: number; stripeRefundId: string; full: boolean; pending: boolean }
  /** Not a paid Stripe payment, or already refunded. */
  | { outcome: "not_refundable" }
  /** Another refund for this appointment is being asked right now. */
  | { outcome: "in_progress" }
  | { outcome: "refused"; message: string }
  | { outcome: "unconfirmed" };

export const appointmentRefundKey = (appointmentId: string, attempt: number) => `apptref_${appointmentId}_${attempt}`;

type RefundRequestRow = { status: "requested" | "succeeded" | "failed"; attempt: number; requestedAt: Date; amountCents: number };
type PaymentRow = {
  payment?: { status?: string; price?: number; stripePaymentIntentId?: string; refundRequest?: RefundRequestRow };
};

async function markFailed(appointmentId: string, attempt: number, reason: string): Promise<void> {
  await Appointment.updateOne(
    { _id: appointmentId, "payment.refundRequest.attempt": attempt, "payment.refundRequest.status": "requested" },
    { $set: { "payment.refundRequest.status": "failed", "payment.refundRequest.failureReason": reason.slice(0, 500) } },
  );
}

/** Stripe answered for this attempt: record it. A failed refund is a refusal, not a refund. */
async function adopt(
  appointmentId: string,
  attempt: number,
  refund: Stripe.Refund,
  priceCad: number,
  now: Date,
): Promise<AppointmentRefundResult> {
  if (refund.status === "failed" || refund.status === "canceled") {
    const message = refund.failure_reason ?? refund.status;
    await markFailed(appointmentId, attempt, message);
    return { outcome: "refused", message };
  }
  const full = refund.amount >= Math.round(priceCad * 100);
  await Appointment.updateOne(
    { _id: appointmentId, "payment.refundRequest.attempt": attempt, "payment.refundRequest.status": "requested" },
    {
      $set: {
        "payment.refundRequest.status": "succeeded",
        "payment.refundRequest.stripeRefundId": refund.id,
        "payment.status": full ? "refunded" : "partially_refunded",
        "payment.refundedAt": now,
        "payment.refundedAmount": refund.amount / 100,
      },
    },
  );
  if (full) await voidReceiptForRefund(appointmentId);
  return { outcome: "refunded", amountCents: refund.amount, stripeRefundId: refund.id, full, pending: refund.status === "pending" };
}

export async function refundAppointmentPayment(input: {
  appointmentId: string;
  amountCents: number;
  by: "admin" | "cancellation";
  byUserId?: string;
  reason: string;
  /** More context for Stripe's dashboard (who cancelled, the fee kept…). */
  metadata?: Record<string, string>;
  now?: Date;
}): Promise<AppointmentRefundResult> {
  if (!mongoose.Types.ObjectId.isValid(input.appointmentId)) return { outcome: "not_refundable" };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { outcome: "not_refundable" };
  const now = input.now ?? new Date();
  const id = input.appointmentId;
  await connectToDatabase();

  const current = await Appointment.findById(id).select("payment").lean<PaymentRow | null>();
  const payment = current?.payment;
  const paymentIntentId = payment?.stripePaymentIntentId;
  if (!paymentIntentId || payment.status !== "paid") return { outcome: "not_refundable" };
  const priceCad = payment.price ?? 0;
  let previous = payment.refundRequest;
  if (previous?.status === "succeeded") return { outcome: "not_refundable" };

  if (previous?.status === "requested") {
    if (now.getTime() - new Date(previous.requestedAt).getTime() < APPOINTMENT_REFUND_CHECK_AFTER_MS) {
      return { outcome: "in_progress" };
    }
    // What became of that attempt: Stripe has it (adopt it), or it never left (a new attempt may go).
    let found: Stripe.Refund | undefined;
    try {
      const list = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 20 });
      found = list.data.find(
        (refund) => refund.metadata?.appointmentId === id && refund.metadata?.attempt === String(previous!.attempt),
      );
    } catch (e) {
      console.error("[appointment-refund] could not check an earlier attempt:", id, e);
      return { outcome: "unconfirmed" };
    }
    if (found && found.status !== "failed" && found.status !== "canceled") {
      return adopt(id, previous.attempt, found, priceCad, now);
    }
    await markFailed(id, previous.attempt, found ? (found.failure_reason ?? found.status ?? "failed") : "not found at Stripe");
    previous = { ...previous, status: "failed" };
  }

  const attempt = (previous?.attempt ?? 0) + 1;
  const claimFilter: Record<string, unknown> = {
    _id: id,
    "payment.status": "paid",
    "payment.stripePaymentIntentId": paymentIntentId,
    ...(previous
      ? { "payment.refundRequest.attempt": previous.attempt, "payment.refundRequest.status": "failed" }
      : { "payment.refundRequest": { $exists: false } }),
  };
  const claimed = await Appointment.updateOne(claimFilter, {
    $set: {
      "payment.refundRequest": {
        status: "requested",
        attempt,
        amountCents: input.amountCents,
        by: input.by,
        ...(input.byUserId && mongoose.Types.ObjectId.isValid(input.byUserId)
          ? { byUserId: new mongoose.Types.ObjectId(input.byUserId) }
          : {}),
        requestedAt: now,
      },
    },
  });
  if (claimed.modifiedCount !== 1) return { outcome: "in_progress" };

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: input.amountCents,
        reason: "requested_by_customer",
        metadata: {
          ...input.metadata,
          type: APPOINTMENT_REFUND_TYPE,
          appointmentId: id,
          attempt: String(attempt),
          by: input.by,
          refundReason: input.reason.slice(0, 450),
        },
      },
      { idempotencyKey: appointmentRefundKey(id, attempt) },
    );
  } catch (e) {
    if (isDefinitiveStripeError(e)) {
      const message = e instanceof Error ? e.message : "Stripe refused the refund.";
      await markFailed(id, attempt, message);
      return { outcome: "refused", message };
    }
    console.error("[appointment-refund] Stripe outcome unknown:", id, e);
    return { outcome: "unconfirmed" };
  }
  return adopt(id, attempt, refund, priceCad, now);
}

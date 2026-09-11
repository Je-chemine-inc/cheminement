/**
 * Refunding an organization from the invoice screen (organization billing).
 *
 * For each refund the admin says whether the money is still owed (« toujours
 * dû »: the balance comes back, reminders resume) or no longer owed (« plus
 * dû »: a credit is recorded). Refunding an overpayment needs no choice and
 * only brings the balance back to 0.
 *
 *  - A Stripe payment (card) is refunded THROUGH Stripe, in three steps: a
 *    `requested` row is written first; Stripe is asked with an idempotency key
 *    derived from that row; the result is recorded through the same path as
 *    the webhook. An unknown outcome (network, Stripe 5xx) leaves the row
 *    `requested` and the admin checks it later (`checkOrganizationRefund`) —
 *    it is never re-sent automatically.
 *  - Interac, cheque, EFT… were paid outside the platform and are refunded
 *    outside it: the admin records what was done. Stripe is never called.
 *
 * Every refund is an admin action with a reason and the admin's id; the
 * organization is told by email unless the admin unticks it.
 */
import Stripe from "stripe";
import mongoose from "mongoose";
import { stripe } from "@/lib/stripe";
import connectToDatabase from "@/lib/mongodb";
import Organization from "@/models/Organization";
import OrganizationInvoice, { type IOrganizationInvoice } from "@/models/OrganizationInvoice";
import type { InvoiceResult } from "@/lib/organization-invoice";
import {
  needsOwedChoice,
  refundCreditCents,
  refundabilityOf,
} from "@/lib/organization-invoice-money";
import {
  ORGANIZATION_REFUND_TYPE,
  dropOrganizationStripeRefundRequest,
  markOrganizationRefundStatus,
  openOrganizationStripeRefund,
  recordOrganizationOutsideRefund,
  recordOrganizationStripeRefund,
  refreshInvoiceMoney,
} from "@/lib/organization-invoice-settlement";
import { cancelOpenOrganizationPaymentIntent } from "@/lib/organization-invoice-card";
import { ensurePayToken, organizationPayUrl } from "@/lib/organization-invoice-pay-link";
import { sendOrganizationRefundEmail } from "@/lib/notifications";

type Status = 400 | 404 | 409 | 502;
const refuse = (status: Status, code: string, error: string, details?: unknown): InvoiceResult => ({
  ok: false,
  status,
  code,
  error,
  ...(details === undefined ? {} : { details }),
});

const unconfirmed = () =>
  refuse(
    502,
    "REFUND_UNCONFIRMED",
    "Stripe did not confirm the refund. Check it in a minute from the invoice before trying again.",
  );

const OUTSIDE_METHODS = ["interac", "cheque", "eft", "other"] as const;
export type OutsideRefundMethod = (typeof OUTSIDE_METHODS)[number];

/** A requested row younger than this may still be on its way to Stripe. */
const CHECK_AFTER_MS = 60_000;

async function current(invoiceId: unknown) {
  return OrganizationInvoice.findById(invoiceId);
}

/** Stripe's refund status, as our row's. */
function rowStatusOf(refund: Stripe.Refund): "pending" | "succeeded" | "failed" {
  if (refund.status === "succeeded") return "succeeded";
  if (refund.status === "failed" || refund.status === "canceled") return "failed";
  return "pending";
}

/** A refusal Stripe will give again, as opposed to an outcome we do not know. */
function isDefinitive(e: unknown): boolean {
  if (!(e instanceof Stripe.errors.StripeError)) return false;
  if (e.type === "StripeIdempotencyError") return false;
  const code = e.statusCode ?? 0;
  return code >= 400 && code < 500 && code !== 409 && code !== 429;
}

/** After Stripe answered: record it through the webhook's own path, then settle the money. */
async function adoptStripeRefund(invoiceId: unknown, refundId: unknown, refund: Stripe.Refund, now: Date) {
  const status = rowStatusOf(refund);
  await markOrganizationRefundStatus({
    invoiceId,
    refundId,
    status,
    stripeRefundId: refund.id,
    ...(status === "failed" ? { failureReason: refund.failure_reason ?? refund.status ?? "failed" } : {}),
    now,
  });
  const piId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  const charge =
    refund.charge && typeof refund.charge === "object"
      ? refund.charge
      : refund.charge
        ? await stripe.charges.retrieve(refund.charge)
        : null;
  if (piId && charge) {
    await recordOrganizationStripeRefund({ paymentIntentId: piId, refundedCents: charge.amount_refunded, now });
  }
  // Whatever the order of the webhook and this call, the money ends up right.
  await refreshInvoiceMoney(invoiceId, now);
  // The balance moved: a card payment started for the old amount goes.
  await cancelOpenOrganizationPaymentIntent(invoiceId);
}

/** Tell the organization. Never throws: the refund is done either way. */
async function noticeOrganization(
  inv: IOrganizationInvoice,
  args: { amountCents: number; via: "card" | "bank" | "outside"; pending: boolean },
  now: Date,
) {
  try {
    const org = await Organization.findById(inv.organizationId).select("name language billingEmails").lean();
    const lang = org?.language === "en" ? "en" : "fr";
    const emails = inv.billTo?.emails?.length ? inv.billTo.emails : (org?.billingEmails ?? []);
    const balance = Math.max(0, inv.balanceCents);
    const token = balance > 0 ? (inv.payToken ?? (await ensurePayToken(inv._id))) : null;
    const reached: string[] = [];
    for (const to of emails) {
      const ok = await sendOrganizationRefundEmail({
        to,
        organizationName: org?.name ?? inv.billTo?.name ?? "",
        number: inv.number ?? "",
        amountCents: args.amountCents,
        via: args.via,
        pending: args.pending,
        balanceCents: balance,
        payUrl: token ? organizationPayUrl(token, lang) : null,
        locale: lang,
      }).catch(() => false);
      if (ok) reached.push(to);
    }
    if (reached.length > 0) {
      await OrganizationInvoice.updateOne(
        { _id: inv._id },
        { $push: { sendLog: { at: now, to: reached, kind: "refund_notice" } } },
      );
    }
  } catch (e) {
    console.error("[organization-refund] notice failed:", e);
  }
}

export async function refundOrganizationPayment(args: {
  invoiceId: string;
  paymentId: string;
  amountCents: number;
  owed: "still" | "no_longer" | null;
  reason: string;
  /** From the admin's dialog: the same click twice refunds once. */
  requestKey: string;
  notify: boolean;
  byUserId: string;
  /** Required for a payment made outside Stripe: how the money went back. */
  outside?: { method: string; reference?: string; refundedAt?: Date } | null;
  now?: Date;
}): Promise<InvoiceResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    return refuse(400, "INVALID_AMOUNT", "The amount must be positive.");
  }
  const reason = args.reason.trim();
  if (!reason) return refuse(400, "REASON_REQUIRED", "Say why this is refunded.");
  if (!mongoose.Types.ObjectId.isValid(args.invoiceId)) return refuse(404, "NOT_FOUND", "Invoice not found");

  const inv = await OrganizationInvoice.findById(args.invoiceId).lean();
  if (!inv) return refuse(404, "NOT_FOUND", "Invoice not found");
  // The same request again (a double click, a retry): answer with where it
  // stands — never a second refund, and never "done" while Stripe has not said so.
  const again = (inv.refunds ?? []).find((r) => r.requestKey === args.requestKey);
  if (again?.status === "requested") return unconfirmed();
  if (again) return { ok: true, invoice: (await current(inv._id))! };
  const payment = inv.payments.find((p) => p.paymentId && String(p.paymentId) === args.paymentId);
  if (!payment) return refuse(404, "PAYMENT_NOT_FOUND", "This payment is not on the invoice.");

  const { refundableCents, via, blocked } = refundabilityOf(inv, payment);
  if (blocked === "DISPUTED") {
    return refuse(409, "DISPUTED", "The organization disputed a payment with its bank: nothing can be refunded meanwhile.");
  }
  if (blocked === "IN_PROGRESS") {
    return refuse(409, "REFUND_IN_PROGRESS", "Another refund on this invoice is not confirmed yet. Check it first.");
  }
  if (blocked) return refuse(409, "NOT_REFUNDABLE", "Nothing can be refunded on this payment.");
  if (args.amountCents > refundableCents) {
    return refuse(409, "REFUND_TOO_LARGE", "More than what is left of this payment.", { refundableCents });
  }

  const choice = needsOwedChoice({
    amountCents: args.amountCents,
    balanceBeforeCents: inv.balanceCents,
    invoiceStatus: inv.status,
  });
  if (choice && args.owed !== "still" && args.owed !== "no_longer") {
    return refuse(400, "OWED_REQUIRED", "Say whether the organization still owes this amount.");
  }
  const creditCents = refundCreditCents({
    amountCents: args.amountCents,
    balanceBeforeCents: inv.balanceCents,
    owed: choice ? args.owed : null,
    invoiceStatus: inv.status,
  });
  const refundId = new mongoose.Types.ObjectId();
  const byUserId = new mongoose.Types.ObjectId(args.byUserId);
  const base = {
    refundId,
    paymentId: payment.paymentId!,
    amountCents: args.amountCents,
    creditCents,
    ...(choice ? { owed: args.owed! } : {}),
    reason: reason.slice(0, 500),
    requestKey: args.requestKey,
    at: now,
    byUserId,
  };

  if (via === "outside") {
    const method = args.outside?.method;
    if (!method || !(OUTSIDE_METHODS as readonly string[]).includes(method)) {
      return refuse(400, "METHOD_REQUIRED", "Say how the money went back: interac, cheque, eft or other.");
    }
    const outcome = await recordOrganizationOutsideRefund({
      invoiceId: inv._id,
      paymentId: payment.paymentId!,
      expected: { status: inv.status, balanceCents: inv.balanceCents, refundedCents: payment.refundedCents ?? 0 },
      row: {
        ...base,
        via: "outside",
        method: method as OutsideRefundMethod,
        ...(args.outside?.reference?.trim() ? { reference: args.outside.reference.trim().slice(0, 120) } : {}),
        status: "succeeded",
        refundedAt: args.outside?.refundedAt ?? now,
      },
      now,
    });
    if (outcome === "changed") return refuse(409, "CHANGED_MEANWHILE", "This invoice changed meanwhile.");
    const fresh = (await current(inv._id))!;
    if (outcome === "recorded" && args.notify) {
      await noticeOrganization(fresh, { amountCents: args.amountCents, via: "outside", pending: false }, now);
    }
    return { ok: true, invoice: fresh };
  }

  // Stripe: the row first, then Stripe, then the result.
  const opened = await openOrganizationStripeRefund({
    invoiceId: inv._id,
    paymentId: payment.paymentId!,
    expected: { status: inv.status, balanceCents: inv.balanceCents },
    row: { ...base, via: "stripe", status: "requested", refundedAt: now },
  });
  if (opened === "replay") return { ok: true, invoice: (await current(inv._id))! };
  if (opened === "changed") return refuse(409, "CHANGED_MEANWHILE", "This invoice changed meanwhile.");

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: payment.externalRef!,
        amount: args.amountCents,
        metadata: {
          type: ORGANIZATION_REFUND_TYPE,
          organizationInvoiceId: String(inv._id),
          organizationRefundId: String(refundId),
          paymentId: String(payment.paymentId),
          invoiceNumber: inv.number ?? "",
        },
        expand: ["charge"],
      },
      { idempotencyKey: `orgref_${String(refundId)}` },
    );
  } catch (e) {
    if (isDefinitive(e)) {
      await dropOrganizationStripeRefundRequest({ invoiceId: inv._id, refundId, now });
      return refuse(409, "STRIPE_REFUSED", e instanceof Error ? e.message : "Stripe refused the refund.");
    }
    console.error("[organization-refund] Stripe outcome unknown:", e);
    return unconfirmed();
  }

  await adoptStripeRefund(inv._id, refundId, refund, now);
  const fresh = (await current(inv._id))!;
  if (args.notify && rowStatusOf(refund) !== "failed") {
    await noticeOrganization(
      fresh,
      {
        amountCents: args.amountCents,
        // A bank debit goes back to the account it came from.
        via: payment.method === "pad" ? "bank" : "card",
        pending: rowStatusOf(refund) === "pending",
      },
      now,
    );
  }
  return { ok: true, invoice: fresh };
}

/**
 * « Vérifier »: where a Stripe refund made from the screen stands. A row still
 * `requested` is looked up in Stripe by its own id — adopted if Stripe has it,
 * failed if not (it never left). A `pending` one is asked again.
 */
export async function checkOrganizationRefund(args: {
  invoiceId: string;
  refundId: string;
  now?: Date;
}): Promise<InvoiceResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  if (!mongoose.Types.ObjectId.isValid(args.invoiceId) || !mongoose.Types.ObjectId.isValid(args.refundId)) {
    return refuse(404, "NOT_FOUND", "Refund not found");
  }
  const inv = await OrganizationInvoice.findById(args.invoiceId).lean();
  const row = inv?.refunds?.find((r) => String(r.refundId) === args.refundId);
  if (!inv || !row || row.via !== "stripe") return refuse(404, "NOT_FOUND", "Refund not found");
  const payment = inv.payments.find((p) => String(p.paymentId) === String(row.paymentId));

  if (row.status === "requested") {
    if (now.getTime() - new Date(row.at).getTime() < CHECK_AFTER_MS) {
      return refuse(409, "CHECK_TOO_SOON", "Stripe may still be answering. Check again in a minute.");
    }
    const listed = payment?.externalRef
      ? await stripe.refunds.list({ payment_intent: payment.externalRef, limit: 100, expand: ["data.charge"] })
      : null;
    const found = listed?.data.find((r) => r.metadata?.organizationRefundId === args.refundId);
    if (found) await adoptStripeRefund(inv._id, row.refundId, found, now);
    else {
      await markOrganizationRefundStatus({
        invoiceId: inv._id,
        refundId: row.refundId,
        status: "failed",
        failureReason: "not_sent",
        now,
      });
    }
  } else if (row.status === "pending" && row.stripeRefundId) {
    const refund = await stripe.refunds.retrieve(row.stripeRefundId, { expand: ["charge"] });
    await adoptStripeRefund(inv._id, row.refundId, refund, now);
  }
  return { ok: true, invoice: (await current(inv._id))! };
}

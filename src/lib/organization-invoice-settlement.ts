/**
 * Money received from an organization (spec 002, phase 5): by card from the
 * pay link, by Interac transfer, or recorded by an admin (cheque, EFT…).
 *
 * The rules this module holds:
 *
 *  1. Money that arrived is recorded exactly once per external reference (a
 *     Stripe intent, an Interac transfer). A replay is a no-op.
 *  2. An admin cannot record more than the balance, or pay an invoice that is
 *     not awaiting payment — a typo would be a lie in the books. Automatic
 *     sources can: that money is already in the account, so it is recorded as
 *     it is and a person is asked to look (overpaid; received on a void or
 *     already-paid invoice). Nothing is ever refunded automatically.
 *  3. The status follows the balance through conditional writes, so two
 *     payments landing together cannot leave a stale status behind.
 *  4. Nothing throws on a terminal condition ("no such invoice"): the Stripe
 *     webhook would release its claim and retry a hopeless event forever.
 *     Database errors still throw, and a retry is safe by rule 1.
 *  5. What is owed: balance = total − credited − paid, where paid is every
 *     payment less what went back and credited is the part of refunds marked
 *     « plus dû ». Recomputed in one write (`recomputeInvoiceMoney`) whenever a
 *     refund changes; the rules are in organization-invoice-money.ts.
 *  6. The team is emailed only about refunds it did not make from the invoice
 *     screen (a refund made in the Stripe dashboard, a refund that failed).
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Organization from "@/models/Organization";
import OrganizationInvoice, {
  type IOrganizationInvoice,
  type IOrganizationInvoicePaymentEvent,
  type IOrganizationInvoiceRefund,
} from "@/models/OrganizationInvoice";
import type { InvoiceResult } from "@/lib/organization-invoice";
import { explainedAdminRefundCents } from "@/lib/organization-invoice-money";
import {
  AWAITING_PAYMENT_STATUSES,
  ensurePayToken,
  isAwaitingPayment,
  organizationPayUrl,
} from "@/lib/organization-invoice-pay-link";
import {
  sendAdminOrganizationPaymentReview,
  sendOrganizationPaymentReceivedEmail,
} from "@/lib/notifications";

/** The discriminator the shared Stripe webhook branches on. */
export const ORGANIZATION_INVOICE_PAYMENT_TYPE = "organization_invoice";

export function isOrganizationInvoiceIntent(pi: {
  metadata?: Record<string, string> | null;
}): boolean {
  return pi.metadata?.type === ORGANIZATION_INVOICE_PAYMENT_TYPE;
}

/** On a Stripe refund made from the invoice screen (charge.refund.updated). */
export const ORGANIZATION_REFUND_TYPE = "organization_invoice_refund";

export function isOrganizationInvoiceRefund(refund: {
  metadata?: Record<string, string> | null;
}): boolean {
  return refund.metadata?.type === ORGANIZATION_REFUND_TYPE;
}

type PaymentMethod = IOrganizationInvoice["payments"][number]["method"];
type PaymentSource = IOrganizationInvoice["payments"][number]["source"];
type Lean = Omit<IOrganizationInvoice, keyof mongoose.Document> & { _id: mongoose.Types.ObjectId };

/** Statuses that carry money: the status of these follows the balance. */
const MONEY_STATUSES = [...AWAITING_PAYMENT_STATUSES, "paid", "refunded"];

const oid = (id: unknown) => new mongoose.Types.ObjectId(String(id));

/** Invoices that went back to awaiting payment after their money went back. */
const WAS_PAID = ["partially_paid", "paid", "refunded"];

/**
 * Put the status in line with the money, then the sessions in line with the
 * status. Each write re-checks what it relies on:
 *   paid > 0, nothing owed           → paid
 *   paid > 0, something owed         → partially_paid
 *   nothing kept, nothing owed       → refunded (closed: all went back, all credited)
 *   nothing kept, owed again         → overdue past the due date, sent before it
 * The last one is « toujours dû »: a full refund puts the invoice back to
 * awaiting payment, and reminders resume.
 */
export async function syncInvoiceStatus(invoiceId: unknown, now: Date = new Date()) {
  const _id = oid(invoiceId);
  await OrganizationInvoice.updateOne(
    { _id, status: { $in: MONEY_STATUSES }, paidCents: { $gt: 0 }, balanceCents: { $lte: 0 } },
    { $set: { status: "paid" } },
  );
  await OrganizationInvoice.updateOne(
    { _id, status: { $in: MONEY_STATUSES }, paidCents: { $gt: 0 }, balanceCents: { $gt: 0 } },
    { $set: { status: "partially_paid" } },
  );
  await OrganizationInvoice.updateOne(
    { _id, status: { $in: ["partially_paid", "paid"] }, paidCents: { $lte: 0 }, balanceCents: { $lte: 0 } },
    { $set: { status: "refunded" } },
  );
  await OrganizationInvoice.updateOne(
    { _id, status: { $in: WAS_PAID }, paidCents: { $lte: 0 }, balanceCents: { $gt: 0 }, dueAt: { $lt: now } },
    { $set: { status: "overdue" } },
  );
  await OrganizationInvoice.updateOne(
    { _id, status: { $in: WAS_PAID }, paidCents: { $lte: 0 }, balanceCents: { $gt: 0 } },
    { $set: { status: "sent" } },
  );
  const fresh = await OrganizationInvoice.findById(_id).select("status").lean();
  if (fresh?.status === "paid") {
    await Appointment.updateMany(
      { "thirdPartyBilling.orgInvoiceId": _id, "thirdPartyBilling.orgStatus": { $ne: "paid" } },
      { $set: { "thirdPartyBilling.orgStatus": "paid", "thirdPartyBilling.orgPaidAt": now } },
    );
  } else if (fresh?.status === "refunded") {
    await Appointment.updateMany(
      { "thirdPartyBilling.orgInvoiceId": _id, "thirdPartyBilling.orgStatus": { $in: ["paid", "invoiced"] } },
      { $set: { "thirdPartyBilling.orgStatus": "refunded" }, $unset: { "thirdPartyBilling.orgPaidAt": 1 } },
    );
  } else if (fresh && MONEY_STATUSES.includes(fresh.status)) {
    await Appointment.updateMany(
      { "thirdPartyBilling.orgInvoiceId": _id, "thirdPartyBilling.orgStatus": { $in: ["paid", "refunded"] } },
      { $set: { "thirdPartyBilling.orgStatus": "invoiced" }, $unset: { "thirdPartyBilling.orgPaidAt": 1 } },
    );
  }
  return fresh?.status ?? null;
}

/**
 * Paid, credited and balance recomputed from the payments and refunds as they
 * are now — one atomic write, so two changes landing together agree.
 */
export async function recomputeInvoiceMoney(invoiceId: unknown) {
  await OrganizationInvoice.updateOne({ _id: oid(invoiceId) }, [
    {
      $set: {
        paidCents: {
          $sum: {
            $map: {
              input: "$payments",
              as: "p",
              in: { $subtract: ["$$p.amountCents", { $ifNull: ["$$p.refundedCents", 0] }] },
            },
          },
        },
        creditedCents: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: { $ifNull: ["$refunds", []] },
                  as: "r",
                  cond: { $ne: ["$$r.status", "failed"] },
                },
              },
              as: "r",
              in: { $ifNull: ["$$r.creditCents", 0] },
            },
          },
        },
      },
    },
    { $set: { balanceCents: { $subtract: ["$totalCents", { $add: ["$creditedCents", "$paidCents"] }] } } },
  ]);
}

/** Recompute the money, then the status that follows from it. Idempotent. */
export async function refreshInvoiceMoney(invoiceId: unknown, now: Date = new Date()) {
  await recomputeInvoiceMoney(invoiceId);
  return syncInvoiceStatus(invoiceId, now);
}

function paymentRow(args: {
  amountCents: number;
  method: PaymentMethod;
  source: PaymentSource;
  reference?: string;
  receivedAt: Date;
  externalRef?: string;
  byUserId?: string | null;
}) {
  return {
    // Its own id, so a refund can name it (never a schema default).
    paymentId: new mongoose.Types.ObjectId(),
    amountCents: args.amountCents,
    method: args.method,
    ...(args.reference ? { reference: args.reference.slice(0, 120) } : {}),
    receivedAt: args.receivedAt,
    source: args.source,
    ...(args.externalRef ? { externalRef: args.externalRef } : {}),
    ...(args.byUserId ? { recordedBy: oid(args.byUserId) } : {}),
  };
}

/** Tell the organization its payment arrived. Never throws. */
async function notifyPaymentReceived(inv: Lean, amountCents: number, now: Date) {
  try {
    const org = await Organization.findById(inv.organizationId)
      .select("name language billingEmails")
      .lean();
    const lang = org?.language === "en" ? "en" : "fr";
    const emails = inv.billTo?.emails?.length ? inv.billTo.emails : (org?.billingEmails ?? []);
    const balance = Math.max(0, inv.balanceCents);
    const token = balance > 0 ? await ensurePayToken(inv._id) : null;
    const reached: string[] = [];
    for (const to of emails) {
      const ok = await sendOrganizationPaymentReceivedEmail({
        to,
        organizationName: org?.name ?? inv.billTo?.name ?? "",
        number: inv.number ?? "",
        amountCents,
        balanceCents: balance,
        payUrl: token ? organizationPayUrl(token, lang) : null,
        locale: lang,
      }).catch(() => false);
      if (ok) reached.push(to);
    }
    if (reached.length > 0) {
      await OrganizationInvoice.updateOne(
        { _id: inv._id },
        { $push: { sendLog: { at: now, to: reached, kind: "payment_received" } } },
      );
    }
  } catch (e) {
    console.error("[organization-payment] receipt email failed:", e);
  }
}

/** Note it on the invoice and email the team. Never throws. */
async function flagForReview(
  inv: Pick<Lean, "_id" | "organizationId" | "number">,
  kind: IOrganizationInvoicePaymentEvent["kind"],
  detail: string,
  now: Date,
) {
  try {
    await OrganizationInvoice.updateOne(
      { _id: inv._id },
      { $push: { paymentEvents: { at: now, kind, detail: detail.slice(0, 500) } } },
    );
    const org = await Organization.findById(inv.organizationId).select("name").lean();
    await sendAdminOrganizationPaymentReview({
      invoiceNumber: inv.number ?? "—",
      organizationName: org?.name ?? "",
      kind,
      detail,
    });
  } catch (e) {
    console.error("[organization-payment] review alert failed:", e);
  }
}

const money = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} $`;

/**
 * An admin records money received (cheque, EFT, portal, Interac by hand).
 * Strict: never more than the balance, only on an invoice awaiting payment.
 */
export async function recordOrganizationPayment(args: {
  invoiceId: string;
  amountCents: number;
  method: PaymentMethod;
  reference?: string;
  receivedAt?: Date;
  externalRef?: string;
  source: PaymentSource;
  byUserId?: string | null;
  now?: Date;
}): Promise<InvoiceResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    return { ok: false, status: 400, code: "INVALID_AMOUNT", error: "The amount must be positive." };
  }
  const inv = await OrganizationInvoice.findById(args.invoiceId).lean();
  if (!inv) return { ok: false, status: 404, code: "NOT_FOUND", error: "Invoice not found" };
  if (args.externalRef && inv.payments.some((p) => p.externalRef === args.externalRef)) {
    return { ok: true, invoice: inv as unknown as IOrganizationInvoice };
  }
  if (!isAwaitingPayment(inv.status)) {
    return { ok: false, status: 409, code: "NOT_PAYABLE", error: "This invoice is not awaiting payment." };
  }
  if (args.amountCents > inv.balanceCents) {
    return {
      ok: false,
      status: 409,
      code: "OVERPAYMENT",
      error: "The amount is more than the balance due.",
      details: { balanceCents: inv.balanceCents },
    };
  }

  const updated = await OrganizationInvoice.findOneAndUpdate(
    {
      _id: inv._id,
      status: { $in: AWAITING_PAYMENT_STATUSES },
      balanceCents: { $gte: args.amountCents },
      ...(args.externalRef ? { "payments.externalRef": { $ne: args.externalRef } } : {}),
    },
    {
      $push: {
        payments: paymentRow({ ...args, receivedAt: args.receivedAt ?? now }),
      },
      $inc: { paidCents: args.amountCents, balanceCents: -args.amountCents },
    },
    { new: true },
  );
  if (!updated) {
    return { ok: false, status: 409, code: "CHANGED_MEANWHILE", error: "This invoice changed meanwhile." };
  }
  const status = await syncInvoiceStatus(updated._id, now);
  if (status) updated.status = status;
  await notifyPaymentReceived(updated.toObject() as Lean, args.amountCents, now);
  return { ok: true, invoice: updated };
}

export type ReceivedMoneyOutcome =
  | { outcome: "applied"; invoice: Lean }
  | { outcome: "needs_review"; invoice: Lean; reason: "overpaid" | "not_payable" }
  | { outcome: "duplicate"; invoice: Lean }
  | { outcome: "not_found" };

/**
 * Money that is already in the account (card, Interac): record it, whatever
 * the invoice's state, exactly once per `externalRef`.
 */
export async function recordReceivedOrganizationMoney(args: {
  invoiceId: string;
  amountCents: number;
  method: PaymentMethod;
  source: Exclude<PaymentSource, "admin">;
  externalRef: string;
  reference?: string;
  receivedAt?: Date;
  now?: Date;
}): Promise<ReceivedMoneyOutcome> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  if (!mongoose.Types.ObjectId.isValid(args.invoiceId)) return { outcome: "not_found" };
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    console.error("[organization-payment] ignored a non-positive amount", args);
    return { outcome: "not_found" };
  }
  const updated = await OrganizationInvoice.findOneAndUpdate(
    { _id: oid(args.invoiceId), "payments.externalRef": { $ne: args.externalRef } },
    {
      $push: { payments: paymentRow({ ...args, receivedAt: args.receivedAt ?? now }) },
      $inc: { paidCents: args.amountCents, balanceCents: -args.amountCents },
    },
    { new: true },
  ).lean();
  if (!updated) {
    const existing = await OrganizationInvoice.findById(args.invoiceId).lean();
    return existing ? { outcome: "duplicate", invoice: existing as Lean } : { outcome: "not_found" };
  }
  const inv = updated as Lean;

  // `updated.status` is the status when the money landed (this write does not
  // change it): only an invoice awaiting payment, or one already paid, can
  // take it without a person looking.
  const payable = isAwaitingPayment(inv.status) || inv.status === "paid";
  await syncInvoiceStatus(inv._id, now);

  if (!payable) {
    await flagForReview(
      inv,
      "not_payable",
      `${money(args.amountCents)} reçu (${args.method}, réf. ${args.externalRef}) sur la facture ${inv.number ?? "—"}, qui est « ${inv.status} » — rien n’était dû. À rembourser ou à réaffecter à la main.`,
      now,
    );
    return { outcome: "needs_review", invoice: inv, reason: "not_payable" };
  }
  await notifyPaymentReceived(inv, args.amountCents, now);
  if (inv.balanceCents < 0) {
    await flagForReview(
      inv,
      "overpaid",
      `La facture ${inv.number ?? "—"} a reçu ${money(-inv.balanceCents)} de trop (${args.method}, réf. ${args.externalRef}). Rien n’a été remboursé : à rembourser ou à créditer à la main.`,
      now,
    );
    return { outcome: "needs_review", invoice: inv, reason: "overpaid" };
  }
  return { outcome: "applied", invoice: inv };
}

/** The slice of a Stripe PaymentIntent the settlement reads. */
export interface OrganizationIntentLike {
  id: string;
  amount?: number;
  amount_received?: number;
  currency?: string;
  metadata?: Record<string, string> | null;
}

/** `payment_intent.succeeded` for a pay-link payment. */
export async function settleOrganizationInvoiceIntent(
  pi: OrganizationIntentLike,
): Promise<ReceivedMoneyOutcome> {
  await connectToDatabase();
  let invoiceId = pi.metadata?.organizationInvoiceId ?? "";
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    const byIntent = await OrganizationInvoice.findOne({ stripePaymentIntentId: pi.id })
      .select("_id")
      .lean();
    invoiceId = byIntent ? String(byIntent._id) : "";
  }
  if (!invoiceId) {
    console.error("[organization-payment] no invoice for payment intent", pi.id);
    return { outcome: "not_found" };
  }
  return recordReceivedOrganizationMoney({
    invoiceId,
    amountCents: pi.amount_received ?? pi.amount ?? 0,
    method: "card",
    source: "stripe",
    externalRef: pi.id,
    reference: pi.id,
  });
}

/** The invoice a card payment went to, found by its intent. */
async function invoiceForIntent(paymentIntentId: string) {
  return OrganizationInvoice.findOne({
    $or: [{ "payments.externalRef": paymentIntentId }, { stripePaymentIntentId: paymentIntentId }],
  }).lean();
}

/** Is this Stripe payment an organization's? (refund and dispute events carry no marker) */
export async function isOrganizationInvoicePayment(paymentIntentId: string): Promise<boolean> {
  await connectToDatabase();
  return Boolean(await invoiceForIntent(paymentIntentId));
}

/**
 * A refund on a card payment, as Stripe reports it (`charge.refunded`, or the
 * admin screen right after it asked Stripe). `exact` sets the refunded amount
 * as given (a refund that failed gives money back to the charge); otherwise it
 * only ever grows, so an old event delivered late cannot undo a newer one.
 *
 * The team is told only about the part the invoice screen did not ask for — a
 * refund made in the Stripe dashboard — and about every failure.
 */
export async function recordOrganizationStripeRefund(args: {
  paymentIntentId: string;
  refundedCents: number;
  exact?: boolean;
  now?: Date;
}): Promise<"recorded" | "unchanged" | "not_found"> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  const inv = await invoiceForIntent(args.paymentIntentId);
  const row = inv?.payments.find((p) => p.externalRef === args.paymentIntentId);
  if (!inv || !row) return "not_found";
  const target = Math.max(0, Math.min(Math.round(args.refundedCents), row.amountCents));
  const before = row.refundedCents ?? 0;
  if (target === before || (!args.exact && target < before)) return "unchanged";

  await OrganizationInvoice.updateOne(
    { _id: inv._id, "payments.externalRef": args.paymentIntentId },
    args.exact
      ? { $set: { "payments.$.refundedCents": target } }
      : { $max: { "payments.$.refundedCents": target } },
  );
  await refreshInvoiceMoney(inv._id, now);

  const number = inv.number ?? "—";
  if (target < before) {
    await flagForReview(
      inv as Lean,
      "refund",
      `Un remboursement Stripe a échoué sur la facture ${number} (paiement ${args.paymentIntentId}) : ${money(before - target)} sont revenus. Le solde a été ajusté.`,
      now,
    );
    return "recorded";
  }
  const explained = explainedAdminRefundCents(inv.refunds, row.paymentId);
  const unexplained = Math.max(0, target - Math.max(before, explained));
  if (unexplained > 0) {
    await flagForReview(
      inv as Lean,
      "refund",
      `Remboursement Stripe de ${money(unexplained)} sur la facture ${number} (paiement ${args.paymentIntentId}), fait hors de l’écran des factures : ce montant est de nouveau dû et les rappels reprendront. Pour un remboursement qui n’est plus dû, passez par « Rembourser » dans « Factures aux organismes ».`,
      now,
    );
  }
  return "recorded";
}

type RefundRow = IOrganizationInvoiceRefund;
type Expected = { status: string; balanceCents: number };

/**
 * A refund made outside the platform (Interac sent back, a cheque…): recorded
 * in one conditional write, only while the invoice and that payment are as the
 * admin saw them. Stripe is never called. The same `requestKey` twice records
 * once ("replay").
 */
export async function recordOrganizationOutsideRefund(args: {
  invoiceId: unknown;
  paymentId: mongoose.Types.ObjectId;
  expected: Expected & { refundedCents: number };
  row: RefundRow;
  now?: Date;
}): Promise<"recorded" | "replay" | "changed"> {
  const _id = oid(args.invoiceId);
  const updated = await OrganizationInvoice.findOneAndUpdate(
    {
      _id,
      status: args.expected.status,
      balanceCents: args.expected.balanceCents,
      payments: {
        $elemMatch: {
          paymentId: args.paymentId,
          source: { $ne: "stripe" },
          refundedCents: args.expected.refundedCents === 0 ? { $in: [null, 0] } : args.expected.refundedCents,
        },
      },
      refunds: { $not: { $elemMatch: { status: "requested" } } },
      "refunds.requestKey": { $ne: args.row.requestKey },
    },
    {
      $inc: { "payments.$[p].refundedCents": args.row.amountCents },
      $push: { refunds: args.row },
    },
    { new: true, arrayFilters: [{ "p.paymentId": args.paymentId }] },
  ).lean();
  if (!updated) {
    const again = await OrganizationInvoice.findById(_id).select("refunds").lean();
    return again?.refunds?.some((r) => r.requestKey === args.row.requestKey) ? "replay" : "changed";
  }
  await refreshInvoiceMoney(_id, args.now);
  return "recorded";
}

/**
 * Step one of a Stripe refund: the row exists before Stripe is asked, so a
 * crash in between leaves a trace to check. Its credit is counted from the
 * next recompute on — Stripe may already have made the refund.
 */
export async function openOrganizationStripeRefund(args: {
  invoiceId: unknown;
  paymentId: mongoose.Types.ObjectId;
  expected: Expected;
  row: RefundRow;
}): Promise<"opened" | "replay" | "changed"> {
  const _id = oid(args.invoiceId);
  const r = await OrganizationInvoice.updateOne(
    {
      _id,
      status: args.expected.status,
      balanceCents: args.expected.balanceCents,
      disputed: { $ne: true },
      payments: { $elemMatch: { paymentId: args.paymentId, source: "stripe" } },
      refunds: { $not: { $elemMatch: { status: "requested" } } },
      "refunds.requestKey": { $ne: args.row.requestKey },
    },
    { $push: { refunds: args.row } },
  );
  if (r.modifiedCount === 1) return "opened";
  const again = await OrganizationInvoice.findById(_id).select("refunds").lean();
  return again?.refunds?.some((x) => x.requestKey === args.row.requestKey) ? "replay" : "changed";
}

/** Which way a refund row may move. A card refund can still fail after it succeeded. */
const REFUND_STATUS_FROM: Record<"pending" | "succeeded" | "failed", RefundRow["status"][]> = {
  pending: ["requested"],
  succeeded: ["requested", "pending"],
  failed: ["requested", "pending", "succeeded"],
};

/** Move a refund row on; a failed one loses its credit (recomputed). */
export async function markOrganizationRefundStatus(args: {
  invoiceId: unknown;
  refundId: unknown;
  status: "pending" | "succeeded" | "failed";
  stripeRefundId?: string;
  failureReason?: string;
  now?: Date;
}): Promise<boolean> {
  const _id = oid(args.invoiceId);
  const refundId = oid(args.refundId);
  const r = await OrganizationInvoice.updateOne(
    { _id, refunds: { $elemMatch: { refundId, status: { $in: REFUND_STATUS_FROM[args.status] } } } },
    {
      $set: {
        "refunds.$[r].status": args.status,
        ...(args.stripeRefundId ? { "refunds.$[r].stripeRefundId": args.stripeRefundId } : {}),
        ...(args.failureReason ? { "refunds.$[r].failureReason": args.failureReason.slice(0, 200) } : {}),
      },
    },
    { arrayFilters: [{ "r.refundId": refundId }] },
  );
  if (r.modifiedCount !== 1) return false;
  if (args.status === "failed") await refreshInvoiceMoney(_id, args.now);
  return true;
}

/** Stripe refused outright: the requested row goes, as if never asked. */
export async function dropOrganizationStripeRefundRequest(args: {
  invoiceId: unknown;
  refundId: unknown;
  now?: Date;
}) {
  const _id = oid(args.invoiceId);
  await OrganizationInvoice.updateOne(
    { _id },
    { $pull: { refunds: { refundId: oid(args.refundId), status: "requested" } } },
  );
  await refreshInvoiceMoney(_id, args.now);
}

/** A chargeback on a card payment: flagged, reminders stop, the team is told. */
export async function flagOrganizationInvoiceDispute(
  paymentIntentId: string,
  now: Date = new Date(),
): Promise<"flagged" | "not_found"> {
  await connectToDatabase();
  const inv = await invoiceForIntent(paymentIntentId);
  if (!inv) return "not_found";
  await OrganizationInvoice.updateOne({ _id: inv._id }, { $set: { disputed: true } });
  await flagForReview(
    inv as Lean,
    "dispute",
    `L’organisme conteste le paiement par carte ${paymentIntentId} de la facture ${inv.number ?? "—"} auprès de sa banque. Stripe retient les fonds ; les rappels sont suspendus.`,
    now,
  );
  return "flagged";
}

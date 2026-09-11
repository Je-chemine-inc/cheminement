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
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Organization from "@/models/Organization";
import OrganizationInvoice, {
  type IOrganizationInvoice,
  type IOrganizationInvoicePaymentEvent,
} from "@/models/OrganizationInvoice";
import type { InvoiceResult } from "@/lib/organization-invoice";
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

type PaymentMethod = IOrganizationInvoice["payments"][number]["method"];
type PaymentSource = IOrganizationInvoice["payments"][number]["source"];
type Lean = Omit<IOrganizationInvoice, keyof mongoose.Document> & { _id: mongoose.Types.ObjectId };

/** Statuses that carry money: the status of these follows the balance. */
const MONEY_STATUSES = [...AWAITING_PAYMENT_STATUSES, "paid", "refunded"];

const oid = (id: unknown) => new mongoose.Types.ObjectId(String(id));

/**
 * Put the status in line with the balance, then the sessions in line with the
 * status. Each write re-checks the balance it relies on.
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
  // Everything that was paid went back.
  await OrganizationInvoice.updateOne(
    { _id, status: { $in: ["partially_paid", "paid"] }, paidCents: { $lte: 0 } },
    { $set: { status: "refunded" } },
  );
  const fresh = await OrganizationInvoice.findById(_id).select("status").lean();
  if (fresh?.status === "paid") {
    await Appointment.updateMany(
      { "thirdPartyBilling.orgInvoiceId": _id, "thirdPartyBilling.orgStatus": { $ne: "paid" } },
      { $set: { "thirdPartyBilling.orgStatus": "paid", "thirdPartyBilling.orgPaidAt": now } },
    );
  } else if (fresh && MONEY_STATUSES.includes(fresh.status)) {
    await Appointment.updateMany(
      { "thirdPartyBilling.orgInvoiceId": _id, "thirdPartyBilling.orgStatus": "paid" },
      { $set: { "thirdPartyBilling.orgStatus": "invoiced" }, $unset: { "thirdPartyBilling.orgPaidAt": 1 } },
    );
  }
  return fresh?.status ?? null;
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
 * A refund on a card payment. `exact` sets the refunded amount as given (a
 * refund that failed gives money back to the charge); otherwise it only ever
 * grows, so an old event delivered late cannot undo a newer one.
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
  // Paid and balance come from the payments as they now are — one atomic write.
  await OrganizationInvoice.updateOne({ _id: inv._id }, [
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
      },
    },
    { $set: { balanceCents: { $subtract: ["$totalCents", "$paidCents"] } } },
  ]);
  await syncInvoiceStatus(inv._id, now);
  await flagForReview(
    inv as Lean,
    "refund",
    target > before
      ? `Remboursement Stripe de ${money(target - before)} sur la facture ${inv.number ?? "—"} (paiement ${args.paymentIntentId}). Le solde dû a été ajusté.`
      : `Un remboursement Stripe a échoué sur la facture ${inv.number ?? "—"} (paiement ${args.paymentIntentId}) : ${money(before - target)} sont revenus. Le solde a été ajusté.`,
    now,
  );
  return "recorded";
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

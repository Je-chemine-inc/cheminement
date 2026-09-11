/**
 * Card payments from the organization's pay link (spec 002, phase 5).
 *
 * The amount is the invoice's balance, read from the database — nothing in the
 * request decides what is charged. The PaymentIntent carries
 * `type: "organization_invoice"` and the invoice id, and deliberately NO
 * `appointmentId`: the webhook must never mistake it for a session payment.
 * Money lands on the platform account; professionals were already credited
 * when their sessions closed.
 *
 * Card only. A bank debit (PAD) settles days later and can bounce after the
 * invoice looks paid; organizations that prefer their bank use Interac or EFT.
 */
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import connectToDatabase from "@/lib/mongodb";
import Organization from "@/models/Organization";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import { isAwaitingPayment, isPayTokenShaped } from "@/lib/organization-invoice-pay-link";
import { ORGANIZATION_INVOICE_PAYMENT_TYPE } from "@/lib/organization-invoice-settlement";

/** Stripe states where the payer still has to act: safe to hand back or cancel. */
const AWAITING_PAYER = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

export type StartCardPaymentResult =
  | { ok: true; clientSecret: string; amountCents: number; reused: boolean }
  | { ok: false; status: 404 | 409; code: string; error: string };

async function retrieveIntent(id: string): Promise<Stripe.PaymentIntent | null> {
  try {
    return await stripe.paymentIntents.retrieve(id);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") return null;
    // An outage must not be read as "nothing in flight".
    throw error;
  }
}

async function customerFor(organizationId: unknown): Promise<string | undefined> {
  const org = await Organization.findById(organizationId)
    .select("name billingEmails stripeCustomerId")
    .lean();
  if (!org) return undefined;
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const customer = await stripe.customers.create(
    {
      name: org.name,
      ...(org.billingEmails?.[0] ? { email: org.billingEmails[0] } : {}),
      metadata: { type: "organization", organizationId: String(org._id) },
    },
    { idempotencyKey: `org_customer_${String(org._id)}` },
  );
  await Organization.updateOne(
    { _id: org._id, stripeCustomerId: { $exists: false } },
    { $set: { stripeCustomerId: customer.id } },
  );
  return customer.id;
}

export async function startOrganizationCardPayment(token: unknown): Promise<StartCardPaymentResult> {
  await connectToDatabase();
  if (!isPayTokenShaped(token)) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "Invalid or expired payment link" };
  }
  const inv = await OrganizationInvoice.findOne({ payToken: token })
    .select("organizationId number status balanceCents stripePaymentIntentId payments")
    .lean();
  if (!inv) return { ok: false, status: 404, code: "NOT_FOUND", error: "Invalid or expired payment link" };
  if (!isAwaitingPayment(inv.status) || inv.balanceCents <= 0) {
    return { ok: false, status: 409, code: "NOT_PAYABLE", error: "Nothing is due on this invoice." };
  }
  const amountCents = inv.balanceCents;

  const previousId = inv.stripePaymentIntentId;
  if (previousId && !inv.payments.some((p) => p.externalRef === previousId)) {
    const previous = await retrieveIntent(previousId);
    if (previous && (previous.status === "processing" || previous.status === "succeeded")) {
      // Paid or paying, and the webhook has not recorded it yet.
      return {
        ok: false,
        status: 409,
        code: "PAYMENT_IN_PROGRESS",
        error: "A payment for this invoice is already being processed.",
      };
    }
    if (previous && AWAITING_PAYER.has(previous.status)) {
      if (previous.amount === amountCents && previous.client_secret) {
        return { ok: true, clientSecret: previous.client_secret, amountCents, reused: true };
      }
      // The balance moved (a cheque arrived meanwhile): never leave a live
      // intent for the old amount behind.
      await stripe.paymentIntents.cancel(previousId).catch(() => undefined);
    }
  }

  const customer = await customerFor(inv.organizationId);
  const pi = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: "cad",
      ...(customer ? { customer } : {}),
      payment_method_types: ["card"],
      description: `Je chemine — facture ${inv.number ?? ""}`.trim(),
      metadata: {
        type: ORGANIZATION_INVOICE_PAYMENT_TYPE,
        organizationInvoiceId: String(inv._id),
        organizationId: String(inv.organizationId),
        invoiceNumber: inv.number ?? "",
        // appointmentId is deliberately absent.
      },
    },
    { idempotencyKey: `orginv_${String(inv._id)}_${amountCents}_${inv.payments.length}` },
  );
  await OrganizationInvoice.updateOne({ _id: inv._id }, { $set: { stripePaymentIntentId: pi.id } });
  return { ok: true, clientSecret: pi.client_secret ?? "", amountCents, reused: false };
}

/**
 * Cancel a card payment someone started but never finished once it no longer
 * matches what is owed — the invoice was voided, settled another way, or its
 * balance moved — so an open browser tab cannot pay the old amount. The next
 * visit to the pay link starts a fresh one. Best effort; never throws.
 */
export async function cancelOpenOrganizationPaymentIntent(invoiceId: unknown): Promise<boolean> {
  try {
    await connectToDatabase();
    const inv = await OrganizationInvoice.findById(invoiceId)
      .select("status balanceCents stripePaymentIntentId payments")
      .lean();
    const id = inv?.stripePaymentIntentId;
    if (!inv || !id || inv.payments.some((p) => p.externalRef === id)) return false;
    const pi = await retrieveIntent(id);
    if (!pi || !AWAITING_PAYER.has(pi.status)) return false;
    const stillRight = isAwaitingPayment(inv.status) && pi.amount === inv.balanceCents;
    if (stillRight) return false;
    await stripe.paymentIntents.cancel(id);
    return true;
  } catch (e) {
    console.error("[organization-payment] could not cancel an open intent:", e);
    return false;
  }
}

/**
 * Online payments from the organization's pay link (spec 002, phase 5):
 * by card, or by pre-authorized bank debit (DPA / ACSS, phase 9).
 *
 * The amount is the invoice's balance, read from the database — nothing in the
 * request decides what is charged. The PaymentIntent carries
 * `type: "organization_invoice"` and the invoice id, and deliberately NO
 * `appointmentId`: the webhook must never mistake it for a session payment.
 * Money lands on the platform account; professionals were already credited
 * when their sessions closed.
 *
 * A bank debit is one-off ("sporadic", business account), confirmed by the
 * organization in Stripe's form, and never kept for future use: there is no
 * standing mandate. It settles in about 5 business days or bounces; the
 * invoice shows « débit en cours » meanwhile (`pendingDebit`). The DPA has its
 * own switch (`organizationPadEnabled`), off by default.
 */
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import connectToDatabase from "@/lib/mongodb";
import Organization from "@/models/Organization";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import {
  isAwaitingPayment,
  isOrganizationPadEnabled,
  isPayTokenShaped,
  type OrganizationPayMethod,
} from "@/lib/organization-invoice-pay-link";
import {
  ORGANIZATION_INVOICE_PAYMENT_TYPE,
  clearOrganizationPendingDebit,
  markOrganizationDebitProcessing,
  recordOrganizationDebitFailure,
  settleOrganizationInvoiceIntent,
} from "@/lib/organization-invoice-settlement";

/** Stripe states where the payer still has to act: safe to hand back or cancel. */
const AWAITING_PAYER = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

const STRIPE_TYPE: Record<OrganizationPayMethod, "card" | "acss_debit"> = { card: "card", pad: "acss_debit" };

/** Microdeposits: the organization confirms two small amounts on Stripe's page. */
export type DebitVerification = { url: string; arrivalDate: number | null };

export type StartPaymentResult =
  | {
      ok: true;
      clientSecret: string;
      amountCents: number;
      reused: boolean;
      method: OrganizationPayMethod;
      verification?: DebitVerification;
    }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string };

async function retrieveIntent(id: string): Promise<Stripe.PaymentIntent | null> {
  try {
    return await stripe.paymentIntents.retrieve(id);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") return null;
    // An outage must not be read as "nothing in flight".
    throw error;
  }
}

function verificationOf(pi: Stripe.PaymentIntent): DebitVerification | undefined {
  const v = pi.next_action?.type === "verify_with_microdeposits" ? pi.next_action.verify_with_microdeposits : null;
  return v?.hosted_verification_url ? { url: v.hosted_verification_url, arrivalDate: v.arrival_date ?? null } : undefined;
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

export async function startOrganizationPayment(
  token: unknown,
  method: unknown = "card",
): Promise<StartPaymentResult> {
  await connectToDatabase();
  if (method !== "card" && method !== "pad") {
    return { ok: false, status: 400, code: "INVALID_METHOD", error: "Pay by card or by bank debit." };
  }
  if (!isPayTokenShaped(token)) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "Invalid or expired payment link" };
  }
  if (method === "pad" && !(await isOrganizationPadEnabled())) {
    return { ok: false, status: 409, code: "METHOD_UNAVAILABLE", error: "Bank debit is not offered." };
  }
  const inv = await OrganizationInvoice.findOne({ payToken: token })
    .select("organizationId number status balanceCents stripePaymentIntentId payments pendingDebit")
    .lean();
  if (!inv) return { ok: false, status: 404, code: "NOT_FOUND", error: "Invalid or expired payment link" };
  if (!isAwaitingPayment(inv.status) || inv.balanceCents <= 0) {
    return { ok: false, status: 409, code: "NOT_PAYABLE", error: "Nothing is due on this invoice." };
  }
  // A debit is on its way: nothing to start, and nothing to ask Stripe.
  if (inv.pendingDebit?.paymentIntentId) {
    return {
      ok: false,
      status: 409,
      code: "PAYMENT_IN_PROGRESS",
      error: "A payment for this invoice is already being processed.",
    };
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
      const sameMethod = previous.payment_method_types?.includes(STRIPE_TYPE[method]);
      // A debit that failed once is never offered again: a new one each time.
      const failedDebit = method === "pad" && Boolean(previous.last_payment_error);
      if (previous.amount === amountCents && sameMethod && !failedDebit && previous.client_secret) {
        return {
          ok: true,
          clientSecret: previous.client_secret,
          amountCents,
          reused: true,
          method,
          ...(method === "pad" && verificationOf(previous) ? { verification: verificationOf(previous) } : {}),
        };
      }
      // The balance moved, or another way of paying was chosen: never leave a
      // live intent for the old amount or method behind.
      await stripe.paymentIntents.cancel(previousId).catch(() => undefined);
    }
  }

  const customer = await customerFor(inv.organizationId);
  const pi = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: "cad",
      ...(customer ? { customer } : {}),
      payment_method_types: [STRIPE_TYPE[method]],
      ...(method === "pad"
        ? {
            payment_method_options: {
              acss_debit: {
                // One debit, for this invoice, from a business account. No
                // setup_future_usage: nothing is kept for another debit.
                mandate_options: { payment_schedule: "sporadic", transaction_type: "business" },
                verification_method: "automatic",
              },
            },
          }
        : {}),
      description: `Je chemine — facture ${inv.number ?? ""}`.trim(),
      metadata: {
        type: ORGANIZATION_INVOICE_PAYMENT_TYPE,
        organizationInvoiceId: String(inv._id),
        organizationId: String(inv.organizationId),
        invoiceNumber: inv.number ?? "",
        method,
        // appointmentId is deliberately absent.
      },
    },
    // The method and the intent replaced are in the key: card → debit → card
    // must not replay the first, cancelled, intent.
    { idempotencyKey: `orginv_${String(inv._id)}_${method}_${amountCents}_${inv.payments.length}_${previousId ?? "none"}` },
  );
  await OrganizationInvoice.updateOne({ _id: inv._id }, { $set: { stripePaymentIntentId: pi.id } });
  return { ok: true, clientSecret: pi.client_secret ?? "", amountCents, reused: false, method };
}

/**
 * The pay page reports that Stripe accepted a bank debit. Not trusted: the
 * intent must be this invoice's own, and Stripe is asked for its status. Marks
 * the debit as on its way when Stripe says `processing` — for when the
 * `payment_intent.processing` webhook is not delivered.
 */
export async function confirmOrganizationPaymentStarted(
  token: unknown,
  paymentIntentId: unknown,
): Promise<
  | { ok: true; status: string; verification?: DebitVerification }
  | { ok: false; status: 404; code: string; error: string }
> {
  await connectToDatabase();
  const notFound = { ok: false as const, status: 404 as const, code: "NOT_FOUND", error: "Payment not found" };
  if (!isPayTokenShaped(token) || typeof paymentIntentId !== "string" || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
    return notFound;
  }
  const inv = await OrganizationInvoice.findOne({ payToken: token }).select("_id stripePaymentIntentId").lean();
  if (!inv || inv.stripePaymentIntentId !== paymentIntentId) return notFound;
  const pi = await retrieveIntent(paymentIntentId);
  if (!pi || pi.metadata?.organizationInvoiceId !== String(inv._id)) return notFound;
  if (pi.status === "processing") await markOrganizationDebitProcessing(pi);
  return { ok: true, status: pi.status, ...(verificationOf(pi) ? { verification: verificationOf(pi) } : {}) };
}

/**
 * « Vérifier » on a debit that has been on its way for a long time: ask Stripe
 * and do what its answer calls for — settle it, record the bounce, or clear a
 * marker left by a cancelled intent.
 */
export async function reconcileOrganizationDebit(
  invoiceId: string,
): Promise<"settled" | "processing" | "failed" | "cleared" | "none"> {
  await connectToDatabase();
  const inv = await OrganizationInvoice.findById(invoiceId).select("pendingDebit").lean();
  const id = inv?.pendingDebit?.paymentIntentId;
  if (!id) return "none";
  const pi = await retrieveIntent(id);
  if (!pi || pi.status === "canceled") {
    await clearOrganizationPendingDebit(id);
    return "cleared";
  }
  if (pi.status === "succeeded") {
    await settleOrganizationInvoiceIntent(pi);
    return "settled";
  }
  if (pi.status === "requires_payment_method") {
    await recordOrganizationDebitFailure(pi);
    // Whatever it made of it, the debit is no longer on its way.
    await clearOrganizationPendingDebit(id);
    return "failed";
  }
  return "processing";
}

/**
 * Cancel an online payment someone started but never finished once it no
 * longer matches what is owed — the invoice was voided, settled another way,
 * or its balance moved — so an open browser tab cannot pay the old amount. The
 * next visit to the pay link starts a fresh one. Best effort; never throws. A
 * debit already processing cannot be cancelled and is left alone.
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

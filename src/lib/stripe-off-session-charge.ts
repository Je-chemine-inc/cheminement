import { stripe, toCents } from "@/lib/stripe";
import { decryptPaymentMethodReference } from "@/lib/field-encryption";
import {
  pickChargeablePaymentMethod,
  type ChargeablePaymentMethod,
} from "@/lib/chargeable-payment-method";


/**
 * The client's payment method as held by Stripe, for an appointment that has
 * none of its own.
 *
 * A saved card attaches to the CUSTOMER; only the appointment-setup routes
 * ever copied a reference onto an appointment, and no booking route does. So a
 * second booking by a client who had already saved a card reached closure with
 * nothing to charge and the invoice sat pending with a good card on file.
 *
 * Returns null rather than throwing when the client genuinely has nothing:
 * closure must stay soft (an unchargeable session still closes, invoice
 * pending) — never block a professional from ending their session because of
 * a billing lookup.
 */
export async function resolveCustomerChargeablePaymentMethod(
  customerId: string,
): Promise<ChargeablePaymentMethod | null> {
  try {
    const [customer, cards, acss] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.paymentMethods.list({ customer: customerId, type: "card" }),
      stripe.paymentMethods.list({ customer: customerId, type: "acss_debit" }),
    ]);

    // A deleted customer comes back as { deleted: true } with no settings.
    const defaultPm =
      !("deleted" in customer) && customer.invoice_settings
        ? typeof customer.invoice_settings.default_payment_method === "string"
          ? customer.invoice_settings.default_payment_method
          : customer.invoice_settings.default_payment_method?.id
        : undefined;

    return pickChargeablePaymentMethod(defaultPm, cards.data, acss.data);
  } catch (e) {
    console.error(
      "[stripe-off-session-charge] customer payment-method lookup failed:",
      e,
    );
    return null;
  }
}
/**
 * Prélève la carte ou le PAD enregistré après clôture de séance (hors session navigateur).
 */
export async function chargeSavedPaymentMethodAfterSession(params: {
  appointmentId: string;
  customerId: string;
  encryptedPaymentMethodId: string | undefined;
  amountCad: number;
  method: "card" | "direct_debit";
}): Promise<{ paymentIntentId: string; settled: boolean }> {
  const pm = decryptPaymentMethodReference(params.encryptedPaymentMethodId);
  if (!pm) {
    throw new Error("MISSING_PAYMENT_METHOD");
  }

  if (
    typeof params.amountCad !== "number" ||
    params.amountCad <= 0 ||
    !Number.isFinite(params.amountCad)
  ) {
    throw new Error("INVALID_AMOUNT");
  }

  const payment_method_types: ("card" | "acss_debit")[] =
    params.method === "direct_debit" ? ["acss_debit"] : ["card"];

  const intentParams: Parameters<typeof stripe.paymentIntents.create>[0] = {
    amount: toCents(params.amountCad),
    currency: "cad",
    customer: params.customerId,
    payment_method: pm,
    off_session: true,
    confirm: true,
    metadata: {
      appointmentId: params.appointmentId,
    },
    payment_method_types,
  };

  if (params.method === "direct_debit") {
    intentParams.payment_method_options = {
      acss_debit: {
        mandate_options: {
          payment_schedule: "sporadic",
          transaction_type: "personal",
        },
        verification_method: "automatic",
      },
    };
  }

  // Idempotency key keyed on appointment + amount + method: if the same
  // closure charge is retried (double-click, network retry, concurrent
  // request), Stripe returns the SAME PaymentIntent instead of charging the
  // saved card twice. A genuinely different charge (different amount) gets a
  // distinct key. Keys live ~24h in Stripe, which comfortably covers a retry.
  const pi = await stripe.paymentIntents.create(intentParams, {
    idempotencyKey: `apt-charge-${params.appointmentId}-${toCents(
      params.amountCad,
    )}-${params.method}`,
  });

  if (
    pi.status === "requires_action" ||
    pi.status === "requires_confirmation"
  ) {
    throw new Error("PAYMENT_REQUIRES_ACTION");
  }

  // M1: ACSS / PAD pre-authorized debits settle ASYNCHRONOUSLY — a healthy
  // confirmed PaymentIntent returns "processing", not "succeeded". Treat that
  // as a valid pending-settlement outcome (the payment_intent.succeeded webhook
  // flips the appointment to "paid" later, keyed on metadata.appointmentId).
  // Only genuine failures throw.
  if (pi.status !== "succeeded" && pi.status !== "processing") {
    const msg = pi.last_payment_error?.message || `Statut: ${pi.status}`;
    throw new Error(msg);
  }

  return { paymentIntentId: pi.id, settled: pi.status === "succeeded" };
}

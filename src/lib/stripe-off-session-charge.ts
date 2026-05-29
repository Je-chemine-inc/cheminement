import { stripe, toCents } from "@/lib/stripe";
import { decryptPaymentMethodReference } from "@/lib/field-encryption";

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

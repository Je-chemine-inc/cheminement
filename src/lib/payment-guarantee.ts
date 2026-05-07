import { stripe } from "@/lib/stripe";
import User from "@/models/User";

/**
 * Client "Statut vert" via Stripe : carte ou PAD enregistré chez Stripe.
 * @param setStripeDefault - Si true, enregistre ce moyen comme défaut chez Stripe.
 * @param paymentMethodType - Type Stripe ("card" ou "acss_debit") pour traçabilité.
 */
export async function markClientPaymentGuaranteeGreen(
  userId: string,
  stripeCustomerId: string,
  paymentMethodId: string,
  setStripeDefault = true,
  paymentMethodType?: "card" | "acss_debit",
): Promise<void> {
  const update: Record<string, unknown> = {
    paymentGuaranteeStatus: "green",
    paymentGuaranteeSource: "stripe",
  };
  if (paymentMethodType === "card") update.preferredPaymentMethod = "card";
  else if (paymentMethodType === "acss_debit")
    update.preferredPaymentMethod = "direct_debit";

  await User.findByIdAndUpdate(userId, update);
  if (!setStripeDefault) {
    return;
  }
  try {
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  } catch (e) {
    console.error(
      "[payment-guarantee] Failed to set default payment method:",
      e,
    );
  }
}

/**
 * Statut vert par entente Interac / virement (validation admin).
 */
export async function approveInteracTrustGreen(userId: string): Promise<void> {
  await User.findByIdAndUpdate(userId, {
    paymentGuaranteeStatus: "green",
    paymentGuaranteeSource: "interac_trust",
    preferredPaymentMethod: "interac",
  });
}

/** Réaligne le statut avec les moyens Stripe ; préserve pending_admin et vert Interac sans carte. */
export async function syncPaymentGuaranteeStatusWithStripe(
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  const [card, acss] = await Promise.all([
    stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card" }),
    stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: "acss_debit",
    }),
  ]);
  const count = card.data.length + acss.data.length;

  if (count > 0) {
    await User.findByIdAndUpdate(userId, {
      paymentGuaranteeStatus: "green",
      paymentGuaranteeSource: "stripe",
    });
    return;
  }

  const u = await User.findById(userId).lean();
  if (!u) return;

  if (u.paymentGuaranteeStatus === "pending_admin") {
    return;
  }
  if (
    u.paymentGuaranteeStatus === "green" &&
    u.paymentGuaranteeSource === "interac_trust"
  ) {
    return;
  }

  await User.findByIdAndUpdate(userId, {
    $set: { paymentGuaranteeStatus: "none" },
    $unset: { paymentGuaranteeSource: "" },
  });
}

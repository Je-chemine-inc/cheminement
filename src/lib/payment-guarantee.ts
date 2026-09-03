import { stripe } from "@/lib/stripe";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import { encryptPaymentMethodReference } from "@/lib/field-encryption";


/**
 * Appointments that have not happened (or not been closed) yet. Only these
 * get a newly saved card linked onto them.
 *
 * A COMPLETED but unpaid session is deliberately excluded: linking a card
 * there would silence its dunning without ever charging it, quietly turning a
 * real debt invisible. Those are settled by an admin, not by this backfill.
 */
export const OPEN_APPOINTMENT_STATUSES = ["pending", "scheduled", "ongoing"];

/** Payment states where the money question is already closed. */
const SETTLED = ["paid", "processing", "refunded", "partially_refunded", "cancelled"];

/**
 * Link a freshly saved card/PAD onto the client's OPEN appointments.
 *
 * The card is attached to the Stripe *customer*, but every consumer — the
 * closure auto-charge and the post-session dunning gate — reads
 * `appointment.payment.stripePaymentMethodId`. A card added from the billing
 * page greened the user and left every appointment without a reference, so
 * closure soft-skipped the charge with MISSING_PAYMENT_METHOD and the client
 * was then emailed a manual payment reminder — for a card she had just given
 * us. Linking here closes that gap at the single choke point every card-save
 * path already goes through.
 *
 * Never overwrites a reference an appointment already carries (that one was
 * chosen for that booking). Stored encrypted, exactly as the setup routes do.
 */
export async function linkPaymentMethodToOpenAppointments(
  userId: string,
  paymentMethodId: string,
): Promise<number> {
  const stored = encryptPaymentMethodReference(paymentMethodId) ?? paymentMethodId;
  try {
    const res = await Appointment.updateMany(
      {
        clientId: userId,
        status: { $in: OPEN_APPOINTMENT_STATUSES },
        "payment.status": { $nin: SETTLED },
        $or: [
          { "payment.stripePaymentMethodId": { $exists: false } },
          { "payment.stripePaymentMethodId": null },
          { "payment.stripePaymentMethodId": "" },
        ],
      },
      { $set: { "payment.stripePaymentMethodId": stored } },
    );
    return res.modifiedCount ?? 0;
  } catch (e) {
    // Never fail the card save because the backfill did: the customer-level
    // card is already stored and the user is green.
    console.error("[payment-guarantee] linking payment method failed:", e);
    return 0;
  }
}

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
  // Make the card usable where it is actually read: on the open appointments.
  await linkPaymentMethodToOpenAppointments(userId, paymentMethodId);
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

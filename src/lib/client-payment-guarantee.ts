import type { IUser } from "@/models/User";

/**
 * Payment states where the client owes nothing further, so NO reminder of any
 * kind may go out. Shared by both gates below so the two can never drift.
 *
 * `processing` matters and was previously missing: an ACSS/PAD charge confirms
 * asynchronously — `complete-session` records it as "processing" and the
 * payment_intent.succeeded webhook flips it to "paid" later. In between, the
 * client HAS paid and the money is in flight, yet they were still being dunned.
 * `partially_refunded` likewise means the payment was made.
 *
 * `overdue` is deliberately NOT here — an overdue invoice is genuinely unpaid.
 */
export const SETTLED_PAYMENT_STATUSES = [
  "paid",
  "processing",
  "refunded",
  "partially_refunded",
  "cancelled",
] as const;

function isSettled(status: string | undefined | null): boolean {
  return (SETTLED_PAYMENT_STATUSES as readonly string[]).includes(status ?? "");
}

/** True si le client doit encore « sécuriser » le paiement (carte/PAD ou entente validée). */
export function clientLacksPaymentGuaranteeForAppointment(
  appointment: {
    payment?: {
      stripePaymentMethodId?: string;
      method?: string;
      status?: string;
    };
  },
  clientUser: Pick<IUser, "paymentGuaranteeStatus" | "paymentGuaranteeSource"> | null,
): boolean {
  // A settled/terminal payment (Stripe captured, an ACSS charge in flight, an
  // admin-confirmed Interac, refunded, or cancelled) means there is nothing left
  // to "guarantee" — never dun such a session. This is the authoritative
  // settlement signal and guards ALL reminder stages (day1/day2/h48/post-meeting)
  // that share this helper.
  if (isSettled(appointment.payment?.status)) {
    return false;
  }
  if (appointment.payment?.stripePaymentMethodId) return false;
  if (clientUser?.paymentGuaranteeStatus === "green") return false;
  if (
    clientUser?.paymentGuaranteeStatus === "pending_admin" &&
    appointment.payment?.method === "transfer"
  ) {
    return false;
  }
  return true;
}

/**
 * Post-meeting COLLECTION gate (distinct from the upfront-guarantee gate
 * above). A billable session whose fee is genuinely unpaid and for which we
 * hold NO Stripe payment method to auto-charge still needs a manual payment
 * reminder — and this INCLUDES `interac_trust` clients (M15: admin-granted
 * trust waives the upfront prepayment nudges, but a real no-show / late-cancel
 * fee must still be collected). A saved card/PAD means the fee is (or will be)
 * auto-charged, so no manual nudge is sent. See SETTLED_PAYMENT_STATUSES for
 * what counts as settled.
 */
export function clientOwesUncollectedFee(appointment: {
  payment?: { stripePaymentMethodId?: string; status?: string };
}): boolean {
  if (isSettled(appointment.payment?.status)) {
    return false;
  }
  if (appointment.payment?.stripePaymentMethodId) return false;
  return true;
}

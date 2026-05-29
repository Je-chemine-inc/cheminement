import type { IUser } from "@/models/User";

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
  // A settled/terminal payment (Stripe captured, admin-confirmed Interac,
  // refunded, or cancelled) means there is nothing left to "guarantee" — never
  // dun such a session. This is the authoritative settlement signal and guards
  // ALL reminder stages (day1/day2/h48/post-meeting) that share this helper.
  if (
    appointment.payment?.status === "paid" ||
    appointment.payment?.status === "refunded" ||
    appointment.payment?.status === "cancelled"
  ) {
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
 * auto-charged, so no manual nudge is sent. paid/refunded/cancelled are settled.
 */
export function clientOwesUncollectedFee(appointment: {
  payment?: { stripePaymentMethodId?: string; status?: string };
}): boolean {
  const status = appointment.payment?.status;
  if (status === "paid" || status === "refunded" || status === "cancelled") {
    return false;
  }
  if (appointment.payment?.stripePaymentMethodId) return false;
  return true;
}

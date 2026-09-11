/**
 * May this appointment be paid through the no-login `/pay?token=` link right now?
 *
 * The rule used to be "the appointment status is `completed`". But closing a
 * session as a late cancellation sets the status to `cancelled`, and a no-show
 * sets `no-show` — and closure emails the client a pay link for exactly those
 * fees. Every one of those links answered "not available for payment", so the
 * client could not pay a fee we were actively asking them to pay.
 *
 * A fee is payable when the professional CLOSED the session with a billable
 * outcome — see `sessionCompletedAt` / `sessionOutcome`, set atomically by
 * complete-session — and nothing has been settled yet. `status === "completed"`
 * stays payable on its own for older sessions completed before closure existed.
 */

/** Outcomes whose fee is billed even though the session did not take place. */
const LATE_OR_NO_SHOW_OUTCOMES = new Set(["cancelled_late", "no_show"]);

/** Payment states where paying again would be wrong. `processing` means Stripe
 *  has confirmed a payment in flight (a bank debit takes days to clear). */
const NOT_PAYABLE_PAYMENT_STATUSES: Record<string, GuestPayRefusal> = {
  paid: "ALREADY_PAID",
  processing: "PAYMENT_IN_PROGRESS",
  refunded: "NOT_AVAILABLE",
  partially_refunded: "NOT_AVAILABLE",
  cancelled: "NOT_AVAILABLE",
  // Nothing to pay: an organization pays, or the payer is being decided.
  covered: "NOT_AVAILABLE",
};

export type GuestPayRefusal =
  | "ALREADY_PAID"
  | "PAYMENT_IN_PROGRESS"
  | "NOT_CONFIRMED"
  | "NOT_AVAILABLE"
  | "NOT_YET_COMPLETED";

export type GuestPayDecision =
  | { payable: true }
  | { payable: false; code: GuestPayRefusal };

export interface GuestPayAppointment {
  status?: string | null;
  sessionCompletedAt?: Date | string | null;
  sessionOutcome?: string | null;
  payment?: { status?: string | null } | null;
}

/** A closed late cancellation or no-show: its fee is billed to the client. */
export function hasClosedLateOrNoShowFee(apt: GuestPayAppointment): boolean {
  return (
    Boolean(apt.sessionCompletedAt) &&
    LATE_OR_NO_SHOW_OUTCOMES.has(String(apt.sessionOutcome ?? ""))
  );
}

export function decideGuestPayment(apt: GuestPayAppointment): GuestPayDecision {
  const refusal = NOT_PAYABLE_PAYMENT_STATUSES[String(apt.payment?.status ?? "")];
  if (refusal) return { payable: false, code: refusal };

  if (apt.status === "completed" || hasClosedLateOrNoShowFee(apt)) {
    return { payable: true };
  }
  if (apt.status === "pending") return { payable: false, code: "NOT_CONFIRMED" };
  if (apt.status === "cancelled" || apt.status === "no-show") {
    return { payable: false, code: "NOT_AVAILABLE" };
  }
  return { payable: false, code: "NOT_YET_COMPLETED" };
}

/** Client-facing wording for each refusal (kept identical to the old messages). */
export const GUEST_PAY_REFUSAL_MESSAGES: Record<GuestPayRefusal, string> = {
  ALREADY_PAID: "This appointment has already been paid",
  PAYMENT_IN_PROGRESS:
    "A payment for this appointment is already being processed.",
  NOT_CONFIRMED: "This appointment is not yet confirmed by your professional.",
  NOT_AVAILABLE: "This appointment is not available for payment",
  NOT_YET_COMPLETED:
    "Payment opens after your session is completed. Use the same link to register a payment method first, then pay once your professional has marked the meeting as done.",
};

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
  // A third party pays, or an admin has yet to decide who does (spec 002).
  // Either way the CLIENT is not chased.
  "covered",
] as const;

/** True when a payment is in a SETTLED_PAYMENT_STATUSES state. Import this rather
 * than keeping a local copy of the list — copies drift. */
export function isSettledPaymentStatus(
  status: string | undefined | null,
): boolean {
  return (SETTLED_PAYMENT_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * The admin "Aucun paiement — séance passée" alert repeats until someone
 * reconciles the fee — that pressure is intended — but at most ONCE A DAY per
 * session. It had no limit at all, so once the reminder cron moved from daily
 * (Vercel) to hourly (/etc/cron.d/jechemine), the same alert hit the admin
 * inbox every hour: 18 copies in 18 hours for one client (2026-09-10).
 *
 * The 10-minute tolerance absorbs cron jitter. Without it, a run that starts a
 * few seconds earlier than yesterday's reads as 23h59m and slips the alert by
 * a full hour, drifting later every day.
 */
export const POST_MEETING_ADMIN_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ADMIN_ALERT_JITTER_TOLERANCE_MS = 10 * 60 * 1000;

export function isPostMeetingAdminAlertDue(
  lastSentAt: Date | string | null | undefined,
  nowMs: number,
): boolean {
  if (!lastSentAt) return true;
  const last = new Date(lastSentAt).getTime();
  // An unreadable stamp must not silence the alert forever.
  if (!Number.isFinite(last)) return true;
  return (
    nowMs - last >=
    POST_MEETING_ADMIN_ALERT_INTERVAL_MS - ADMIN_ALERT_JITTER_TOLERANCE_MS
  );
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
  if (isSettledPaymentStatus(appointment.payment?.status)) {
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
  if (isSettledPaymentStatus(appointment.payment?.status)) {
    return false;
  }
  if (appointment.payment?.stripePaymentMethodId) return false;
  return true;
}

/**
 * WHO should hear about a session fee we did not collect.
 *
 * `clientOwesUncollectedFee` answers "is this fee still outstanding" — it reads
 * only the appointment, because that is where the charge-time payment method
 * reference lives. That made us email a manual "please pay" nudge to clients
 * who had already saved a card: the card is attached to the Stripe CUSTOMER,
 * and a card saved from the billing page was never linked onto the
 * appointment, so closure skipped the auto-charge (MISSING_PAYMENT_METHOD)
 * and the client was then chased for a payment she had already set up.
 *
 * A client holding a valid guarantee has done her part. Nagging her is wrong
 * and reads as a broken platform. But the fee IS genuinely uncollected, so the
 * admin alert must still fire — louder, not quieter: this is our failure to
 * charge, and a human has to reconcile it.
 */
export function resolvePostMeetingNotification(
  appointment: {
    payment?: { stripePaymentMethodId?: string; status?: string };
  },
  clientUser: Pick<IUser, "paymentGuaranteeStatus" | "paymentGuaranteeSource"> | null,
): { notifyClient: boolean; notifyAdmin: boolean } {
  if (!clientOwesUncollectedFee(appointment)) {
    return { notifyClient: false, notifyAdmin: false };
  }
  // Green = a card/PAD on file, or an admin-approved Interac arrangement.
  const hasGuarantee = clientUser?.paymentGuaranteeStatus === "green";
  return { notifyClient: !hasGuarantee, notifyAdmin: true };
}

type PayingClient = Pick<
  IUser,
  "paymentGuaranteeStatus" | "paymentGuaranteeSource" | "preferredPaymentMethod"
>;

/**
 * A client who settles by Interac transfer: an admin-approved Interac
 * arrangement, or Interac chosen as their way to pay.
 *
 * An appointment's `payment.method` does not say this reliably. It defaults to
 * "card", and the professional, admin and follow-up booking paths never set
 * it, so an Interac client's sessions routinely read "card" (JC-2026-000014).
 */
export function paysByInterac(client: PayingClient | null | undefined): boolean {
  return (
    client?.paymentGuaranteeSource === "interac_trust" ||
    client?.preferredPaymentMethod === "interac"
  );
}

/**
 * Whether closure has a card to charge: one linked to the appointment, or the
 * card/PAD a green Stripe guarantee says the client's Stripe customer holds.
 */
export function hasCardOnFile(
  appointment: { payment?: { stripePaymentMethodId?: string } },
  client: PayingClient | null | undefined,
): boolean {
  if (appointment.payment?.stripePaymentMethodId) return true;
  return (
    client?.paymentGuaranteeStatus === "green" &&
    client.paymentGuaranteeSource === "stripe"
  );
}

/** Statuses meaning a card payment actually went through (when a Stripe intent is recorded). */
const CARD_PAYMENT_MADE = new Set(["paid", "processing", "refunded", "partially_refunded"]);

/**
 * What the admin billing screen may truthfully say next to a session's payment
 * method. It used to print « Carte validée » for every "card" session without
 * checking anything, so an Interac client who had never given a card showed a
 * validated card, and the unpaid session read as a failed charge.
 *
 * Mirrors closure: a card on file is charged; an Interac client with none is
 * billed by Interac (see complete-session).
 */
export type PaymentAssurance =
  | "card_on_file"
  | "billed_by_interac"
  | "no_card"
  | "interac_approved"
  | "interac_pending";

export function paymentAssurance(
  appointment: {
    payment?: {
      method?: string;
      status?: string;
      stripePaymentMethodId?: string;
      stripePaymentIntentId?: string;
    };
  },
  client: PayingClient | null | undefined,
): PaymentAssurance | null {
  const p = appointment.payment;
  if (p?.method === "card") {
    const cardPaid =
      Boolean(p.stripePaymentIntentId) && CARD_PAYMENT_MADE.has(p.status ?? "");
    if (cardPaid || hasCardOnFile(appointment, client)) return "card_on_file";
    return paysByInterac(client) ? "billed_by_interac" : "no_card";
  }
  if (p?.method === "transfer") {
    if (
      client?.paymentGuaranteeStatus === "green" &&
      client.paymentGuaranteeSource === "interac_trust"
    ) {
      return "interac_approved";
    }
    if (client?.paymentGuaranteeStatus === "pending_admin") return "interac_pending";
  }
  return null;
}

/**
 * What a session was billed IN TOTAL, and when a ledger credit counts as
 * revenue — once a third party can pay (spec 002).
 *
 * `Appointment.payment` is only the client's share: 0 $ when an organization
 * pays in full. Any report that sums `payment.price` alone under-counts every
 * covered session, so reports go through here. Pure — no DB, no Stripe.
 */

type AppointmentAmounts = {
  payment?: {
    price?: number | null;
    status?: string | null;
    refundedAmount?: number | null;
  } | null;
  thirdPartyBilling?: {
    orgAmountCents?: number | null;
    clientAmountCents?: number | null;
    orgStatus?: string | null;
  } | null;
};

const cents = (dollars: number | null | undefined) =>
  Math.round((Number(dollars) || 0) * 100);

/** Client share + organization share, in cents. */
export function sessionBilledTotalCents(apt: AppointmentAmounts): number {
  return cents(apt.payment?.price) + Math.round(apt.thirdPartyBilling?.orgAmountCents ?? 0);
}

/**
 * The same total as a Mongo aggregation expression, in dollars, for `$sum`.
 * Aggregations ignore `select: false`, so reading the snapshot here leaks
 * nothing — the result is an admin-only figure.
 */
export const SESSION_BILLED_TOTAL_EXPR = {
  $add: [
    { $ifNull: ["$payment.price", 0] },
    { $divide: [{ $ifNull: ["$thirdPartyBilling.orgAmountCents", 0] }, 100] },
  ],
} as const;

/** A client payment that actually came in (a later refund is its own event). */
const PAYMENT_RECEIVED = new Set(["paid", "refunded", "partially_refunded"]);

/**
 * Whether a professional's ledger credit is revenue yet (sales journal).
 *  - card / direct debit ("stripe"): once the money came in. It used to count
 *    at closure, but closure charges nothing when there is no card on file or
 *    the card is declined — the session then waits unpaid, like an Interac
 *    one — and a bank debit settles days later ("processing"). A credit whose
 *    session can no longer be read counts as recorded.
 *  - Interac ("transfer"): once the transfer is confirmed.
 *  - "organization": once the organization has paid AND the client's share,
 *    if any, is paid — until then it is a receivable, not revenue.
 *  - anything else (manual, external, adjustment rows): as recorded.
 */
export function isLedgerCreditCleared(
  entry: { paymentChannel?: string | null },
  apt: AppointmentAmounts | null | undefined,
): boolean {
  switch (entry.paymentChannel) {
    case "stripe":
      if (!apt?.payment) return true;
      return PAYMENT_RECEIVED.has(apt.payment.status ?? "");
    case "transfer":
      return apt?.payment?.status === "paid";
    case "organization": {
      const tpb = apt?.thirdPartyBilling;
      if (tpb?.orgStatus !== "paid") return false;
      const clientOwes = (tpb.clientAmountCents ?? 0) > 0;
      return !clientOwes || apt?.payment?.status === "paid";
    }
    default:
      return true;
  }
}

/**
 * How much of a card sale was refunded, in dollars — what the sales journal
 * takes back on the refund's date. `refundedAmount` is Stripe's cumulative
 * figure (the charge.refunded webhook writes it); a full refund recorded
 * before that webhook arrives only has its status, so it takes back the whole
 * price. Never more than was sold.
 */
export function refundedAmountCad(
  apt: AppointmentAmounts | null | undefined,
  soldCad: number,
): number {
  const p = apt?.payment;
  if (p?.status !== "refunded" && p?.status !== "partially_refunded") return 0;
  const amount =
    p.refundedAmount ?? (p.status === "refunded" ? (p.price ?? soldCad) : 0);
  return Math.max(0, Math.min(Number(amount) || 0, soldCad));
}

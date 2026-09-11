/**
 * What a session was billed IN TOTAL, and when a ledger credit counts as
 * revenue — once a third party can pay (spec 002).
 *
 * `Appointment.payment` is only the client's share: 0 $ when an organization
 * pays in full. Any report that sums `payment.price` alone under-counts every
 * covered session, so reports go through here. Pure — no DB, no Stripe.
 */

type AppointmentAmounts = {
  payment?: { price?: number | null; status?: string | null } | null;
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

/**
 * Whether a professional's ledger credit is revenue yet (sales journal).
 *  - card / direct debit ("stripe"): cleared at closure.
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

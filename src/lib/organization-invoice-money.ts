/**
 * What an organization owes on an invoice, and what a refund changes — the pure
 * rules (organization billing, refunds). No database, no Stripe: the service,
 * the serializer and the tests all use these same functions.
 *
 * The single money rule:
 *   paid     = Σ payments (amount − refunded)
 *   credited = Σ refunds not failed (creditCents)
 *   balance  = total − credited − paid
 * A negative balance is money the clinic holds that nobody owes it (an
 * overpayment), to be refunded.
 */

export type MoneyPayment = {
  paymentId?: unknown;
  amountCents: number;
  refundedCents?: number;
  source: string;
};

export type MoneyRefund = {
  paymentId: unknown;
  amountCents: number;
  creditCents: number;
  via: "stripe" | "outside";
  status: "requested" | "pending" | "succeeded" | "failed";
};

export function computeInvoiceMoney(inv: {
  totalCents: number;
  payments?: readonly MoneyPayment[] | null;
  refunds?: readonly MoneyRefund[] | null;
}): { paidCents: number; creditedCents: number; balanceCents: number } {
  const paidCents = (inv.payments ?? []).reduce(
    (sum, p) => sum + p.amountCents - (p.refundedCents ?? 0),
    0,
  );
  // A refund still `requested` counts: Stripe may already have made it.
  const creditedCents = (inv.refunds ?? [])
    .filter((r) => r.status !== "failed")
    .reduce((sum, r) => sum + (r.creditCents ?? 0), 0);
  return { paidCents, creditedCents, balanceCents: inv.totalCents - creditedCents - paidCents };
}

/** The part of a refund that only gives back an overpayment. */
export function overpaidPartCents(amountCents: number, balanceBeforeCents: number): number {
  return Math.min(amountCents, Math.max(0, -balanceBeforeCents));
}

/**
 * Whether the admin must say if the money is still owed. Not for a void
 * invoice (nothing is owed on it), nor when the refund only returns an
 * overpayment.
 */
export function needsOwedChoice(args: {
  amountCents: number;
  balanceBeforeCents: number;
  invoiceStatus: string;
}): boolean {
  if (args.invoiceStatus === "void") return false;
  return args.amountCents > overpaidPartCents(args.amountCents, args.balanceBeforeCents);
}

/**
 * The part the organization no longer owes. Only the part beyond the
 * overpayment can be credited, so a credit never takes the balance below zero
 * — refunding an overpayment just brings the balance back to 0.
 */
export function refundCreditCents(args: {
  amountCents: number;
  balanceBeforeCents: number;
  owed: "still" | "no_longer" | null | undefined;
  invoiceStatus: string;
}): number {
  if (args.invoiceStatus === "void" || args.owed !== "no_longer") return 0;
  return args.amountCents - overpaidPartCents(args.amountCents, args.balanceBeforeCents);
}

/**
 * How much of a Stripe payment the admin screen asked Stripe to refund. A
 * `charge.refunded` beyond that was made elsewhere (the Stripe dashboard) and
 * is the only kind the team is alerted about.
 */
export function explainedAdminRefundCents(
  refunds: readonly MoneyRefund[] | null | undefined,
  paymentId: unknown,
): number {
  return (refunds ?? [])
    .filter((r) => r.via === "stripe" && r.status !== "failed" && String(r.paymentId) === String(paymentId))
    .reduce((sum, r) => sum + r.amountCents, 0);
}

/** Statuses an invoice can be refunded from (money may sit on a void one). */
const REFUNDABLE_STATUSES = ["sent", "overdue", "partially_paid", "paid", "refunded", "void"];

export type RefundBlock = "NO_ID" | "DISPUTED" | "IN_PROGRESS" | "NOT_REFUNDABLE";

/** What can be refunded on one payment, how, and what stands in the way. */
export function refundabilityOf(
  inv: { status: string; disputed?: boolean | null; refunds?: readonly MoneyRefund[] | null },
  payment: MoneyPayment,
): { refundableCents: number; via: "stripe" | "outside"; blocked: RefundBlock | null } {
  const refundableCents = Math.max(0, payment.amountCents - (payment.refundedCents ?? 0));
  const via = payment.source === "stripe" ? "stripe" : "outside";
  let blocked: RefundBlock | null = null;
  if (!payment.paymentId) blocked = "NO_ID";
  else if (inv.disputed) blocked = "DISPUTED";
  else if ((inv.refunds ?? []).some((r) => r.status === "requested")) blocked = "IN_PROGRESS";
  else if (!REFUNDABLE_STATUSES.includes(inv.status) || refundableCents <= 0) blocked = "NOT_REFUNDABLE";
  return { refundableCents, via, blocked };
}

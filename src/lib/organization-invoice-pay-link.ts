/**
 * The organization's pay link (spec 002, phase 5): `/org-pay?token=…`.
 *
 * The token is a bearer credential sent to the organization's billing
 * addresses, so what it opens is deliberately small: the organization's name,
 * the invoice number, the amounts and the due date. Never a patient's name —
 * those stay in the PDF, which only goes out with every client's consent.
 *
 * No Stripe here: the invoice service imports this module, and `lib/stripe`
 * throws at load time without a key.
 */
import crypto from "crypto";
import OrganizationInvoice, {
  type OrganizationInvoiceStatus,
} from "@/models/OrganizationInvoice";

/** Statuses in which the organization still owes money on the invoice. */
export const AWAITING_PAYMENT_STATUSES = ["sent", "overdue", "partially_paid"] as const;

export function isAwaitingPayment(status: string | null | undefined): boolean {
  return (AWAITING_PAYMENT_STATUSES as readonly string[]).includes(status ?? "");
}

const TOKEN_RE = /^[a-f0-9]{64}$/;

/** 256 bits, like the other payment and access tokens. */
export function newPayToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function isPayTokenShaped(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function organizationPayUrl(token: string, lang: "fr" | "en"): string {
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return `${base}/org-pay?token=${token}&lang=${lang}`;
}

/**
 * The invoice's pay token, minting one if it has none (an invoice issued
 * before pay links existed). Conditional, so two callers agree on one token.
 */
export async function ensurePayToken(invoiceId: unknown): Promise<string | null> {
  const token = newPayToken();
  await OrganizationInvoice.updateOne(
    { _id: invoiceId, payToken: { $exists: false } },
    { $set: { payToken: token } },
  );
  const inv = await OrganizationInvoice.findById(invoiceId).select("payToken").lean();
  return inv?.payToken ?? null;
}

export type PublicInvoiceState = "awaiting" | "paid" | "closed";

/** What the pay page may show. Built field by field — never spread an invoice. */
export function publicInvoiceView(
  inv: {
    number?: string | null;
    status: OrganizationInvoiceStatus;
    totalCents: number;
    paidCents: number;
    creditedCents?: number | null;
    balanceCents: number;
    dueAt?: Date | null;
  },
  org: { name?: string | null; language?: string | null } | null,
  now: Date = new Date(),
) {
  const state: PublicInvoiceState = isAwaitingPayment(inv.status) && inv.balanceCents > 0
    ? "awaiting"
    : inv.status === "paid"
      ? "paid"
      : "closed";
  return {
    organizationName: org?.name ?? "",
    language: org?.language === "en" ? "en" : "fr",
    number: inv.number ?? "",
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    // What a refund marked « plus dû » took off the invoice.
    creditedCents: inv.creditedCents ?? 0,
    balanceCents: Math.max(0, inv.balanceCents),
    dueAt: inv.dueAt ?? null,
    overdue: state === "awaiting" && Boolean(inv.dueAt && new Date(inv.dueAt) < now),
    state,
  };
}

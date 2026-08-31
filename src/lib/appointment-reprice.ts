/**
 * Re-pricing an existing appointment (admin action).
 *
 * Changing a professional's rates never rewrites existing appointments — the
 * price agreed at booking stands until an admin deliberately changes it. This
 * module holds the guards and the arithmetic for that deliberate change, so the
 * routes stay thin and the money rules are testable.
 *
 * The rule that matters: a **paid or refunded** appointment, or one whose fiscal
 * receipt has been issued, is immutable. A fiscal receipt is an accounting
 * document; correcting one is the existing void-and-reissue flow, not this.
 */
import { roundMoney } from "@/lib/session-closure";

/** Payment states where money has moved or is moving — never re-price these. */
export const LOCKED_PAYMENT_STATUSES = [
  "paid",
  "processing",
  "refunded",
  "partially_refunded",
] as const;

export type RepriceRefusal =
  | "PAYMENT_LOCKED"
  | "RECEIPT_ISSUED"
  | "INVALID_CLIENT_PRICE"
  | "INVALID_PROFESSIONAL_PAYOUT"
  | "PAYOUT_EXCEEDS_PRICE";

export interface RepricableAppointment {
  payment?: { status?: string | null } | null;
  fiscalReceiptIssuedAt?: Date | string | null;
}

export interface RepriceAmounts {
  price: number;
  platformFee: number;
  professionalPayout: number;
}

/**
 * May this appointment be re-priced at all?
 *
 * `processing` counts as locked: an ACSS/PAD charge confirms asynchronously, so
 * the money is already in flight even though the status is not yet `paid`.
 */
export function canReprice(
  appointment: RepricableAppointment,
): { ok: true } | { ok: false; reason: RepriceRefusal } {
  const status = appointment.payment?.status ?? "pending";

  if ((LOCKED_PAYMENT_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, reason: "PAYMENT_LOCKED" };
  }
  if (appointment.fiscalReceiptIssuedAt) {
    return { ok: false, reason: "RECEIPT_ISSUED" };
  }
  return { ok: true };
}

/**
 * Build the new money fields.
 *
 * `platformFee` is derived as `price − professionalPayout`, so
 * `price === platformFee + professionalPayout` holds by construction — the same
 * invariant the booking and closure paths maintain.
 */
export function computeRepriceAmounts(
  clientPrice: unknown,
  professionalPayout: unknown,
): { ok: true; amounts: RepriceAmounts } | { ok: false; reason: RepriceRefusal } {
  const price = toMoney(clientPrice);
  if (price === undefined || price <= 0) {
    return { ok: false, reason: "INVALID_CLIENT_PRICE" };
  }

  const payout = toMoney(professionalPayout);
  if (payout === undefined || payout < 0) {
    return { ok: false, reason: "INVALID_PROFESSIONAL_PAYOUT" };
  }

  if (payout > price) {
    return { ok: false, reason: "PAYOUT_EXCEEDS_PRICE" };
  }

  return {
    ok: true,
    amounts: {
      price,
      professionalPayout: payout,
      platformFee: roundMoney(price - payout),
    },
  };
}

function toMoney(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  if (n > 1_000_000) return undefined;
  return roundMoney(n);
}

/** The `$set` an appointment re-price writes. Nothing else is touched. */
export function repriceSetPaths(amounts: RepriceAmounts): Record<string, number> {
  return {
    "payment.price": amounts.price,
    "payment.platformFee": amounts.platformFee,
    "payment.professionalPayout": amounts.professionalPayout,
    // Keep listPrice aligned with the new full price so a later prorated
    // closure prorates the re-priced amount, not the superseded one.
    "payment.listPrice": amounts.price,
  };
}

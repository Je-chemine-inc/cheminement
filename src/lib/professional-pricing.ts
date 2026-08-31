/**
 * Validation and arithmetic for admin-configured per-professional pricing.
 *
 * The model: the client pays `clientPrice`, the professional receives
 * `professionalRate`, and the platform keeps the spread between them. Both
 * amounts are stored explicitly — a percentage is only ever a UI affordance, so
 * money never drifts through repeated rounding (spec 001 AC-7).
 *
 * Kept out of the route so it can be tested as pure logic.
 */
import { roundMoney } from "@/lib/session-closure";

export const THERAPY_TYPES = ["solo", "couple", "group"] as const;
export type TherapyType = (typeof THERAPY_TYPES)[number];

export interface RateInput {
  /** What the client pays. `null` clears it (fall back to the platform default). */
  clientPrice?: number | null;
  /** What the professional receives. `null` clears it. */
  professionalRate?: number | null;
}

export type RatesInput = Partial<Record<TherapyType, RateInput>>;

export interface Spread {
  /** clientPrice − professionalRate, in dollars. */
  amount: number;
  /** The spread as a percentage of the client price. 0 when the price is 0. */
  percentage: number;
}

export type ValidationResult =
  | { ok: true; rates: RatesInput }
  | { ok: false; error: string; field: string };

const MAX_PRICE = 100_000;

function isTherapyType(value: string): value is TherapyType {
  return (THERAPY_TYPES as readonly string[]).includes(value);
}

/**
 * Parse one money field. Returns `undefined` when absent (leave alone) and
 * `null` when explicitly cleared.
 */
function parseMoney(
  value: unknown,
): { ok: true; value: number | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };

  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false };
  if (n < 0 || n > MAX_PRICE) return { ok: false };

  return { ok: true, value: roundMoney(n) };
}

/**
 * Validate an admin's pricing payload.
 *
 * Rejects a professional rate above the client price — that would have the
 * platform pay out more than it collected (AC-8). A spread of exactly 0 is
 * permitted: the platform simply earns nothing on that professional, which the
 * UI must warn about rather than block (AC-17).
 *
 * `existing` supplies the currently-stored values so a partial update (e.g.
 * changing only the rate) is still validated against the effective pair.
 */
export function validateRatesInput(
  input: unknown,
  existing: RatesInput = {},
): ValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "INVALID_PAYLOAD", field: "rates" };
  }

  const out: RatesInput = {};

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!isTherapyType(key)) {
      return { ok: false, error: "UNKNOWN_THERAPY_TYPE", field: key };
    }
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "INVALID_PAYLOAD", field: key };
    }

    const { clientPrice: rawPrice, professionalRate: rawRate } =
      raw as RateInput;

    const price = parseMoney(rawPrice);
    if (!price.ok) {
      return { ok: false, error: "INVALID_CLIENT_PRICE", field: key };
    }
    const rate = parseMoney(rawRate);
    if (!rate.ok) {
      return { ok: false, error: "INVALID_PROFESSIONAL_RATE", field: key };
    }

    // A client price of 0 is meaningless — clear it instead.
    if (price.value !== undefined && price.value !== null && price.value <= 0) {
      return { ok: false, error: "CLIENT_PRICE_MUST_BE_POSITIVE", field: key };
    }

    // Validate against the effective pair, so changing one side is still checked
    // against the other's stored value.
    const effectivePrice =
      price.value === undefined ? existing[key]?.clientPrice : price.value;
    const effectiveRate =
      rate.value === undefined ? existing[key]?.professionalRate : rate.value;

    if (
      typeof effectivePrice === "number" &&
      typeof effectiveRate === "number" &&
      effectiveRate > effectivePrice
    ) {
      return { ok: false, error: "RATE_EXCEEDS_CLIENT_PRICE", field: key };
    }

    const entry: RateInput = {};
    if (price.value !== undefined) entry.clientPrice = price.value;
    if (rate.value !== undefined) entry.professionalRate = rate.value;
    if (Object.keys(entry).length > 0) out[key] = entry;
  }

  return { ok: true, rates: out };
}

/** What the platform keeps, in dollars and as a percentage of the client price. */
export function spreadOf(
  clientPrice: number | undefined | null,
  professionalRate: number | undefined | null,
): Spread {
  const price = typeof clientPrice === "number" ? clientPrice : 0;
  const rate = typeof professionalRate === "number" ? professionalRate : 0;

  const amount = roundMoney(price - rate);
  const percentage = price > 0 ? roundMoney((amount / price) * 100) : 0;

  return { amount, percentage };
}

/**
 * Back-compute the professional's rate from a spread percentage, for the UI's
 * "enter a percentage" affordance. The **amount** is what gets stored — the
 * percentage is never the source of truth.
 */
export function rateFromSpreadPercentage(
  clientPrice: number,
  spreadPercentage: number,
): number {
  if (!Number.isFinite(clientPrice) || clientPrice <= 0) return 0;
  const clamped = Math.min(Math.max(spreadPercentage, 0), 100);
  return roundMoney(clientPrice * (1 - clamped / 100));
}

/** Build the mongoose `$set` paths for a validated payload. */
export function ratesToSetPaths(rates: RatesInput): Record<string, number> {
  const $set: Record<string, number> = {};
  for (const type of THERAPY_TYPES) {
    const entry = rates[type];
    if (!entry) continue;
    if (typeof entry.clientPrice === "number") {
      $set[`rates.${type}.clientPrice`] = entry.clientPrice;
    }
    if (typeof entry.professionalRate === "number") {
      $set[`rates.${type}.professionalRate`] = entry.professionalRate;
    }
  }
  return $set;
}

/** Build the mongoose `$unset` paths for fields the admin explicitly cleared. */
export function ratesToUnsetPaths(rates: RatesInput): Record<string, ""> {
  const $unset: Record<string, ""> = {};
  for (const type of THERAPY_TYPES) {
    const entry = rates[type];
    if (!entry) continue;
    if (entry.clientPrice === null) $unset[`rates.${type}.clientPrice`] = "";
    if (entry.professionalRate === null) {
      $unset[`rates.${type}.professionalRate`] = "";
    }
  }
  return $unset;
}

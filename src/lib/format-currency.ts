/**
 * Money formatting for the UI.
 *
 * Takes INTEGER CENTS, never dollars. Everything premium stores cents
 * (`ContentEntry.priceCents`, `ResourceEntitlement.amountCents`) so that
 * amounts compare exactly; converting to a float before formatting would
 * reintroduce the drift the cents rule exists to prevent.
 *
 * Safe in client components: no Mongoose, no server imports. Deliberately NOT
 * `formatPrice` from @/lib/pricing — that module pulls in PlatformSettings and
 * Profile models at import time and is hardcoded to en-CA.
 */

/** Shown instead of "NaN $" when an amount is missing or unusable. */
export const NO_PRICE = "—";

/**
 * `formatCad(1900, "fr")` -> "19 $"     ·  `formatCad(1900, "en")` -> "$19"
 * `formatCad(1999, "fr")` -> "19,99 $"  ·  `formatCad(1999, "en")` -> "$19.99"
 *
 * Whole dollars drop the ",00" — a price list reads better as "19 $" than
 * "19,00 $", and every price the admin sets is a round marketing number far
 * more often than not.
 *
 * Note: fr-CA puts a non-breaking space before the "$". That is correct Quebec
 * typography, not a stray character — do not strip it. Which non-breaking space
 * ICU picks (U+00A0 or U+202F) varies by Node and browser version, so never
 * assert on the exact byte.
 */
export function formatCad(cents: number, locale: string): string {
  if (!Number.isFinite(cents)) return NO_PRICE;

  const amount = cents / 100;
  const whole = Number.isInteger(amount);

  return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

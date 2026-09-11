/**
 * Integer-cents helpers with no dependencies.
 *
 * `toCents` also exists in `src/lib/stripe.ts`, but that module throws on import
 * when STRIPE_SECRET_KEY is unset, so pure billing logic (and its specs) cannot
 * import it. Same rounding rule, so the two always agree.
 */

/** Dollars → integer cents, rounded half away from zero like `roundMoney`. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer cents → dollars. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** A non-negative whole number of cents. */
export function isNonNegativeCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

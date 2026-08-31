/**
 * Hide the client gross and the platform's margin from professionals.
 *
 * A professional is entitled to see what **they** are paid
 * (`payment.professionalPayout`) but not what the client was charged
 * (`payment.price` / `payment.listPrice`) nor what the platform kept
 * (`payment.platformFee`) — commercial confidentiality plus accounting clarity.
 * The professional terms bind pros to confidentiality on "les tarifs et
 * honoraires convenus", and this is the technical half of that.
 *
 * This logic was previously copy-pasted into three route handlers with no test
 * coverage. Any new endpoint that returns an appointment must call this rather
 * than hand-rolling a fourth copy — that is how a margin leak ships.
 *
 * Known, accepted limitation: the **client's** own fiscal receipt legitimately
 * shows the full price, so a professional shown a client's receipt can still
 * infer the margin. Out of scope here; not a defect in this function.
 */

/** Payment fields a professional must never receive. */
export const PROFESSIONAL_REDACTED_PAYMENT_FIELDS = [
  "price",
  "platformFee",
  "listPrice",
] as const;

/**
 * Strip the confidential payment fields from a **plain** appointment object.
 *
 * Expects an object already detached from mongoose (i.e. the result of
 * `.toObject()` or `.lean()`), and mutates it in place before returning it —
 * matching the behaviour of the three call sites this replaces. Never pass a
 * live mongoose document: mutating one could persist the deletions.
 */
export function redactPaymentForProfessional<T>(appointment: T): T {
  const obj = appointment as unknown as Record<string, unknown>;
  const payment = obj?.payment;

  if (payment && typeof payment === "object") {
    const p = payment as Record<string, unknown>;
    for (const field of PROFESSIONAL_REDACTED_PAYMENT_FIELDS) {
      delete p[field];
    }
  }

  return appointment;
}

/** Array convenience wrapper — same rules as the single-object form. */
export function redactPaymentForProfessionalAll<T>(appointments: T[]): T[] {
  return appointments.map(redactPaymentForProfessional);
}

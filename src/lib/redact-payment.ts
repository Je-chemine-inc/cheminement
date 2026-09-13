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

  // Third-party billing (spec 002). The organization's amount, its negotiated
  // rate and the clinic's margin are as confidential as the client's price. A
  // professional sees only who pays and what THEY are paid. The client's payer
  // declaration and the admin's override note are not theirs either.
  if (obj && typeof obj === "object") {
    const tpb = obj.thirdPartyBilling;
    if (tpb && typeof tpb === "object") {
      const t = tpb as Record<string, unknown>;
      obj.thirdPartyBilling = {
        kind: t.kind,
        proPayoutTotalCents: t.proPayoutTotalCents,
      };
      // `payment` is the CLIENT's share — 0 $ when an organization pays in
      // full. The professional is paid for the whole session, so what their
      // screens read as "my pay" is the total (the same figure as their ledger).
      if (
        payment &&
        typeof payment === "object" &&
        typeof t.proPayoutTotalCents === "number" &&
        Number.isFinite(t.proPayoutTotalCents)
      ) {
        (payment as Record<string, unknown>).professionalPayout =
          Math.round(t.proPayoutTotalCents) / 100;
      }
    }
    delete obj.payerDeclaration;
    delete obj.billingOverride;
  }

  return appointment;
}

/**
 * Third-party billing as a CLIENT may see it: who pays (so their screen can say
 * "payé par votre organisme" or "réglé hors plateforme"), never the
 * organization's amount, rate, the clinic's margin or the professional's pay.
 * Mutates a plain object in place, like `redactPaymentForProfessional`.
 */
export function redactThirdPartyBillingForClient<T>(appointment: T): T {
  const obj = appointment as unknown as Record<string, unknown>;
  if (!obj || typeof obj !== "object") return appointment;
  const tpb = obj.thirdPartyBilling;
  if (tpb && typeof tpb === "object") {
    const t = tpb as Record<string, unknown>;
    obj.thirdPartyBilling = {
      kind: t.kind,
      state: t.state,
      ...(t.externalPayerLabel ? { externalPayerLabel: t.externalPayerLabel } : {}),
    };
  }
  delete obj.billingOverride;
  return appointment;
}

/**
 * The ledger fields a professional may receive. An ALLOW-list: the route used
 * to strip two fields and spread the rest, so every new ledger column — the
 * organization's share among them — would have reached professionals.
 */
export const PROFESSIONAL_VISIBLE_LEDGER_FIELDS = [
  "_id",
  "professionalId",
  "entryKind",
  "cycleKey",
  "appointmentId",
  "adjustsAppointmentId",
  "sessionActNature",
  "netToProfessionalCad",
  "paymentChannel",
  "payoutAmountCad",
  "payoutReference",
  "payoutNotes",
  // A product sale and its corrections (spec 003 phase 5): the professional's
  // own product, and the net they receive — never the gross or the fee.
  "source",
  "productSlug",
  "createdAt",
] as const;

export function redactLedgerEntryForProfessional(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of PROFESSIONAL_VISIBLE_LEDGER_FIELDS) {
    if (field in entry) out[field] = entry[field];
  }
  return out;
}

/** Array convenience wrapper — same rules as the single-object form. */
export function redactPaymentForProfessionalAll<T>(appointments: T[]): T[] {
  return appointments.map(redactPaymentForProfessional);
}

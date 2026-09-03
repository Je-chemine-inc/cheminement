/**
 * Which payment method to charge when the appointment carries none.
 *
 * The card a client saves attaches to their Stripe CUSTOMER. Only the
 * appointment-setup routes ever copied a reference onto an appointment, and no
 * booking route does it at all — so an appointment created any other way (a
 * second booking by a client who already saved a card, an admin-scheduled
 * session, a referral) reached closure with nothing to charge. Closure then
 * soft-skipped with MISSING_PAYMENT_METHOD and the invoice sat pending, even
 * though a perfectly good card was on file.
 *
 * This picks the method to fall back to. It is deliberately pure so the choice
 * — which is a money decision — is tested without Stripe in the loop.
 *
 * Ordering rationale: the customer's own configured default wins, because that
 * is the instrument the client (or the save flow) designated. Otherwise a card
 * beats an ACSS/PAD debit: a card settles synchronously, while ACSS confirms
 * asynchronously and leaves the invoice in "processing" for days.
 */

export interface StripePaymentMethodLike {
  id: string;
  type: string;
}

export interface ChargeablePaymentMethod {
  paymentMethodId: string;
  /** The charge method implied by the payment method's OWN type. */
  method: "card" | "direct_debit";
}

function methodForType(type: string): "card" | "direct_debit" | null {
  if (type === "card") return "card";
  if (type === "acss_debit") return "direct_debit";
  return null;
}

function toChargeable(
  pm: StripePaymentMethodLike | undefined,
): ChargeablePaymentMethod | null {
  if (!pm?.id) return null;
  const method = methodForType(pm.type);
  return method ? { paymentMethodId: pm.id, method } : null;
}

/**
 * @param defaultPaymentMethodId the customer's `invoice_settings.default_payment_method`
 * @param cards                  attached card payment methods
 * @param acssDebits             attached ACSS/PAD payment methods
 */
export function pickChargeablePaymentMethod(
  defaultPaymentMethodId: string | null | undefined,
  cards: StripePaymentMethodLike[],
  acssDebits: StripePaymentMethodLike[],
): ChargeablePaymentMethod | null {
  const all = [...cards, ...acssDebits].filter((pm) => pm?.id);

  const wanted = defaultPaymentMethodId?.trim();
  if (wanted) {
    const match = toChargeable(all.find((pm) => pm.id === wanted));
    // A default that is not among the attached methods is stale — ignore it
    // rather than charging an id Stripe will reject.
    if (match) return match;
  }

  // Prefer a card: it settles now. ACSS/PAD would leave the invoice
  // "processing" until the webhook confirms.
  const card = toChargeable(cards.find((pm) => methodForType(pm.type) === "card"));
  if (card) return card;

  return toChargeable(
    acssDebits.find((pm) => methodForType(pm.type) === "direct_debit"),
  );
}

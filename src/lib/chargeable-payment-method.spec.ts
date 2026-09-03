/**
 * Regression: a client's saved card attaches to their Stripe CUSTOMER, but only
 * the appointment-setup routes ever copied a reference onto an appointment —
 * and no booking route does. So a second booking by a client who had already
 * saved a card reached closure with nothing to charge, was soft-skipped as
 * MISSING_PAYMENT_METHOD, and the invoice sat pending with a good card on file.
 */
import { describe, it, expect } from "vitest";
import { pickChargeablePaymentMethod } from "./chargeable-payment-method";

const card = (id: string) => ({ id, type: "card" });
const acss = (id: string) => ({ id, type: "acss_debit" });

describe("pickChargeablePaymentMethod", () => {
  it("honours the customer's configured default", () => {
    expect(
      pickChargeablePaymentMethod("pm_default", [card("pm_other"), card("pm_default")], []),
    ).toEqual({ paymentMethodId: "pm_default", method: "card" });
  });

  it("derives the charge method from the payment method's OWN type", () => {
    // The appointment may say "card" while the only instrument is a PAD.
    // Charging acss_debit as a card is rejected by Stripe.
    expect(pickChargeablePaymentMethod("pm_pad", [], [acss("pm_pad")])).toEqual({
      paymentMethodId: "pm_pad",
      method: "direct_debit",
    });
  });

  it("prefers a card over a PAD when there is no default", () => {
    // A card settles now; ACSS leaves the invoice "processing" for days.
    expect(
      pickChargeablePaymentMethod(null, [card("pm_card")], [acss("pm_pad")]),
    ).toEqual({ paymentMethodId: "pm_card", method: "card" });
  });

  it("falls back to a PAD when that is all the client has", () => {
    expect(pickChargeablePaymentMethod(undefined, [], [acss("pm_pad")])).toEqual({
      paymentMethodId: "pm_pad",
      method: "direct_debit",
    });
  });

  it("ignores a stale default that is no longer attached", () => {
    // Charging an id Stripe no longer holds just errors; fall through instead.
    expect(
      pickChargeablePaymentMethod("pm_detached", [card("pm_live")], []),
    ).toEqual({ paymentMethodId: "pm_live", method: "card" });
  });

  it("returns null when the client has nothing on file", () => {
    expect(pickChargeablePaymentMethod(null, [], [])).toBeNull();
    expect(pickChargeablePaymentMethod("pm_x", [], [])).toBeNull();
  });

  it("ignores payment method types we cannot charge off-session", () => {
    expect(
      pickChargeablePaymentMethod(null, [{ id: "pm_link", type: "link" }], []),
    ).toBeNull();
  });

  it("ignores a default pointing at an uncharegable type but still finds a card", () => {
    expect(
      pickChargeablePaymentMethod(
        "pm_link",
        [{ id: "pm_link", type: "link" }, card("pm_card")],
        [],
      ),
    ).toEqual({ paymentMethodId: "pm_card", method: "card" });
  });

  it("tolerates a blank default string", () => {
    expect(pickChargeablePaymentMethod("   ", [card("pm_card")], [])).toEqual({
      paymentMethodId: "pm_card",
      method: "card",
    });
  });
});

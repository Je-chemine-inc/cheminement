/**
 * Regression: a client saved her card and the platform kept asking her to pay.
 *
 * The card attaches to the Stripe CUSTOMER, but the closure auto-charge and the
 * post-session dunning gate both read `appointment.payment.stripePaymentMethodId`.
 * A card added from the billing page greened the user and left every appointment
 * without a reference, so closure soft-skipped the charge
 * (MISSING_PAYMENT_METHOD) and she was then emailed a manual payment reminder —
 * for the card she had just given us.
 */
import { describe, it, expect } from "vitest";
import { resolvePostMeetingNotification } from "./client-payment-guarantee";

type GuaranteeUser = Parameters<typeof resolvePostMeetingNotification>[1];

const green = { paymentGuaranteeStatus: "green", paymentGuaranteeSource: "stripe" } as GuaranteeUser;
const greenInterac = { paymentGuaranteeStatus: "green", paymentGuaranteeSource: "interac_trust" } as GuaranteeUser;
const pendingAdmin = { paymentGuaranteeStatus: "pending_admin" } as GuaranteeUser;
const noGuarantee = { paymentGuaranteeStatus: "none" } as GuaranteeUser;

const unpaid = { payment: { status: "pending" } };

describe("resolvePostMeetingNotification", () => {
  it("never nags a client who already saved a card — but still alerts the admin", () => {
    // Her appointment carries NO payment method reference (the card lives on the
    // Stripe customer), which is exactly the state that used to dun her.
    expect(resolvePostMeetingNotification(unpaid, green)).toEqual({
      notifyClient: false,
      notifyAdmin: true,
    });
  });

  it("treats an admin-approved Interac arrangement the same way", () => {
    expect(resolvePostMeetingNotification(unpaid, greenInterac)).toEqual({
      notifyClient: false,
      notifyAdmin: true,
    });
  });

  it("still chases a client who gave us no way to pay", () => {
    expect(resolvePostMeetingNotification(unpaid, noGuarantee)).toEqual({
      notifyClient: true,
      notifyAdmin: true,
    });
    expect(resolvePostMeetingNotification(unpaid, null)).toEqual({
      notifyClient: true,
      notifyAdmin: true,
    });
  });

  it("still chases a client whose arrangement is only REQUESTED, not approved", () => {
    // pending_admin waives the upfront nudges, not a real uncollected fee.
    expect(resolvePostMeetingNotification(unpaid, pendingAdmin)).toEqual({
      notifyClient: true,
      notifyAdmin: true,
    });
  });

  it.each(["paid", "processing", "refunded", "partially_refunded", "cancelled"])(
    "stays silent on both channels when the payment is %s",
    (status) => {
      expect(resolvePostMeetingNotification({ payment: { status } }, noGuarantee)).toEqual({
        notifyClient: false,
        notifyAdmin: false,
      });
    },
  );

  it("stays silent when the appointment itself carries a card to auto-charge", () => {
    expect(
      resolvePostMeetingNotification(
        { payment: { status: "pending", stripePaymentMethodId: "enc_pm" } },
        noGuarantee,
      ),
    ).toEqual({ notifyClient: false, notifyAdmin: false });
  });

  it("an overdue fee is still chased — overdue is not settled", () => {
    expect(resolvePostMeetingNotification({ payment: { status: "overdue" } }, noGuarantee)).toEqual({
      notifyClient: true,
      notifyAdmin: true,
    });
  });
});

/**
 * H5: a settled/terminal payment must never be dunned. The shared guard now
 * short-circuits on payment.status paid/refunded/cancelled across all reminder
 * stages, while preserving the existing card / green / pending_admin behavior.
 */
import { describe, it, expect } from "vitest";
import {
  clientLacksPaymentGuaranteeForAppointment,
  clientOwesUncollectedFee,
  SETTLED_PAYMENT_STATUSES,
} from "./client-payment-guarantee";

type GuaranteeUser = Parameters<
  typeof clientLacksPaymentGuaranteeForAppointment
>[1];

describe("clientLacksPaymentGuaranteeForAppointment", () => {
  it("H5: returns false for a paid appointment (no dunning)", () => {
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { status: "paid" } },
        null,
      ),
    ).toBe(false);
  });

  it("H5: returns false for refunded / cancelled payments", () => {
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { status: "refunded" } },
        null,
      ),
    ).toBe(false);
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { status: "cancelled" } },
        null,
      ),
    ).toBe(false);
  });

  it("still LACKS guarantee for a pending unpaid appointment (no card, no user)", () => {
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { status: "pending" } },
        null,
      ),
    ).toBe(true);
  });

  it("returns false when a card / PAD is on file (existing behavior)", () => {
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { stripePaymentMethodId: "pm_1", status: "pending" } },
        null,
      ),
    ).toBe(false);
  });

  it("returns false for a green-guarantee user (existing behavior)", () => {
    const green = {
      paymentGuaranteeStatus: "green",
      paymentGuaranteeSource: "stripe",
    } as GuaranteeUser;
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { status: "pending" } },
        green,
      ),
    ).toBe(false);
  });

  it("returns false for pending_admin + transfer (existing behavior)", () => {
    const pendingAdmin = {
      paymentGuaranteeStatus: "pending_admin",
      paymentGuaranteeSource: "interac_trust",
    } as GuaranteeUser;
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { method: "transfer", status: "pending" } },
        pendingAdmin,
      ),
    ).toBe(false);
  });
});

describe("clientOwesUncollectedFee (M15: post-meeting collection gate)", () => {
  it("owes when the fee is unpaid and there is no card to auto-charge (incl. interac_trust)", () => {
    expect(clientOwesUncollectedFee({ payment: { status: "pending" } })).toBe(
      true,
    );
    expect(clientOwesUncollectedFee({ payment: { status: "overdue" } })).toBe(
      true,
    );
  });

  it("does NOT owe once settled (paid / refunded / cancelled)", () => {
    expect(clientOwesUncollectedFee({ payment: { status: "paid" } })).toBe(
      false,
    );
    expect(clientOwesUncollectedFee({ payment: { status: "refunded" } })).toBe(
      false,
    );
    expect(clientOwesUncollectedFee({ payment: { status: "cancelled" } })).toBe(
      false,
    );
  });

  it("does NOT owe when a card/PAD is on file (it auto-charges)", () => {
    expect(
      clientOwesUncollectedFee({
        payment: { stripePaymentMethodId: "pm_1", status: "pending" },
      }),
    ).toBe(false);
  });
});

/**
 * Regression: an ACSS/PAD charge confirms asynchronously — complete-session
 * records it as "processing" and the payment_intent.succeeded webhook flips it
 * to "paid" later. In between the client HAS paid and the money is in flight,
 * but neither gate excluded "processing", so they were dunned for a payment
 * they had already made. Same for a partial refund, which implies payment.
 */
describe("settled statuses must never be dunned", () => {
  it.each([...SETTLED_PAYMENT_STATUSES])(
    "clientLacksPaymentGuaranteeForAppointment is false for %s",
    (status) => {
      expect(
        clientLacksPaymentGuaranteeForAppointment({ payment: { status } }, null),
      ).toBe(false);
    },
  );

  it.each([...SETTLED_PAYMENT_STATUSES])(
    "clientOwesUncollectedFee is false for %s",
    (status) => {
      expect(clientOwesUncollectedFee({ payment: { status } })).toBe(false);
    },
  );

  it("includes processing — an ACSS charge already in flight", () => {
    expect(SETTLED_PAYMENT_STATUSES).toContain("processing");
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { status: "processing" } },
        null,
      ),
    ).toBe(false);
    expect(clientOwesUncollectedFee({ payment: { status: "processing" } })).toBe(
      false,
    );
  });

  it("includes partially_refunded — a partial refund implies payment was made", () => {
    expect(SETTLED_PAYMENT_STATUSES).toContain("partially_refunded");
    expect(
      clientOwesUncollectedFee({ payment: { status: "partially_refunded" } }),
    ).toBe(false);
  });

  it("does NOT include overdue — an overdue invoice is genuinely unpaid", () => {
    expect(SETTLED_PAYMENT_STATUSES).not.toContain("overdue");
    expect(clientOwesUncollectedFee({ payment: { status: "overdue" } })).toBe(
      true,
    );
    expect(
      clientLacksPaymentGuaranteeForAppointment(
        { payment: { status: "overdue" } },
        null,
      ),
    ).toBe(true);
  });

  it("still duns a genuinely pending payment", () => {
    expect(clientOwesUncollectedFee({ payment: { status: "pending" } })).toBe(
      true,
    );
  });
});

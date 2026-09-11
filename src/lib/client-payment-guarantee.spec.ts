/**
 * H5: a settled/terminal payment must never be dunned. The shared guard now
 * short-circuits on payment.status paid/refunded/cancelled across all reminder
 * stages, while preserving the existing card / green / pending_admin behavior.
 */
import { describe, it, expect } from "vitest";
import {
  clientLacksPaymentGuaranteeForAppointment,
  clientOwesUncollectedFee,
  hasCardOnFile,
  paymentAssurance,
  paymentMethodForNewAppointment,
  paysByInterac,
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

/**
 * JC-2026-000014: an Interac client (admin-approved arrangement, no card ever
 * given) had a professional-booked session stored as "card" — the model's
 * default. The billing screen printed « Carte validée » for it, so the unpaid
 * session read as a card the platform had failed to charge.
 */
describe("what may be said about how a session gets paid", () => {
  const interacClient = {
    paymentGuaranteeStatus: "green",
    paymentGuaranteeSource: "interac_trust",
    preferredPaymentMethod: "interac",
  } as const;
  const cardClient = {
    paymentGuaranteeStatus: "green",
    paymentGuaranteeSource: "stripe",
    preferredPaymentMethod: "card",
  } as const;
  const nothingClient = { paymentGuaranteeStatus: "none" } as const;

  it("an Interac client is one with an approved arrangement or who chose Interac", () => {
    expect(paysByInterac(interacClient)).toBe(true);
    expect(paysByInterac({ paymentGuaranteeSource: "interac_trust" })).toBe(true);
    expect(paysByInterac({ preferredPaymentMethod: "interac" })).toBe(true);
    expect(paysByInterac(cardClient)).toBe(false);
    expect(paysByInterac(nothingClient)).toBe(false);
    expect(paysByInterac(null)).toBe(false);
  });

  it("a card is on file only when one is linked or a Stripe guarantee holds one", () => {
    expect(hasCardOnFile({ payment: { stripePaymentMethodId: "enc" } }, null)).toBe(true);
    expect(hasCardOnFile({ payment: {} }, cardClient)).toBe(true);
    expect(hasCardOnFile({ payment: {} }, interacClient)).toBe(false);
    expect(hasCardOnFile({ payment: {} }, { paymentGuaranteeStatus: "pending_admin", paymentGuaranteeSource: "stripe" })).toBe(false);
  });

  it("the reported session: « card », no card, Interac client → billed by Interac, not « card validated »", () => {
    expect(
      paymentAssurance({ payment: { method: "card", status: "pending" } }, interacClient),
    ).toBe("billed_by_interac");
  });

  it("a card session with nothing on file says so", () => {
    expect(
      paymentAssurance({ payment: { method: "card", status: "pending" } }, nothingClient),
    ).toBe("no_card");
    expect(paymentAssurance({ payment: { method: "card", status: "pending" } }, null)).toBe(
      "no_card",
    );
  });

  it("a card session is « card validated » when a card is really there", () => {
    expect(
      paymentAssurance(
        { payment: { method: "card", status: "pending", stripePaymentMethodId: "enc" } },
        nothingClient,
      ),
    ).toBe("card_on_file");
    expect(
      paymentAssurance({ payment: { method: "card", status: "pending" } }, cardClient),
    ).toBe("card_on_file");
  });

  it("a card charge that went through counts, an intent that was only opened does not", () => {
    const charged = { method: "card", status: "paid", stripePaymentIntentId: "pi_1" };
    expect(paymentAssurance({ payment: charged }, nothingClient)).toBe("card_on_file");
    // /pay records the intent before the client pays: not a card yet.
    const opened = { method: "card", status: "pending", stripePaymentIntentId: "pi_2" };
    expect(paymentAssurance({ payment: opened }, nothingClient)).toBe("no_card");
    // Settled by Interac while the label still said "card": no Stripe intent.
    expect(
      paymentAssurance({ payment: { method: "card", status: "paid" } }, interacClient),
    ).toBe("billed_by_interac");
  });

  it("an Interac session is « validated » only once an admin approved the arrangement", () => {
    expect(paymentAssurance({ payment: { method: "transfer" } }, interacClient)).toBe(
      "interac_approved",
    );
    expect(
      paymentAssurance(
        { payment: { method: "transfer" } },
        { paymentGuaranteeStatus: "pending_admin", preferredPaymentMethod: "interac" },
      ),
    ).toBe("interac_pending");
    expect(paymentAssurance({ payment: { method: "transfer" } }, nothingClient)).toBeNull();
  });

  it("claims nothing for other methods", () => {
    expect(paymentAssurance({ payment: { method: "manual" } }, cardClient)).toBeNull();
    expect(paymentAssurance({ payment: { method: "direct_debit" } }, cardClient)).toBeNull();
    expect(paymentAssurance({}, cardClient)).toBeNull();
  });
});

/**
 * Sessions booked by a professional or an admin were stored as "card" — the
 * model's default — whatever the client's arrangement.
 */
describe("the payment method a new session carries", () => {
  const approvedInterac = {
    paymentGuaranteeStatus: "green",
    paymentGuaranteeSource: "interac_trust",
    preferredPaymentMethod: "interac",
  } as const;
  const awaitingInterac = { paymentGuaranteeStatus: "pending_admin", preferredPaymentMethod: "interac" } as const;
  const cardClient = { paymentGuaranteeStatus: "green", paymentGuaranteeSource: "stripe", preferredPaymentMethod: "card" } as const;
  const padClient = { paymentGuaranteeStatus: "green", paymentGuaranteeSource: "stripe", preferredPaymentMethod: "direct_debit" } as const;

  it("an Interac client with no card gets an Interac session", () => {
    expect(paymentMethodForNewAppointment(approvedInterac)).toBe("transfer");
    expect(paymentMethodForNewAppointment(awaitingInterac)).toBe("transfer");
    expect(paymentMethodForNewAppointment({ preferredPaymentMethod: "interac" })).toBe("transfer");
  });

  it("everyone else keeps what the route wrote before", () => {
    expect(paymentMethodForNewAppointment(cardClient)).toBe("card");
    expect(paymentMethodForNewAppointment({ paymentGuaranteeStatus: "none" })).toBe("card");
    expect(paymentMethodForNewAppointment(null)).toBe("card");
    expect(paymentMethodForNewAppointment(cardClient, "direct_debit")).toBe("direct_debit");
    expect(paymentMethodForNewAppointment({ paymentGuaranteeStatus: "none" }, "transfer")).toBe("transfer");
  });

  it("a client with a card is never given an Interac session, not even as a follow-up", () => {
    // Interac preference but a card saved: closure would bill a "transfer"
    // session by Interac and leave the card uncharged.
    expect(paymentMethodForNewAppointment({ ...cardClient, preferredPaymentMethod: "interac" })).toBe("card");
    expect(paymentMethodForNewAppointment(cardClient, "transfer")).toBe("card");
    expect(paymentMethodForNewAppointment(padClient, "transfer")).toBe("direct_debit");
    // A card linked on the session being followed counts as a card on file.
    expect(paymentMethodForNewAppointment(approvedInterac, "card", { cardLinked: true })).toBe("card");
  });
});

/**
 * An Interac request awaiting approval is the client's answer — yet sessions a
 * professional or an admin booked were stored as "card", so the client kept
 * being asked to add a card while the team reviewed the request.
 */
describe("no card nudges while an Interac request awaits approval", () => {
  const awaitingInterac = { paymentGuaranteeStatus: "pending_admin", preferredPaymentMethod: "interac" } as const;

  it("whatever the session's label says", () => {
    expect(
      clientLacksPaymentGuaranteeForAppointment({ payment: { method: "card", status: "pending" } }, awaitingInterac),
    ).toBe(false);
    expect(
      clientLacksPaymentGuaranteeForAppointment({ payment: { method: "transfer", status: "pending" } }, awaitingInterac),
    ).toBe(false);
  });

  it("but a client with no arrangement at all is still asked", () => {
    expect(
      clientLacksPaymentGuaranteeForAppointment({ payment: { method: "card", status: "pending" } }, { paymentGuaranteeStatus: "none", preferredPaymentMethod: "interac" }),
    ).toBe(true);
    expect(
      clientLacksPaymentGuaranteeForAppointment({ payment: { method: "card", status: "pending" } }, { paymentGuaranteeStatus: "pending_admin", preferredPaymentMethod: "card" }),
    ).toBe(true);
  });
});

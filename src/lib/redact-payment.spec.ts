/**
 * The professional-facing payment redaction was duplicated across three route
 * handlers with zero test coverage. These tests pin the contract so a fourth
 * endpoint cannot quietly leak the platform's margin.
 */
import { describe, it, expect } from "vitest";
import {
  PROFESSIONAL_REDACTED_PAYMENT_FIELDS,
  redactPaymentForProfessional,
  redactPaymentForProfessionalAll,
  redactThirdPartyBillingForClient,
  redactLedgerEntryForProfessional,
  PROFESSIONAL_VISIBLE_LEDGER_FIELDS,
} from "./redact-payment";

const appointment = () => ({
  _id: "a1",
  status: "scheduled",
  payment: {
    price: 175,
    listPrice: 175,
    platformFee: 25,
    professionalPayout: 150,
    status: "pending",
    method: "card",
  },
});

describe("redactPaymentForProfessional", () => {
  it("removes the client gross and the platform margin", () => {
    const out = redactPaymentForProfessional(appointment());

    expect(out.payment).not.toHaveProperty("price");
    expect(out.payment).not.toHaveProperty("listPrice");
    expect(out.payment).not.toHaveProperty("platformFee");
  });

  it("keeps what the professional is entitled to see", () => {
    const out = redactPaymentForProfessional(appointment());

    expect(out.payment.professionalPayout).toBe(150);
    expect(out.payment.status).toBe("pending");
    expect(out.payment.method).toBe("card");
  });

  it("leaves non-payment fields untouched", () => {
    const out = redactPaymentForProfessional(appointment());

    expect(out._id).toBe("a1");
    expect(out.status).toBe("scheduled");
  });

  it("redacts every field in the exported list", () => {
    const out = redactPaymentForProfessional(appointment()) as unknown as {
      payment: Record<string, unknown>;
    };

    for (const field of PROFESSIONAL_REDACTED_PAYMENT_FIELDS) {
      expect(out.payment).not.toHaveProperty(field);
    }
  });

  it("tolerates an appointment with no payment subdocument", () => {
    const out = redactPaymentForProfessional({ _id: "a1", status: "pending" });
    expect(out).toEqual({ _id: "a1", status: "pending" });
  });

  it("tolerates a null or undefined payment", () => {
    expect(() =>
      redactPaymentForProfessional({ _id: "a1", payment: null }),
    ).not.toThrow();
    expect(() =>
      redactPaymentForProfessional({ _id: "a1", payment: undefined }),
    ).not.toThrow();
  });

  it("does not throw on null or undefined input", () => {
    expect(() => redactPaymentForProfessional(null)).not.toThrow();
    expect(() => redactPaymentForProfessional(undefined)).not.toThrow();
  });

  it("is idempotent", () => {
    const once = redactPaymentForProfessional(appointment());
    const twice = redactPaymentForProfessional(once);

    expect(twice.payment).not.toHaveProperty("price");
    expect(twice.payment.professionalPayout).toBe(150);
  });

  it("cannot be defeated by a price of 0 or a falsy payment field", () => {
    // A `delete` must not be skipped just because the value is falsy.
    const out = redactPaymentForProfessional({
      payment: { price: 0, listPrice: 0, platformFee: 0, professionalPayout: 0 },
    });

    expect(out.payment).not.toHaveProperty("price");
    expect(out.payment).not.toHaveProperty("platformFee");
    expect(out.payment.professionalPayout).toBe(0);
  });
});

describe("redactPaymentForProfessionalAll", () => {
  it("redacts every appointment in the list", () => {
    const out = redactPaymentForProfessionalAll([
      appointment(),
      appointment(),
      appointment(),
    ]);

    expect(out).toHaveLength(3);
    for (const apt of out) {
      expect(apt.payment).not.toHaveProperty("price");
      expect(apt.payment).not.toHaveProperty("platformFee");
      expect(apt.payment.professionalPayout).toBe(150);
    }
  });

  it("returns an empty array unchanged", () => {
    expect(redactPaymentForProfessionalAll([])).toEqual([]);
  });
});

describe("third-party billing (spec 002)", () => {
  const withTpb = () => ({
    _id: "apt-1",
    payment: { price: 30, platformFee: 3, professionalPayout: 27, status: "pending" },
    thirdPartyBilling: {
      kind: "organization",
      state: "confirmed",
      organizationId: "org-1",
      orgAmountCents: 9000,
      clientAmountCents: 3000,
      clinicAbsorbedCents: 0,
      platformFeeTotalCents: 1200,
      proPayoutTotalCents: 10800,
      gapPolicy: "client_copay",
    },
    payerDeclaration: { organizationName: "PAE Desjardins", caseNumber: "PAE-4471" },
    billingOverride: { payer: "organization", note: "note interne" },
  });

  it("professionals see who pays and what they earn — never the org's amount or the margin", () => {
    const apt = redactPaymentForProfessional(withTpb()) as Record<string, unknown>;
    expect(apt.thirdPartyBilling).toEqual({ kind: "organization", proPayoutTotalCents: 10800 });
    expect(apt).not.toHaveProperty("payerDeclaration");
    expect(apt).not.toHaveProperty("billingOverride");
  });

  it("shows the professional their pay for the WHOLE session, not the client's share", () => {
    // Client co-pays 30 (pro share 27); the organization pays the rest.
    const apt = redactPaymentForProfessional(withTpb()) as { payment: Record<string, unknown> };
    expect(apt.payment.professionalPayout).toBe(108);
    expect(apt.payment).not.toHaveProperty("price");
  });

  it("leaves the payout alone when there is no third party", () => {
    const apt = redactPaymentForProfessional({
      payment: { price: 120, platformFee: 12, professionalPayout: 108 },
    }) as { payment: Record<string, unknown> };
    expect(apt.payment.professionalPayout).toBe(108);
  });

  it("clients see who pays — never the org's amount, the margin or the pro's pay", () => {
    const apt = redactThirdPartyBillingForClient(withTpb()) as Record<string, unknown>;
    expect(apt.thirdPartyBilling).toEqual({ kind: "organization", state: "confirmed" });
    expect(apt).not.toHaveProperty("billingOverride");
    // Their own declaration is theirs to see.
    expect(apt).toHaveProperty("payerDeclaration");
  });

  it("keeps the external payer label a client's receipt screen needs", () => {
    const apt = redactThirdPartyBillingForClient({
      thirdPartyBilling: { kind: "external", state: "confirmed", externalPayerLabel: "PAE X", orgAmountCents: 0 },
    }) as { thirdPartyBilling: Record<string, unknown> };
    expect(apt.thirdPartyBilling).toEqual({ kind: "external", state: "confirmed", externalPayerLabel: "PAE X" });
  });
});

describe("redactLedgerEntryForProfessional", () => {
  it("is an allow-list: new ledger columns never reach professionals by default", () => {
    const out = redactLedgerEntryForProfessional({
      _id: "e1",
      netToProfessionalCad: 108,
      paymentChannel: "organization",
      grossAmountCad: 120,
      platformFeeCad: 12,
      orgAmountCad: 90,
      clientAmountCad: 30,
      note: "internal",
      someFutureColumn: "secret",
    });
    expect(out).toEqual({ _id: "e1", netToProfessionalCad: 108, paymentChannel: "organization" });
  });

  it("keeps every field the professional's screen reads", () => {
    const full = Object.fromEntries(PROFESSIONAL_VISIBLE_LEDGER_FIELDS.map((f) => [f, "x"]));
    expect(redactLedgerEntryForProfessional(full)).toEqual(full);
  });
});

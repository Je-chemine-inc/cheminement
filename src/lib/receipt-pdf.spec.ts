import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildFiscalReceiptInputFromPopulatedAppointment,
  buildFiscalReceiptPdfBuffer,
} from "@/lib/receipt-pdf";

/**
 * Spec 002, owner's rule: a session settled outside the platform gets an
 * official client receipt that SAYS who paid, so the client cannot also claim it
 * from their own insurer.
 */

const appointment = (over: Record<string, unknown> = {}) => ({
  _id: "0123456789abcdef01234567",
  date: new Date("2026-09-10T12:00:00Z"),
  time: "10:00",
  duration: 50,
  type: "in-person",
  therapyType: "solo",
  bookingFor: "self",
  sessionActNature: "individual_psychotherapy",
  sessionOutcome: "completed",
  payment: {
    price: 120,
    platformFee: 12,
    professionalPayout: 108,
    status: "paid",
    method: "manual",
    paidAt: new Date("2026-09-10T15:00:00Z"),
  },
  clientId: { firstName: "Élorie", lastName: "B", email: "e@example.com" },
  professionalId: { firstName: "Sam", lastName: "Pro", email: "p@example.com" },
  ...over,
});

describe("the external payer on the client's receipt", () => {
  it("names who paid outside the platform", () => {
    const input = buildFiscalReceiptInputFromPopulatedAppointment(
      appointment({
        thirdPartyBilling: { kind: "external", externalPayerLabel: "PAE Desjardins" },
      }),
    );
    expect(input.paymentMethodLabel).toBe(
      "Réglé hors plateforme — payeur : PAE Desjardins",
    );
  });

  it("falls back to a neutral label when no organization is named", () => {
    const input = buildFiscalReceiptInputFromPopulatedAppointment(
      appointment({ thirdPartyBilling: { kind: "external" } }),
    );
    expect(input.paymentMethodLabel).toBe(
      "Réglé hors plateforme — payeur : Hors plateforme",
    );
  });

  it("leaves every other receipt exactly as before", () => {
    expect(
      buildFiscalReceiptInputFromPopulatedAppointment(appointment()).paymentMethodLabel,
    ).toBe("Paiement manuel");
    expect(
      buildFiscalReceiptInputFromPopulatedAppointment(
        appointment({
          payment: { price: 30, platformFee: 3, professionalPayout: 27, status: "paid", method: "card" },
          thirdPartyBilling: { kind: "organization" },
        }),
      ).paymentMethodLabel,
    ).toBe("Carte (Stripe)");
  });

  it("prints the label into the PDF itself", () => {
    const input = buildFiscalReceiptInputFromPopulatedAppointment(
      appointment({
        thirdPartyBilling: { kind: "external", externalPayerLabel: "PAE Desjardins" },
      }),
    );
    const pdf = buildFiscalReceiptPdfBuffer(input).toString("latin1");
    // jsPDF writes text uncompressed; the accented "é" is encoded, so match the ASCII part.
    expect(pdf).toContain("hors plateforme");
    expect(pdf).toContain("PAE Desjardins");
  });
});

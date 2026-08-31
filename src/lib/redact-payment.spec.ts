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

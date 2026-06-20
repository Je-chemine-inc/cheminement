import { describe, it, expect } from "vitest";
import { resolveServiceRequestRecipient } from "./service-request-recipient";

describe("resolveServiceRequestRecipient", () => {
  const referrerFallback = {
    fallbackName: "Dr House",
    fallbackEmail: "dr.house@clinic.test",
  };

  it("self → the requester (fallback)", () => {
    expect(
      resolveServiceRequestRecipient({
        bookingFor: "self",
        ...referrerFallback,
      }),
    ).toEqual({
      toName: "Dr House",
      toEmail: "dr.house@clinic.test",
      recipientKind: "requester",
    });
  });

  describe("patient referral", () => {
    it("routes the confirmation to the PATIENT when a patient email is present", () => {
      expect(
        resolveServiceRequestRecipient({
          bookingFor: "patient",
          referralInfo: {
            patientFirstName: "Camille",
            patientLastName: "Client",
            patientEmail: "camille@patient.test",
          },
          ...referrerFallback,
        }),
      ).toEqual({
        toName: "Camille Client",
        toEmail: "camille@patient.test",
        recipientKind: "patient",
      });
    });

    it("never sends the patient confirmation to the referrer when a patient email exists", () => {
      const { toEmail, recipientKind } = resolveServiceRequestRecipient({
        bookingFor: "patient",
        referralInfo: { patientEmail: "camille@patient.test" },
        ...referrerFallback,
      });
      expect(toEmail).toBe("camille@patient.test");
      expect(toEmail).not.toBe(referrerFallback.fallbackEmail);
      expect(recipientKind).toBe("patient");
    });

    it("falls back to the referrer (requester kind) when the patient email is blank", () => {
      expect(
        resolveServiceRequestRecipient({
          bookingFor: "patient",
          referralInfo: {
            patientFirstName: "Camille",
            patientLastName: "Client",
            patientEmail: "   ",
          },
          ...referrerFallback,
        }),
      ).toEqual({
        toName: "Dr House",
        toEmail: "dr.house@clinic.test",
        recipientKind: "requester",
      });
    });

    it("falls back to the referrer when referralInfo has no patient email at all", () => {
      expect(
        resolveServiceRequestRecipient({
          bookingFor: "patient",
          referralInfo: {},
          ...referrerFallback,
        }),
      ).toEqual({
        toName: "Dr House",
        toEmail: "dr.house@clinic.test",
        recipientKind: "requester",
      });
    });

    it("uses a generic name when the patient name is missing but email is present", () => {
      expect(
        resolveServiceRequestRecipient({
          bookingFor: "patient",
          referralInfo: { patientEmail: "camille@patient.test" },
          ...referrerFallback,
        }),
      ).toEqual({
        toName: "Client",
        toEmail: "camille@patient.test",
        recipientKind: "patient",
      });
    });
  });

  describe("loved-one", () => {
    it("14+ adult with an email → the loved one directly", () => {
      expect(
        resolveServiceRequestRecipient({
          bookingFor: "loved-one",
          lovedOneUnder14: false,
          lovedOneInfo: { firstName: "Alex", email: "alex@loved.test" },
          fallbackName: "Parent",
          fallbackEmail: "parent@home.test",
        }),
      ).toEqual({
        toName: "Alex",
        toEmail: "alex@loved.test",
        recipientKind: "loved-one",
      });
    });

    it("under 14 → the requester/parent (fallback), never the minor", () => {
      expect(
        resolveServiceRequestRecipient({
          bookingFor: "loved-one",
          lovedOneUnder14: true,
          lovedOneInfo: { firstName: "Alex", email: "alex@loved.test" },
          fallbackName: "Parent",
          fallbackEmail: "parent@home.test",
        }),
      ).toEqual({
        toName: "Parent",
        toEmail: "parent@home.test",
        recipientKind: "requester",
      });
    });

    it("14+ adult without an email → the requester (fallback)", () => {
      expect(
        resolveServiceRequestRecipient({
          bookingFor: "loved-one",
          lovedOneUnder14: false,
          lovedOneInfo: { firstName: "Alex" },
          fallbackName: "Parent",
          fallbackEmail: "parent@home.test",
        }),
      ).toEqual({
        toName: "Parent",
        toEmail: "parent@home.test",
        recipientKind: "requester",
      });
    });
  });

  it("returns a null email (send nothing) when no fallback email exists", () => {
    expect(
      resolveServiceRequestRecipient({ bookingFor: "self", fallbackName: "X" }),
    ).toEqual({ toName: "X", toEmail: null, recipientKind: "requester" });
  });

  it("defaults to a generic name when the fallback name is blank", () => {
    expect(
      resolveServiceRequestRecipient({
        bookingFor: "self",
        fallbackEmail: "x@test.test",
      }),
    ).toEqual({
      toName: "Client",
      toEmail: "x@test.test",
      recipientKind: "requester",
    });
  });
});

/**
 * Regression: a doctor's referral registered the DOCTOR as the appointment's
 * client (the booking funnel's top-level identity is the referrer's), so the
 * professional's queues showed the doctor and `payment_invitation` — whose
 * recipient resolves from `clientId` — was emailed to the doctor for the
 * patient's session. The patient must be the account; the referrer stays in
 * `referralInfo.referrer*`.
 */
import { describe, it, expect } from "vitest";
import {
  backfillReferrerContact,
  isValidEmail,
  resolveReferralPatientIdentity,
} from "./referral-patient-account";

describe("resolveReferralPatientIdentity", () => {
  it("resolves the patient — not the referrer — as the account identity", () => {
    expect(
      resolveReferralPatientIdentity({
        patientFirstName: "Laouratou",
        patientLastName: "Yebhe Barry",
        patientEmail: "laouratouyebhebarry@gmail.com",
        patientPhone: "5813978231",
      }),
    ).toEqual({
      firstName: "Laouratou",
      lastName: "Yebhe Barry",
      email: "laouratouyebhebarry@gmail.com",
      phone: "5813978231",
    });
  });

  it("trims the whitespace real referrals arrive with", () => {
    // Production rows carry values like "Laouratou " / " Kaysha ".
    expect(
      resolveReferralPatientIdentity({
        patientFirstName: "  Laouratou  ",
        patientLastName: "  Barry ",
        patientEmail: "  Patient@Example.COM  ",
      }),
    ).toEqual({
      firstName: "Laouratou",
      lastName: "Barry",
      email: "patient@example.com",
      phone: "",
    });
  });

  it("lower-cases the email (it is the account's unique key)", () => {
    expect(
      resolveReferralPatientIdentity({
        patientFirstName: "A",
        patientLastName: "B",
        patientEmail: "MiXeD@Case.Ca",
      })?.email,
    ).toBe("mixed@case.ca");
  });

  it("returns null without a usable email — nothing to register or notify", () => {
    const base = { patientFirstName: "A", patientLastName: "B" };
    expect(resolveReferralPatientIdentity(base)).toBeNull();
    expect(
      resolveReferralPatientIdentity({ ...base, patientEmail: "" }),
    ).toBeNull();
    expect(
      resolveReferralPatientIdentity({ ...base, patientEmail: "   " }),
    ).toBeNull();
    expect(
      resolveReferralPatientIdentity({ ...base, patientEmail: "not-an-email" }),
    ).toBeNull();
  });

  it("returns null without a full name", () => {
    const email = "patient@example.com";
    expect(
      resolveReferralPatientIdentity({ patientFirstName: "A", patientEmail: email }),
    ).toBeNull();
    expect(
      resolveReferralPatientIdentity({ patientLastName: "B", patientEmail: email }),
    ).toBeNull();
    expect(resolveReferralPatientIdentity(null)).toBeNull();
    expect(resolveReferralPatientIdentity(undefined)).toBeNull();
  });

  it("never reads the referrer's fields", () => {
    const identity = resolveReferralPatientIdentity({
      patientFirstName: "Laouratou",
      patientLastName: "Barry",
      patientEmail: "patient@example.com",
      // Referrer fields live on the same subdocument — they must be ignored.
      ...({
        referrerName: "Kaysha Constantin",
        referrerEmail: "kaysha.constantin@santefedehealth.com",
        referrerPhone: "8195957775",
      } as Record<string, string>),
    });
    expect(identity?.email).toBe("patient@example.com");
    expect(JSON.stringify(identity)).not.toContain("kaysha");
    expect(JSON.stringify(identity)).not.toContain("8195957775");
  });
});

describe("backfillReferrerContact", () => {
  it("keeps the referrer reachable when the form left their fields blank", () => {
    const referralInfo = { referrerName: "Dr X", referrerEmail: "", referrerPhone: "" };
    backfillReferrerContact(referralInfo, {
      email: "Doctor@Clinic.CA",
      phone: "8195957775",
    });
    expect(referralInfo.referrerEmail).toBe("doctor@clinic.ca");
    expect(referralInfo.referrerPhone).toBe("8195957775");
  });

  it("never overwrites contact details the referrer actually entered", () => {
    const referralInfo = {
      referrerEmail: "typed@clinic.ca",
      referrerPhone: "5145889917",
    };
    backfillReferrerContact(referralInfo, {
      email: "session@example.com",
      phone: "0000000000",
    });
    expect(referralInfo.referrerEmail).toBe("typed@clinic.ca");
    expect(referralInfo.referrerPhone).toBe("5145889917");
  });

  it("leaves blanks alone when there is no fallback to use", () => {
    const referralInfo = { referrerEmail: "", referrerPhone: "" };
    backfillReferrerContact(referralInfo, { email: null, phone: undefined });
    expect(referralInfo.referrerEmail).toBe("");
    expect(referralInfo.referrerPhone).toBe("");
  });
});

describe("isValidEmail", () => {
  it.each(["a@b.ca", "laouratouyebhebarry@gmail.com", " padded@x.com "])(
    "accepts %s",
    (v) => expect(isValidEmail(v)).toBe(true),
  );

  it.each(["", "   ", "no-at-sign", "a@b", "a b@c.ca", null, undefined])(
    "rejects %s",
    (v) => expect(isValidEmail(v)).toBe(false),
  );
});

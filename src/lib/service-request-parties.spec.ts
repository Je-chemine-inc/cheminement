/**
 * Regression: admin queues showed the REFERRING DOCTOR in the "Client" column
 * for professional referrals, with no way to reach the referred patient — the
 * account on the appointment belongs to the referrer, and the patient's details
 * sat unread in referralInfo.
 */
import { describe, it, expect } from "vitest";
import { resolveServiceRequestParties } from "./service-request-parties";

const doctorAccount = {
  firstName: "Sassi",
  lastName: "Psychologue",
  email: "sassiessid1@gmail.com",
  phone: "+15145550101",
};

const referral = {
  referrerType: "doctor",
  referrerName: "Dr Sassi Essid",
  referrerLicense: "OPQ-12345",
  referrerEmail: "dr.sassi@clinique.ca",
  referrerPhone: "+15145550199",
  patientFirstName: "Marie",
  patientLastName: "Tremblay",
  patientEmail: "marie.tremblay@example.com",
  patientPhone: "+15145550123",
};

describe("professional referral (bookingFor: patient)", () => {
  it("shows the PATIENT as the client, not the referring doctor", () => {
    const p = resolveServiceRequestParties({
      bookingFor: "patient",
      referralInfo: referral,
      account: doctorAccount,
    });

    // KEY: this is the whole bug — the doctor used to appear here.
    expect(p.clientName).toBe("Marie Tremblay");
    expect(p.clientEmail).toBe("marie.tremblay@example.com");
    expect(p.clientPhone).toBe("+15145550123");
    expect(p.isReferredPatient).toBe(true);
  });

  it("still surfaces the referrer so the admin can contact them", () => {
    const p = resolveServiceRequestParties({
      bookingFor: "patient",
      referralInfo: referral,
      account: doctorAccount,
    });

    expect(p.referrer).toEqual({
      name: "Dr Sassi Essid",
      type: "doctor",
      license: "OPQ-12345",
      email: "dr.sassi@clinique.ca",
      phone: "+15145550199",
    });
  });

  it("never borrows the account's contact for the referrer", () => {
    // A referral now registers the PATIENT as the account, so the old fallback
    // would print the patient's own address as their referring doctor's.
    const p = resolveServiceRequestParties({
      bookingFor: "patient",
      referralInfo: { ...referral, referrerEmail: null, referrerPhone: null },
      account: doctorAccount,
    });

    expect(p.referrer?.name).toBe("Dr Sassi Essid");
    expect(p.referrer?.email).toBeNull();
    expect(p.referrer?.phone).toBeNull();
  });

  it("flags a missing patient email — the form makes it optional", () => {
    const p = resolveServiceRequestParties({
      bookingFor: "patient",
      referralInfo: { ...referral, patientEmail: "   " },
      account: doctorAccount,
    });

    expect(p.clientName).toBe("Marie Tremblay");
    expect(p.clientEmail).toBeNull();
    // The UI must say "reach them via the referrer", not show a bare dash.
    expect(p.patientEmailMissing).toBe(true);
    expect(p.referrer?.email).toBe("dr.sassi@clinique.ca");
  });

  it("handles a patient with only a first name", () => {
    const p = resolveServiceRequestParties({
      bookingFor: "patient",
      referralInfo: { ...referral, patientLastName: null },
      account: doctorAccount,
    });

    expect(p.clientName).toBe("Marie");
    expect(p.isReferredPatient).toBe(true);
  });

  it("falls back to the account when the referral carries no patient name at all", () => {
    // Legacy rows predating the required-patient-name validation.
    const p = resolveServiceRequestParties({
      bookingFor: "patient",
      referralInfo: { referrerName: "Dr Sassi Essid" },
      account: doctorAccount,
    });

    expect(p.clientName).toBe("Sassi Psychologue");
    expect(p.isReferredPatient).toBe(false);
    // The referrer is still surfaced.
    expect(p.referrer?.name).toBe("Dr Sassi Essid");
  });
});

describe("non-referral bookings are unchanged", () => {
  it.each(["self", "loved-one", null, undefined])(
    "bookingFor %s shows the account holder",
    (bookingFor) => {
      const p = resolveServiceRequestParties({
        bookingFor,
        referralInfo: null,
        account: {
          firstName: "Chantal",
          lastName: "Hache",
          email: "chantal@example.com",
          phone: "+15145550777",
        },
      });

      expect(p.clientName).toBe("Chantal Hache");
      expect(p.clientEmail).toBe("chantal@example.com");
      expect(p.referrer).toBeNull();
      expect(p.isReferredPatient).toBe(false);
    },
  );

  it("does not treat a self-booking as a referral even if referralInfo lingers", () => {
    const p = resolveServiceRequestParties({
      bookingFor: "self",
      referralInfo: referral,
      account: doctorAccount,
    });

    expect(p.clientName).toBe("Sassi Psychologue");
    expect(p.isReferredPatient).toBe(false);
  });
});

describe("degenerate input", () => {
  it("returns a dash rather than throwing when there is no account", () => {
    const p = resolveServiceRequestParties({});
    expect(p.clientName).toBe("—");
    expect(p.clientEmail).toBeNull();
    expect(p.referrer).toBeNull();
  });

  it("treats whitespace-only names as absent", () => {
    const p = resolveServiceRequestParties({
      account: { firstName: "  ", lastName: "  ", email: " " },
    });
    expect(p.clientName).toBe("—");
    expect(p.clientEmail).toBeNull();
  });
});

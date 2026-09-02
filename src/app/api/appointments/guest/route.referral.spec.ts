/**
 * Guest booking — patient referrals.
 *
 * Regression: a doctor's referral registered the DOCTOR as the appointment's
 * client, because the funnel's top-level guest identity belongs to the referrer.
 * Production consequence: the professional's queues showed the doctor in the
 * "Client" column, and `payment_invitation` — whose recipient resolves from
 * `clientId` — was emailed to the doctor for the patient's session.
 *
 * These pin the corrected contract:
 *   - the patient's email is REQUIRED (it is the account key AND the only way to
 *     reach the patient rather than the referrer);
 *   - `clientId` is the PATIENT's account, never the referrer's;
 *   - the referrer survives in `referralInfo.referrer*`, backfilled from the
 *     guest fields so they stay reachable once they are no longer the account;
 *   - the admin alert and the acknowledgement name the patient;
 *   - a non-referral booking is untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PATIENT_ID = "1111111111111111111111a1";
const REFERRER_ID = "2222222222222222222222b2";
const APPT_ID = "3333333333333333333333c3";

const h = vi.hoisted(() => ({
  userFindOne: vi.fn(),
  userSave: vi.fn(),
  savedUsers: [] as Record<string, unknown>[],
  appointmentSave: vi.fn(),
  savedAppointments: [] as Record<string, unknown>[],
  findUserByStrongKey: vi.fn(),
  adminAlert: vi.fn(),
  referralConfirmation: vi.fn(),
  onboarding: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  // Run the deferred email work inline so the spec can assert on it.
  after: (fn: () => unknown) => {
    void fn();
  },
}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi.fn().mockResolvedValue({
    sessionPrice: 175,
    platformFee: 25,
    professionalPayout: 150,
  }),
}));
vi.mock("@/lib/motifs", () => ({
  getValidMotifLabels: vi.fn().mockResolvedValue(new Set(["Anxiété"])),
}));
vi.mock("@/lib/appointment-routing", () => ({
  routeAppointmentToProfessionals: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications", () => ({
  sendProfessionalNotification: vi.fn().mockResolvedValue(true),
  sendServiceRequestOnboardingEmail: (...a: unknown[]) => h.onboarding(...a),
  sendReferralConfirmationEmail: (...a: unknown[]) => h.referralConfirmation(...a),
  sendAdminNewServiceRequestAlert: (...a: unknown[]) => h.adminAlert(...a),
}));
vi.mock("@/lib/account-dedup", () => ({
  findUserByStrongKey: (...a: unknown[]) => h.findUserByStrongKey(...a),
}));
vi.mock("@/models/Profile", () => ({ default: { findOne: vi.fn() } }));

vi.mock("@/models/User", () => {
  class MockUser {
    _id = PATIENT_ID;
    constructor(doc: Record<string, unknown>) {
      Object.assign(this, doc);
      h.savedUsers.push(doc);
    }
    save() {
      return h.userSave();
    }
    static findOne = (...a: unknown[]) => h.userFindOne(...a);
  }
  return { default: MockUser };
});

vi.mock("@/models/Appointment", () => {
  class MockAppointment {
    _id = { toString: () => APPT_ID };
    constructor(doc: Record<string, unknown>) {
      Object.assign(this, doc);
      h.savedAppointments.push(doc);
    }
    save() {
      return h.appointmentSave();
    }
    static findOne = vi.fn().mockResolvedValue(null);
    static findById = () => ({
      populate: () => ({
        populate: () => Promise.resolve({ _id: APPT_ID, professionalId: null }),
      }),
    });
  }
  return { default: MockAppointment };
});

import { POST } from "@/app/api/appointments/guest/route";

type Res = Promise<{ status: number; body: unknown }>;

const call = (body: unknown): Res =>
  POST({ json: async () => body } as never) as unknown as Res;

/** The referring doctor is who fills the funnel's top-level identity fields. */
const REFERRER_GUEST = {
  firstName: "Kaysha",
  lastName: "Constantin",
  email: "kaysha.constantin@clinic.example",
  phone: "8195957775",
  location: "Gatineau",
};

const referralBody = (referralOverrides: Record<string, unknown> = {}) => ({
  guestInfo: { ...REFERRER_GUEST },
  notificationLocale: "fr",
  bookingFor: "patient",
  type: "video",
  therapyType: "solo",
  needs: ["Anxiété"],
  referralInfo: {
    referrerType: "doctor",
    referrerName: "Dre Kaysha Constantin",
    patientFirstName: "Laouratou",
    patientLastName: "Barry",
    patientEmail: "laouratou.barry@example.com",
    patientPhone: "5813978231",
    ...referralOverrides,
  },
});

const lastAppointment = () =>
  h.savedAppointments[h.savedAppointments.length - 1] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  h.savedUsers.length = 0;
  h.savedAppointments.length = 0;
  h.userSave.mockResolvedValue(undefined);
  h.appointmentSave.mockResolvedValue(undefined);
  h.userFindOne.mockResolvedValue(null);
  h.findUserByStrongKey.mockResolvedValue(null);
  h.adminAlert.mockResolvedValue(true);
  h.referralConfirmation.mockResolvedValue(true);
  h.onboarding.mockResolvedValue(true);
});

describe("POST /api/appointments/guest — patient referral", () => {
  it("registers the PATIENT as the client, never the referring doctor", async () => {
    const res = await call(referralBody());

    expect(res.status).toBe(201);
    // The account created carries the patient's identity...
    expect(h.savedUsers).toHaveLength(1);
    expect(h.savedUsers[0]).toMatchObject({
      email: "laouratou.barry@example.com",
      firstName: "Laouratou",
      lastName: "Barry",
      role: "prospect",
    });
    // ...and never the referrer's.
    expect(h.savedUsers[0].email).not.toBe(REFERRER_GUEST.email);
    expect(lastAppointment().clientId).toBe(PATIENT_ID);
  });

  it("reuses an existing account for the patient instead of duplicating", async () => {
    h.findUserByStrongKey.mockResolvedValue({
      user: {
        _id: "existing-patient",
        email: "laouratou.barry@example.com",
        role: "client",
        password: "hashed",
        save: h.userSave,
      },
      key: "email",
    });

    await call(referralBody());

    expect(h.savedUsers).toHaveLength(0);
    expect(lastAppointment().clientId).toBe("existing-patient");
  });

  it("never overwrites a REAL account's profile from a referral", async () => {
    const real = {
      _id: "member",
      email: "laouratou.barry@example.com",
      firstName: "Do",
      lastName: "NotTouch",
      role: "client",
      password: "hashed",
      save: h.userSave,
    };
    h.findUserByStrongKey.mockResolvedValue({ user: real, key: "email" });

    await call(referralBody());

    expect(real.firstName).toBe("Do");
    expect(real.lastName).toBe("NotTouch");
    expect(h.userSave).not.toHaveBeenCalled();
  });

  it("keeps the referrer reachable on referralInfo once they are not the account", async () => {
    await call(referralBody());

    const referral = lastAppointment().referralInfo as Record<string, string>;
    expect(referral.referrerName).toBe("Dre Kaysha Constantin");
    expect(referral.referrerEmail).toBe(REFERRER_GUEST.email.toLowerCase());
    expect(referral.referrerPhone).toBe(REFERRER_GUEST.phone);
  });

  it("does not overwrite a referrer email the form already supplied", async () => {
    await call(referralBody({ referrerEmail: "typed@clinic.example" }));

    const referral = lastAppointment().referralInfo as Record<string, string>;
    expect(referral.referrerEmail).toBe("typed@clinic.example");
  });

  it("acknowledges the PATIENT, and names the patient in the admin alert", async () => {
    await call(referralBody());

    expect(h.referralConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "laouratou.barry@example.com",
        toName: "Laouratou Barry",
        referrerName: "Dre Kaysha Constantin",
      }),
    );
    expect(h.adminAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "Laouratou Barry",
        clientEmail: "laouratou.barry@example.com",
      }),
    );
  });

  it("rejects a referral with no patient email — nothing could reach the patient", async () => {
    const res = await call(referralBody({ patientEmail: "" }));

    expect(res.status).toBe(400);
    expect(h.savedAppointments).toHaveLength(0);
    expect(h.savedUsers).toHaveLength(0);
  });

  it("rejects a malformed patient email", async () => {
    const res = await call(referralBody({ patientEmail: "not-an-email" }));

    expect(res.status).toBe(400);
    expect(h.savedAppointments).toHaveLength(0);
  });

  it("still requires the patient's full name", async () => {
    const res = await call(referralBody({ patientLastName: "  " }));

    expect(res.status).toBe(400);
    expect(h.savedAppointments).toHaveLength(0);
  });
});

describe("POST /api/appointments/guest — non-referral bookings are untouched", () => {
  it("a self-booking still registers the requester as the client", async () => {
    const res = await call({
      guestInfo: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "5145551234",
        location: "Montréal",
      },
      notificationLocale: "fr",
      bookingFor: "self",
      type: "video",
      therapyType: "solo",
      needs: ["Anxiété"],
    });

    expect(res.status).toBe(201);
    expect(h.savedUsers[0]).toMatchObject({
      email: "ada@example.com",
      firstName: "Ada",
    });
    // The referral path must not have been consulted at all.
    expect(h.findUserByStrongKey).not.toHaveBeenCalled();
    expect(h.onboarding).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "ada@example.com" }),
    );
  });
});

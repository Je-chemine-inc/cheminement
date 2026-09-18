import { describe, it, expect } from "vitest";
import {
  PROFILE_ADMIN_WRITABLE,
  PROFILE_SELF_WRITABLE,
  availabilityConfirmationFor,
  pickWritable,
} from "./profile-writable-fields";

describe("availabilityConfirmationFor", () => {
  const now = new Date("2026-09-18T15:00:00Z");
  const hours = { availability: { days: [{ day: "Monday", isWorkDay: true, startTime: "09:00", endTime: "12:00" }] } };

  it("confirms the hours a professional saves from their own schedule editor", () => {
    expect(availabilityConfirmationFor({ confirm: true, update: hours, role: "professional", now })).toBe(now);
  });

  it("never confirms without the editor saying so — a signup or any other save leaves it unset", () => {
    expect(availabilityConfirmationFor({ confirm: undefined, update: hours, role: "professional", now })).toBeNull();
    expect(availabilityConfirmationFor({ confirm: "true", update: hours, role: "professional", now })).toBeNull();
  });

  it("never confirms for anyone but the professional themselves", () => {
    for (const role of ["admin", "client", "employee", undefined]) {
      expect(availabilityConfirmationFor({ confirm: true, update: hours, role, now })).toBeNull();
    }
  });

  it("never confirms a save that carries no hours", () => {
    expect(availabilityConfirmationFor({ confirm: true, update: { bio: "x" }, role: "professional", now })).toBeNull();
    expect(availabilityConfirmationFor({ confirm: true, update: { availability: { days: "x" } }, role: "professional", now })).toBeNull();
  });

  it("is not something a professional can write themselves", () => {
    expect(PROFILE_SELF_WRITABLE as readonly string[]).not.toContain("availabilityConfirmedAt");
    expect(pickWritable({ availabilityConfirmedAt: "2020-01-01" }, PROFILE_SELF_WRITABLE)).toEqual({});
  });
});

describe("pickWritable", () => {
  it("keeps allowlisted keys", () => {
    const out = pickWritable(
      { bio: "hello", specialty: "psychologue" },
      PROFILE_SELF_WRITABLE,
    );
    expect(out).toEqual({ bio: "hello", specialty: "psychologue" });
  });

  it("drops keys that are not allowlisted", () => {
    const out = pickWritable(
      { bio: "hello", somethingInvented: true },
      PROFILE_SELF_WRITABLE,
    );
    expect(out).toEqual({ bio: "hello" });
    expect(out).not.toHaveProperty("somethingInvented");
  });

  it("omits absent keys rather than writing undefined", () => {
    // Writing an explicit `undefined` into a mongoose update unsets the stored
    // value — an absent field must stay absent.
    const out = pickWritable({ bio: "hello" }, PROFILE_SELF_WRITABLE);
    expect(Object.prototype.hasOwnProperty.call(out, "specialty")).toBe(false);
  });

  it("keeps an explicit null or empty string (clearing a field is legitimate)", () => {
    const out = pickWritable(
      { bio: "", specialty: null },
      PROFILE_SELF_WRITABLE,
    );
    expect(out).toEqual({ bio: "", specialty: null });
  });

  it("returns an empty object for non-object input", () => {
    expect(pickWritable(null, PROFILE_SELF_WRITABLE)).toEqual({});
    expect(pickWritable(undefined, PROFILE_SELF_WRITABLE)).toEqual({});
    expect(pickWritable("nope", PROFILE_SELF_WRITABLE)).toEqual({});
    expect(pickWritable(42, PROFILE_SELF_WRITABLE)).toEqual({});
  });

  it("does not inherit allowlisted keys from the prototype chain", () => {
    const proto = { bio: "from-prototype" };
    const payload = Object.create(proto) as Record<string, unknown>;
    payload.specialty = "own";

    const out = pickWritable(payload, PROFILE_SELF_WRITABLE);

    expect(out).toEqual({ specialty: "own" });
    expect(out).not.toHaveProperty("bio");
  });
});

describe("PROFILE_SELF_WRITABLE — fields a professional must NOT be able to forge", () => {
  // Each of these was writable before the allowlist landed. They are owned by
  // the route or by an admin, never by client input.
  it.each([
    // Re-pointing the profile at another account.
    "userId",
    // Derived by the route from terms acceptance.
    "profileCompleted",
    // Stamped by the route from LEGAL_VERSIONS, not the body.
    "professionalTermsAcceptedAt",
    "professionalTermsVersion",
    // Server-generated secret for the read-only iCal feed.
    "calendarFeedToken",
  ])("%s is not self-writable", (field) => {
    expect(PROFILE_SELF_WRITABLE).not.toContain(field);
  });

  it("drops all of them from a hostile payload at once", () => {
    const hostile = {
      bio: "legitimate change",
      userId: "000000000000000000000000",
      profileCompleted: true,
      professionalTermsAcceptedAt: new Date(0),
      professionalTermsVersion: "forged",
      calendarFeedToken: "stolen-token",
    };

    const out = pickWritable(hostile, PROFILE_SELF_WRITABLE);

    expect(out).toEqual({ bio: "legitimate change" });
  });

  it.each(["pricing", "rates"])(
    "%s is not self-writable — pricing is admin-controlled",
    (field) => {
      expect(PROFILE_SELF_WRITABLE).not.toContain(field);
    },
  );

  it("drops a professional's attempt to set their own rate", () => {
    // Without this the admin pricing editor would be decorative: a professional
    // could raise their own payout with a crafted PUT /api/profile, bypassing
    // PATCH /api/admin/professionals/[id]/pricing entirely.
    const out = pickWritable(
      {
        bio: "legitimate change",
        pricing: { individualSession: 300 },
        rates: { solo: { professionalRate: 300, clientPrice: 300 } },
      },
      PROFILE_SELF_WRITABLE,
    );

    expect(out).toEqual({ bio: "legitimate change" });
  });
});

describe("PROFILE_ADMIN_WRITABLE — what an admin saves from a professional's file", () => {
  it.each(["officeAddress", "officeNotes"])(
    "%s is saved — the profile form sends it (dropped behind a success message until 2026-09-18)",
    (field) => {
      expect(PROFILE_ADMIN_WRITABLE).toContain(field);
    },
  );

  it.each([
    // Re-pointing the profile at another account.
    "userId",
    // Server-generated secret for the read-only iCal feed.
    "calendarFeedToken",
    // The professional's own acceptance, stamped by PUT /api/profile.
    "professionalTermsAcceptedAt",
    "professionalTermsVersion",
    // Only the professional's own save confirms hours (spec 003 phase 3b).
    "availabilityConfirmedAt",
    // Owned by the admin pricing editor, PATCH /api/admin/professionals/[id]/pricing.
    "rates",
  ])("%s is not written through the professional's file", (field) => {
    expect(PROFILE_ADMIN_WRITABLE as readonly string[]).not.toContain(field);
  });
});

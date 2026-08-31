import { describe, it, expect } from "vitest";
import {
  PROFILE_SELF_WRITABLE,
  pickWritable,
} from "./profile-writable-fields";

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

  it("still allows pricing today (spec 001 step 6 removes it)", () => {
    // Guards the behaviour-preserving promise of this change: the allowlist
    // must not silently alter what a professional can legitimately set today.
    const out = pickWritable(
      { pricing: { individualSession: 160 } },
      PROFILE_SELF_WRITABLE,
    );
    expect(out).toEqual({ pricing: { individualSession: 160 } });
  });
});

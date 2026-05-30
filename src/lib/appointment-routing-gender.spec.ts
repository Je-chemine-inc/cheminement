/**
 * Section 3: matching must consider the client's gender preference (the
 * dimension that was missing — availability/problématiques/expertise/age were
 * already handled). Soft signal: a bonus when the pro's gender matches, never a
 * hard filter, and "female" must never satisfy a "male" preference.
 */
import { describe, it, expect } from "vitest";
import {
  professionalMatchesGenderPreference,
  calculateRelevancyScore,
  filterProfessionalsByGenderPreference,
} from "@/lib/appointment-routing";

describe("professionalMatchesGenderPreference", () => {
  it("matches FR + EN spellings", () => {
    expect(professionalMatchesGenderPreference("Femme", "female")).toBe(true);
    expect(professionalMatchesGenderPreference("female", "female")).toBe(true);
    expect(professionalMatchesGenderPreference("Homme", "male")).toBe(true);
    expect(professionalMatchesGenderPreference("Male", "male")).toBe(true);
    expect(professionalMatchesGenderPreference("Autre", "other")).toBe(true);
  });

  it("does NOT let 'female' satisfy a 'male' preference (substring trap)", () => {
    expect(professionalMatchesGenderPreference("female", "male")).toBe(false);
    expect(professionalMatchesGenderPreference("Femme", "male")).toBe(false);
  });

  it("returns false for noPreference / empty / unknown", () => {
    expect(professionalMatchesGenderPreference("female", "noPreference")).toBe(
      false,
    );
    expect(professionalMatchesGenderPreference(undefined, "female")).toBe(false);
    expect(professionalMatchesGenderPreference("female", undefined)).toBe(false);
  });
});

describe("calculateRelevancyScore — gender preference", () => {
  const baseProfile = {};
  const baseAppt = { type: "video", therapyType: "solo" };

  it("adds a bonus + reason when the pro's gender matches the preference", () => {
    const r = calculateRelevancyScore(
      baseProfile,
      baseAppt,
      { preferredGender: "female" },
      "Femme",
    );
    expect(r.score).toBeGreaterThanOrEqual(12);
    expect(r.reasons.join(" ")).toMatch(/[Gg]enre/);
  });

  it("adds no gender bonus when the pro's gender does not match", () => {
    const r = calculateRelevancyScore(
      baseProfile,
      baseAppt,
      { preferredGender: "female" },
      "Homme",
    );
    expect(r.reasons.join(" ")).not.toMatch(/Genre du professionnel/);
  });

  it("adds no gender bonus for noPreference", () => {
    const r = calculateRelevancyScore(
      baseProfile,
      baseAppt,
      { preferredGender: "noPreference" },
      "Femme",
    );
    expect(r.reasons.join(" ")).not.toMatch(/Genre du professionnel/);
  });
});

describe("filterProfessionalsByGenderPreference (HARD filter)", () => {
  const profiles = [
    { userId: "p-female" },
    { userId: "p-male" },
    { userId: "p-unknown" },
  ];
  const genderById = new Map<string, string | undefined>([
    ["p-female", "Femme"],
    ["p-male", "Homme"],
    ["p-unknown", undefined],
  ]);

  it("keeps ONLY matching-gender pros when a preference is stated", () => {
    const kept = filterProfessionalsByGenderPreference(
      profiles,
      genderById,
      "female",
    );
    expect(kept.map((p) => p.userId)).toEqual(["p-female"]);
  });

  it("lets everyone through for noPreference / empty", () => {
    expect(
      filterProfessionalsByGenderPreference(profiles, genderById, "noPreference"),
    ).toHaveLength(3);
    expect(
      filterProfessionalsByGenderPreference(profiles, genderById, undefined),
    ).toHaveLength(3);
  });

  it("returns an empty set when no pro matches (→ caller falls back to general pool)", () => {
    const onlyMale = new Map<string, string | undefined>([
      ["p-male", "Homme"],
    ]);
    expect(
      filterProfessionalsByGenderPreference(
        [{ userId: "p-male" }],
        onlyMale,
        "female",
      ),
    ).toEqual([]);
  });
});

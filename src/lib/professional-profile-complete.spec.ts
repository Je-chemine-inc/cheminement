import { describe, it, expect } from "vitest";
import { isProfessionalProfileComplete } from "./professional-profile-complete";

const full = {
  problematics: ["Anxiété"],
  approaches: ["TCC"],
  ageCategories: ["Adults (26-64)"],
  yearsOfExperience: "5",
  bio: "Psychologue depuis 10 ans.",
};

describe("isProfessionalProfileComplete", () => {
  it("is true when all required fields are present", () => {
    expect(isProfessionalProfileComplete(full)).toBe(true);
  });

  it("does NOT require optional skills (the banner-trap regression)", () => {
    // A pro who filled everything required but added no extra skill must count
    // as complete — skills is "(Facultatif)" in the form.
    expect(isProfessionalProfileComplete({ ...full, skills: [] } as never)).toBe(
      true,
    );
  });

  it("is false when a genuinely required field is missing", () => {
    expect(isProfessionalProfileComplete({ ...full, bio: "" })).toBe(false);
    expect(
      isProfessionalProfileComplete({ ...full, yearsOfExperience: "" }),
    ).toBe(false);
    expect(isProfessionalProfileComplete({ ...full, approaches: [] })).toBe(
      false,
    );
    expect(isProfessionalProfileComplete({ ...full, problematics: [] })).toBe(
      false,
    );
    expect(isProfessionalProfileComplete({ ...full, ageCategories: [] })).toBe(
      false,
    );
  });

  it("is false for a null profile", () => {
    expect(isProfessionalProfileComplete(null)).toBe(false);
  });
});

import { professionalTermsGateApplies } from "./professional-profile-complete";

describe("professionalTermsGateApplies", () => {
  const complete = {
    problematics: ["a"],
    approaches: ["b"],
    ageCategories: ["c"],
    yearsOfExperience: 5,
    bio: "x",
  };

  it("gates a pro editing their OWN complete, un-consented profile", () => {
    expect(professionalTermsGateApplies(undefined, complete)).toBe(true);
  });

  it("does NOT gate an admin editing another pro (userId set)", () => {
    expect(professionalTermsGateApplies("6a8dc1a5f79e69f86a8c9126", complete)).toBe(
      false,
    );
  });

  it("does NOT gate once terms are accepted", () => {
    expect(
      professionalTermsGateApplies(undefined, {
        ...complete,
        professionalTermsAcceptedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("does NOT gate an incomplete profile", () => {
    expect(professionalTermsGateApplies(undefined, { bio: "x" })).toBe(false);
  });
});

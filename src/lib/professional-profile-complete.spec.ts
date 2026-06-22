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

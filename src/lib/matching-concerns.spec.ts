import { describe, it, expect } from "vitest";
import { resolveMatchingConcerns } from "./matching-concerns";

describe("resolveMatchingConcerns", () => {
  it("uses Motifs de consultation when present (primary basis)", () => {
    expect(
      resolveMatchingConcerns({
        consultationMotifs: ["Anxiété", "TDAH"],
        primaryIssue: "Dépression",
        secondaryIssues: ["Stress"],
      }),
    ).toEqual(["Anxiété", "TDAH"]);
  });

  it("falls back to primaryIssues + secondaryIssues when no motifs", () => {
    expect(
      resolveMatchingConcerns({
        consultationMotifs: [],
        primaryIssues: ["Dépression", "Burnout"],
        secondaryIssues: ["Stress"],
      }),
    ).toEqual(["Dépression", "Burnout", "Stress"]);
  });

  it("falls back to the legacy single primaryIssue when no primaryIssues", () => {
    expect(
      resolveMatchingConcerns({
        primaryIssue: "Dépression",
        secondaryIssues: ["Stress"],
      }),
    ).toEqual(["Dépression", "Stress"]);
  });

  it("dedupes and drops blanks", () => {
    expect(
      resolveMatchingConcerns({
        consultationMotifs: ["Anxiété", " ", "Anxiété", "TDAH"],
      }),
    ).toEqual(["Anxiété", "TDAH"]);
  });

  it("returns [] for an empty or null profile", () => {
    expect(resolveMatchingConcerns(null)).toEqual([]);
    expect(resolveMatchingConcerns({})).toEqual([]);
  });
});

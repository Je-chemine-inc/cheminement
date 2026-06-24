import { describe, it, expect } from "vitest";
import { locationProximityScore } from "./location-match";

describe("locationProximityScore", () => {
  it("same city (recognised labels) → same_city", () => {
    expect(locationProximityScore("Terrebonne, QC", "Terrebonne, QC")).toBe(
      "same_city",
    );
  });

  it("same Quebec region, different city → same_region", () => {
    // Terrebonne & Joliette are both in Lanaudière.
    expect(locationProximityScore("Terrebonne, QC", "Joliette, QC")).toBe(
      "same_region",
    );
  });

  it("different regions → none", () => {
    // Montréal vs Québec (Capitale-Nationale).
    expect(locationProximityScore("Montréal, QC", "Québec, QC")).toBe("none");
  });

  it("free text matches an autocomplete label by city name", () => {
    expect(locationProximityScore("terrebonne", "Terrebonne, QC")).toBe(
      "same_city",
    );
  });

  it("free text, accent/case-insensitive same city", () => {
    expect(locationProximityScore("MONTREAL", "montréal")).toBe("same_city");
  });

  it("returns none when either side is empty/unknown", () => {
    expect(locationProximityScore("Montréal, QC", "")).toBe("none");
    expect(locationProximityScore(undefined, "Montréal, QC")).toBe("none");
    expect(locationProximityScore("J7K 3C2", "Montréal, QC")).toBe("none");
  });
});

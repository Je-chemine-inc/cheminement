import { describe, it, expect } from "vitest";
import { searchCities } from "./city-search";
import { findCityByLabel } from "@/data/canadaCities";

describe("searchCities", () => {
  it("finds a Quebec city from a partial, accent-insensitive query", () => {
    expect(searchCities("terreb")).toContain("Terrebonne, QC");
    expect(searchCities("montre")).toContain("Montréal, QC");
    expect(searchCities("quebe")).toContain("Québec, QC");
  });

  it("tolerates missing accents and case", () => {
    expect(searchCities("MONTREAL")).toContain("Montréal, QC");
    expect(searchCities("levis")).toContain("Lévis, QC");
  });

  it("finds major Canadian cities outside Quebec", () => {
    expect(searchCities("toron")).toContain("Toronto, ON");
    expect(searchCities("vancou")).toContain("Vancouver, BC");
  });

  it("returns nothing for an empty query and caps the result count", () => {
    expect(searchCities("")).toEqual([]);
    expect(searchCities("   ")).toEqual([]);
    expect(searchCities("saint").length).toBeLessThanOrEqual(8);
  });
});

describe("findCityByLabel", () => {
  it("resolves a label to its region for proximity matching", () => {
    expect(findCityByLabel("Terrebonne, QC")?.region).toBe("Lanaudière");
    expect(findCityByLabel("Montréal, QC")?.region).toBe("Montréal");
    expect(findCityByLabel("Toronto, ON")?.region).toBe("Ontario");
  });

  it("returns undefined for an unlisted / free-typed value", () => {
    expect(findCityByLabel("Some Tiny Village")).toBeUndefined();
    expect(findCityByLabel("J7K 3C2")).toBeUndefined();
  });
});

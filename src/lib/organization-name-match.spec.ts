import { describe, it, expect } from "vitest";
import {
  exactOrganizationMatch,
  normalizeOrganizationName,
  organizationNameSimilarity,
  similarOrganizations,
} from "@/lib/organization-name-match";

/**
 * What a client types at booking rarely matches the name on file letter for
 * letter. A missed match means a duplicate organization — and its invoices
 * split in two.
 */

const orgs = [
  { id: "1", name: "PAE Desjardins" },
  { id: "2", name: "Commission scolaire de Laval" },
  { id: "3", name: "Hydro-Québec" },
  { id: "4", name: "Banque Nationale du Canada" },
];

describe("normalizeOrganizationName", () => {
  it("ignores case, accents, punctuation and legal suffixes", () => {
    expect(normalizeOrganizationName("  PAE Desjardins, Inc. ")).toBe("pae desjardins");
    expect(normalizeOrganizationName("Hydro-Québec Ltée")).toBe("hydro quebec");
    expect(normalizeOrganizationName("Smith & Fils")).toBe("smith fils");
    expect(normalizeOrganizationName("")).toBe("");
  });
});

describe("exactOrganizationMatch", () => {
  it("finds the organization on file whatever the spelling", () => {
    expect(exactOrganizationMatch("pae desjardins inc.", orgs)?.id).toBe("1");
    expect(exactOrganizationMatch("HYDRO QUEBEC", orgs)?.id).toBe("3");
    expect(exactOrganizationMatch("HydroQuébec", orgs)?.id).toBe("3");
  });

  it("does not guess between different organizations", () => {
    expect(exactOrganizationMatch("Desjardins", orgs)).toBeUndefined();
    expect(exactOrganizationMatch("", orgs)).toBeUndefined();
  });
});

describe("similarOrganizations", () => {
  it("suggests a look-alike before a duplicate is created", () => {
    expect(similarOrganizations("Desjardins", orgs).map((o) => o.id)).toEqual(["1"]);
    expect(similarOrganizations("CS Laval", orgs).map((o) => o.id)).toEqual([]);
    expect(similarOrganizations("Commission scolaire Laval", orgs).map((o) => o.id)).toEqual(["2"]);
  });

  it("suggests nothing for a genuinely new organization", () => {
    expect(similarOrganizations("Ville de Montréal", orgs)).toEqual([]);
  });

  it("ranks the closest first and caps the list", () => {
    const many = [{ name: "PAE" }, { name: "PAE Desjardins" }, { name: "PAE Desjardins Montréal" }, { name: "PAE Desjardins Québec" }];
    const found = similarOrganizations("PAE Desjardins", many);
    expect(found[0].name).toBe("PAE Desjardins");
    expect(found).toHaveLength(3);
  });

  it("scores exact and contained names high, unrelated names at zero", () => {
    expect(organizationNameSimilarity("PAE Desjardins", "pae desjardins")).toBe(1);
    expect(organizationNameSimilarity("Desjardins", "PAE Desjardins")).toBe(0.8);
    expect(organizationNameSimilarity("Hydro-Québec", "Banque Nationale")).toBe(0);
  });
});

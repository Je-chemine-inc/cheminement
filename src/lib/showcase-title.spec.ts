import { describe, expect, it } from "vitest";
import { showcaseTitleOf } from "@/lib/showcase-title";

describe("showcaseTitleOf", () => {
  it("names a known title by key, keeps other words as a label, and drops « other professionals »", () => {
    expect(showcaseTitleOf("psychologist")).toEqual({ key: "psychologist", label: null });
    expect(showcaseTitleOf("  Art-thérapeute  ")).toEqual({ key: null, label: "Art-thérapeute" });
    expect(showcaseTitleOf("x".repeat(120)).label).toHaveLength(80);
    for (const empty of ["", "   ", null, undefined, "otherProfessionals"]) {
      expect(showcaseTitleOf(empty)).toEqual({ key: null, label: null });
    }
  });
});

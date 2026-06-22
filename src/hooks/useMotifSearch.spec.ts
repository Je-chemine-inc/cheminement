import { describe, it, expect } from "vitest";
import { buildMotifSearchRecords, smartMotifSearch } from "./useMotifSearch";

// A slice of the real problématiques catalogue (custom list → no extras).
const ITEMS = [
  "Anxiété",
  "Anxiété de performance",
  "Dépression",
  "Gestion du stress",
  "Troubles obsessifs-compulsifs",
  "Stress post-traumatique",
  "Estime/affirmation de soi",
  "Approche TCC",
];
const records = buildMotifSearchRecords(ITEMS, {});

describe("smartMotifSearch", () => {
  it("returns nothing for an empty query", () => {
    expect(smartMotifSearch(records, "")).toEqual([]);
    expect(smartMotifSearch(records, "   ")).toEqual([]);
  });

  it("matches a prefix, case + accent insensitive", () => {
    const r = smartMotifSearch(records, "anx");
    expect(r).toContain("Anxiété");
    expect(r).toContain("Anxiété de performance");
    // accent-insensitive: typing without the accent still matches.
    expect(smartMotifSearch(records, "anxiete")).toContain("Anxiété");
  });

  it("matches a substring anywhere in the label", () => {
    expect(smartMotifSearch(records, "stress")).toEqual(
      expect.arrayContaining([
        "Gestion du stress",
        "Stress post-traumatique",
      ]),
    );
  });

  it("expands acronyms/synonyms when records carry the synonym map", () => {
    // MotifSearch now builds custom-list records WITH MOTIF_SEARCH_EXTRAS, so
    // "TOC" → "Troubles obsessifs-compulsifs" even when the acronym is not a
    // substring of the French label. (With no extras this silently returned [].)
    const withExtras = buildMotifSearchRecords(ITEMS);
    expect(smartMotifSearch(withExtras, "TOC")).toContain(
      "Troubles obsessifs-compulsifs",
    );
    // "TCC" is already a substring of "Approche TCC" — works with or without extras.
    expect(smartMotifSearch(records, "TCC")).toContain("Approche TCC");
  });

  it("tolerates a typo via fuzzy matching", () => {
    expect(smartMotifSearch(records, "depresion")).toContain("Dépression");
  });
});

import { describe, it, expect } from "vitest";
import {
  VITRINE_ANCHORS,
  canShowNextDays,
  daysInView,
  formatShowcasePrice,
  groupSlotsByPeriod,
  headlinePrice,
  slotPeriod,
  initialsOf,
  vitrineSections,
} from "@/lib/showcase-vitrine";

describe("formatShowcasePrice", () => {
  it("shows whole prices without decimals and every other price with two (a product at 24,50 $ read « 24,5 $ »)", () => {
    expect(formatShowcasePrice(120, "fr-CA")).toMatch(/^120\s\$$/);
    expect(formatShowcasePrice(24.5, "fr-CA")).toMatch(/^24,50\s\$$/);
    expect(formatShowcasePrice(19.99, "fr-CA")).toMatch(/^19,99\s\$$/);
    expect(formatShowcasePrice(19.999, "fr-CA")).toMatch(/^20\s\$$/);
    expect(formatShowcasePrice(24.5, "en-CA")).toBe("$24.50");
    expect(formatShowcasePrice(45, "en-CA")).toBe("$45");
  });
});

describe("vitrineSections with articles", () => {
  it("links the articles after the products, and not without any", () => {
    expect(vitrineSections({ hasAbout: false, hasProducts: true, hasArticles: true })).toEqual([
      "approach",
      "products",
      "articles",
    ]);
    expect(vitrineSections({ hasAbout: false, hasProducts: false, hasArticles: false })).toEqual(["approach"]);
  });
});

describe("vitrineSections", () => {
  it("lists every section of a complete page in the design's order", () => {
    expect(vitrineSections({ hasAbout: true, hasProducts: true })).toEqual(["about", "approach", "products"]);
  });

  it("drops what a page has nothing for, never the approach", () => {
    expect(vitrineSections({ hasAbout: false, hasProducts: false })).toEqual(["approach"]);
  });

  it("follows the professional's order and leaves out the sections the page does not draw", () => {
    expect(vitrineSections({ hasAbout: true, hasProducts: true, order: ["products", "articles", "approach"] })).toEqual([
      "products",
      "approach",
    ]);
  });

  it("gives each section its own anchor", () => {
    expect(VITRINE_ANCHORS.about).toBe("a-propos");
    expect(new Set(Object.values(VITRINE_ANCHORS)).size).toBe(Object.values(VITRINE_ANCHORS).length);
  });
});

import { describe, it, expect } from "vitest";
import {
  VITRINE_ANCHORS,
  canShowNextDays,
  daysInView,
  focusSectionParts,
  formatShowcasePrice,
  showcaseResourceCards,
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

describe("vitrineSections with availability (spec 003 phase 3b)", () => {
  it("puts « Disponibilités » right after « À propos » and its blocks", () => {
    expect(
      vitrineSections({ hasAbout: true, hasBrief: true, hasCredentials: true, hasProducts: true, hasAvailability: true }),
    ).toEqual(["about", "brief", "credentials", "availability", "approach", "products"]);
  });

  it("follows « À propos » wherever the professional put it", () => {
    expect(
      vitrineSections({ hasAbout: true, hasProducts: false, hasAvailability: true, order: ["approach", "about"] }),
    ).toEqual(["approach", "about", "availability"]);
  });

  it("opens the page when there is no « À propos »", () => {
    expect(vitrineSections({ hasAbout: false, hasProducts: false, hasAvailability: true })).toEqual([
      "availability",
      "approach",
    ]);
  });

  it("is never listed without real hours, and cannot be hidden or reordered away", () => {
    expect(vitrineSections({ hasAbout: true, hasProducts: false })).not.toContain("availability");
    expect(vitrineSections({ hasAbout: true, hasProducts: false, hasAvailability: true, order: ["about"] })).toContain(
      "availability",
    );
  });

  it("anchors on the address the booking funnel already sends people back to", () => {
    expect(VITRINE_ANCHORS.availability).toBe("disponibilites");
  });
});

describe("focusSectionParts (« Ce que j'accompagne »)", () => {
  it("shows the themes of a page that has no card of its own", () => {
    expect(focusSectionParts({ focusAreas: 0, themes: 5 })).toEqual({ show: true, cards: false, themes: true });
  });

  it("shows the cards alone, and both when there are both", () => {
    expect(focusSectionParts({ focusAreas: 2, themes: 0 })).toEqual({ show: true, cards: true, themes: false });
    expect(focusSectionParts({ focusAreas: 2, themes: 5 })).toEqual({ show: true, cards: true, themes: true });
  });

  it("is not there with neither", () => {
    expect(focusSectionParts({ focusAreas: 0, themes: 0 })).toEqual({ show: false, cards: false, themes: false });
  });
});

describe("showcaseResourceCards (« Ressources »)", () => {
  it("lists the professional's own, then the team's in the team's order", () => {
    expect(showcaseResourceCards({ own: ["guide", "webinaire"], team: ["respirer", "dormir"], hidden: false })).toEqual([
      "guide",
      "webinaire",
      "respirer",
      "dormir",
    ]);
  });

  it("keeps the team's when the professional hid the section, and only theirs", () => {
    expect(showcaseResourceCards({ own: ["guide"], team: ["respirer"], hidden: true })).toEqual(["respirer"]);
    expect(showcaseResourceCards({ own: ["guide"], team: [], hidden: true })).toEqual([]);
  });
});

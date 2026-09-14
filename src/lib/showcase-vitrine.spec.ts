import { describe, it, expect } from "vitest";
import {
  VITRINE_ANCHORS,
  canShowNextDays,
  daysInView,
  headlinePrice,
  initialsOf,
  vitrineSections,
} from "@/lib/showcase-vitrine";

describe("vitrineSections", () => {
  it("lists every section of a complete, bookable page in the design's order", () => {
    expect(vitrineSections({ hasAbout: true, showSlots: true, hasProducts: true })).toEqual([
      "about",
      "approach",
      "services",
      "slots",
      "products",
      "faq",
    ]);
  });

  it("drops what a page has nothing for, never the approach, prices or questions", () => {
    expect(vitrineSections({ hasAbout: false, showSlots: false, hasProducts: false })).toEqual(["approach", "services", "faq"]);
  });

  it("keeps the anchors the booking links and the waitlist already use", () => {
    expect(VITRINE_ANCHORS.slots).toBe("disponibilites");
    expect(VITRINE_ANCHORS.waitlist).toBe("liste-attente");
    expect(new Set(Object.values(VITRINE_ANCHORS)).size).toBe(Object.values(VITRINE_ANCHORS).length);
  });
});

describe("headlinePrice", () => {
  it("shows the individual session's price, else the lowest, else nothing", () => {
    expect(headlinePrice([{ therapyType: "couple", price: 150 }, { therapyType: "solo", price: 120 }])).toBe(120);
    expect(headlinePrice([{ therapyType: "couple", price: 150 }, { therapyType: "group", price: 80 }])).toBe(80);
    expect(headlinePrice([])).toBeNull();
  });
});

describe("initialsOf", () => {
  it("takes up to two initials", () => {
    expect(initialsOf("Amel Sassi")).toBe("AS");
    expect(initialsOf("  élise  marie  côté ")).toBe("ÉM");
    expect(initialsOf("")).toBe("");
  });
});

describe("the booking panel's days", () => {
  const days = ["d1", "d2", "d3", "d4", "d5", "d6", "d7"];

  it("shows five days at a time from the first shown", () => {
    expect(daysInView(days, 0)).toEqual(["d1", "d2", "d3", "d4", "d5"]);
    expect(daysInView(days, 5)).toEqual(["d6", "d7"]);
    expect(daysInView(days, -3)).toEqual(["d1", "d2", "d3", "d4", "d5"]);
  });

  it("moves forward while days are loaded or more can be fetched", () => {
    expect(canShowNextDays(0, 7, false)).toBe(true);
    expect(canShowNextDays(5, 7, false)).toBe(false);
    expect(canShowNextDays(5, 7, true)).toBe(true);
    expect(canShowNextDays(0, 5, false)).toBe(false);
  });
});

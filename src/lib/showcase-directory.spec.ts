import { describe, expect, it } from "vitest";
import {
  NO_DIRECTORY_FILTERS,
  matchesDirectoryFilters,
  nextSlotLabels,
  type DirectoryEntry,
  type DirectoryFilters,
} from "@/lib/showcase-directory";

const sassi: DirectoryEntry = {
  displayName: "Amel Sassi",
  title: "Psychologue",
  expertises: ["Anxiété", "Épuisement professionnel"],
  modalities: ["inPerson", "video"],
  offersQuick: false,
};
const cote: DirectoryEntry = {
  displayName: "Julie Côté",
  title: "Psychothérapeute",
  expertises: ["Deuil"],
  modalities: ["video"],
  offersQuick: true,
};
const keep = (filters: Partial<DirectoryFilters>) =>
  [sassi, cote]
    .filter((entry) => matchesDirectoryFilters(entry, { ...NO_DIRECTORY_FILTERS, ...filters }))
    .map((entry) => entry.displayName);

describe("matchesDirectoryFilters", () => {
  it("keeps everyone without a search or a filter", () => {
    expect(keep({})).toEqual(["Amel Sassi", "Julie Côté"]);
    expect(keep({ query: "   " })).toEqual(["Amel Sassi", "Julie Côté"]);
  });

  it("finds every word in the name, the title or an expertise, whatever the accents or case", () => {
    expect(keep({ query: "anxiete" })).toEqual(["Amel Sassi"]);
    expect(keep({ query: "  COTE  " })).toEqual(["Julie Côté"]);
    expect(keep({ query: "psycho epuisement" })).toEqual(["Amel Sassi"]);
    expect(keep({ query: "psych" })).toEqual(["Amel Sassi", "Julie Côté"]);
    expect(keep({ query: "zzz" })).toEqual([]);
  });

  it("narrows with each chip", () => {
    expect(keep({ inPerson: true })).toEqual(["Amel Sassi"]);
    expect(keep({ video: true })).toEqual(["Amel Sassi", "Julie Côté"]);
    expect(keep({ quick: true })).toEqual(["Julie Côté"]);
    expect(keep({ inPerson: true, quick: true })).toEqual([]);
    expect(keep({ video: true, query: "deuil" })).toEqual(["Julie Côté"]);
  });
});

describe("nextSlotLabels", () => {
  // 21, 22 and 23 September 2026: a Monday, a Tuesday and a Wednesday.
  const days = [
    { day: "2026-09-21", slots: ["10:00", "11:00"] },
    { day: "2026-09-22", slots: ["13:30"] },
    { day: "2026-09-23", slots: ["09:00"] },
  ];

  it("shows the first time of each of the first days, in French", () => {
    expect(nextSlotLabels(days, "fr")).toEqual(["Lun. 10 h", "Mar. 13 h 30"]);
    expect(nextSlotLabels(days, "fr", 3)).toEqual(["Lun. 10 h", "Mar. 13 h 30", "Mer. 9 h"]);
  });

  it("reads in English, and skips a day it cannot read or without a time", () => {
    const labels = nextSlotLabels([{ day: "not-a-day", slots: ["10:00"] }, { day: "2026-09-24", slots: [] }, ...days], "en");
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/^Mon\.? 10:00/);
    expect(labels[1]).toMatch(/^Tue\.? 1:30/);
  });

  it("shows nothing without free times", () => {
    expect(nextSlotLabels([], "fr")).toEqual([]);
    expect(nextSlotLabels([{ day: "2026-09-21", slots: ["9h"] }], "fr")).toEqual([]);
  });
});

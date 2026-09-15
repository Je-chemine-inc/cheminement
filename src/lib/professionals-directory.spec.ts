/**
 * « Nos professionnels »: who is listed, what text and photo they get, when « Lire plus » links to
 * their page, and what the team's hiding and order do. Pure.
 */
import { describe, it, expect } from "vitest";
import {
  DIRECTORY_CURATION_MAX_IDS,
  DIRECTORY_PROFESSIONAL_KEYS,
  DIRECTORY_SUMMARY_MAX,
  buildProfessionalsDirectory,
  buildProfessionalsDirectoryAdminRows,
  degreeOf,
  isTitlesOnly,
  parseDirectoryCuration,
  shortenSummary,
  type DirectoryPageSource,
  type DirectoryProfileSource,
  type DirectoryUserSource,
} from "@/lib/professionals-directory";

const A = "0123456789abcdef0123aaaa";
const B = "0123456789abcdef0123bbbb";
const C = "0123456789abcdef0123cccc";
const PHOTO = "0123456789abcdef0123ffff";

const users: DirectoryUserSource[] = [
  { _id: A, firstName: "Leanna", lastName: "Zozula" },
  { _id: B, firstName: "Jean-Marc", lastName: "Assaad" },
  { _id: C, firstName: "Amélie", lastName: "Desbiens" },
];
const profile = (userId: string, over: Partial<DirectoryProfileSource> = {}): DirectoryProfileSource => ({
  userId,
  specialty: "psychologist",
  bio: "Bio du profil.",
  education: [{ degree: "Ph.D." }],
  profileVisible: true,
  profileCompleted: true,
  ...over,
});
const page = (userId: string, over: Partial<DirectoryPageSource> = {}): DirectoryPageSource => ({
  userId,
  slug: "leanna-zozula",
  published: {
    displayName: "Dre Leanna Zozula",
    photoFileId: PHOTO,
    headline: { fr: "Accroche", en: "Headline" },
    intro: { fr: "Introduction\n\nen deux paragraphes.", en: "Intro in English." },
  },
  ...over,
});
const input = (over: Partial<Parameters<typeof buildProfessionalsDirectory>[0]> = {}) => ({
  locale: "fr" as const,
  users,
  profiles: [profile(A), profile(B), profile(C, { specialty: "psychotherapist", education: [{ degree: "M.A." }] })],
  pages: [page(A)],
  showcaseOn: true,
  ...over,
});
const build = (over: Partial<Parameters<typeof buildProfessionalsDirectory>[0]> = {}) => buildProfessionalsDirectory(input(over));

describe("buildProfessionalsDirectory", () => {
  it("lists every visible professional by last name, and links only those with a published page", () => {
    const list = build();
    expect(list.map((pro) => pro.displayName)).toEqual(["Jean-Marc Assaad", "Amélie Desbiens", "Dre Leanna Zozula"]);
    expect(list.map((pro) => pro.showcasePath)).toEqual([null, null, "/leanna-zozula"]);
  });

  it("uses the page's reviewed portrait and text, in the visitor's language", () => {
    const zozula = build().find((pro) => pro.id === A)!;
    expect(zozula).toMatchObject({ photoUrl: `/api/files/${PHOTO}`, summary: "Introduction en deux paragraphes.", degree: "Ph.D." });
    expect(build({ locale: "en" }).find((pro) => pro.id === A)!.summary).toBe("Intro in English.");
  });

  it("gives a professional without a page the profile's title and bio, and never a photo", () => {
    const desbiens = build().find((pro) => pro.id === C)!;
    expect(desbiens).toEqual({
      id: C,
      displayName: "Amélie Desbiens",
      title: { key: "psychotherapist", label: null },
      degree: "M.A.",
      summary: "Bio du profil.",
      photoUrl: null,
      showcasePath: null,
    });
  });

  it("never lists a professional who hid their profile, even with a published page", () => {
    const list = build({ profiles: [profile(A, { profileVisible: false }), profile(B)] });
    expect(list.map((pro) => pro.id)).toEqual([B]);
  });

  it("leaves out a profile never completed, unless the professional has a published page", () => {
    const list = build({ profiles: [profile(A, { profileCompleted: false }), profile(B, { profileCompleted: false })] });
    expect(list.map((pro) => pro.id)).toEqual([A]);
  });

  it("leaves out a professional with no profile or no name", () => {
    const list = build({ users: [...users, { _id: "0123456789abcdef0123dddd", firstName: " ", lastName: "" }], profiles: [profile(B), profile("0123456789abcdef0123dddd")] });
    expect(list.map((pro) => pro.id)).toEqual([B]);
  });

  it("shows no page, portrait or link while the pages are off, or for an unusable slug", () => {
    for (const over of [{ showcaseOn: false }, { pages: [page(A, { slug: "contact" })] }, { pages: [page(A, { published: null })] }]) {
      const zozula = build(over).find((pro) => pro.id === A)!;
      expect(zozula).toMatchObject({ displayName: "Leanna Zozula", photoUrl: null, showcasePath: null, summary: "Bio du profil." });
    }
  });

  it("drops an unusable photo id and a long degree", () => {
    const list = build({
      pages: [page(A, { published: { photoFileId: "../etc/passwd", intro: { fr: "Texte" } } })],
      profiles: [profile(A, { education: [{ degree: "Doctorat en psychologie clinique" }] })],
    });
    expect(list[0]).toMatchObject({ photoUrl: null, degree: null });
  });

  it("carries only the allowed keys", () => {
    for (const pro of build()) expect(Object.keys(pro).sort()).toEqual([...DIRECTORY_PROFESSIONAL_KEYS]);
  });
});

describe("the team's hiding and order", () => {
  it("never lists a professional the team hid", () => {
    expect(build({ curation: { hidden: [C] } }).map((pro) => pro.id)).toEqual([B, A]);
  });

  it("puts placed professionals first in the team's order, and everyone else after by last name", () => {
    expect(build({ curation: { order: [A, C] } }).map((pro) => pro.id)).toEqual([A, C, B]);
    expect(build({ curation: { order: [C] } }).map((pro) => pro.id)).toEqual([C, B, A]);
  });

  it("ignores ids that are not active professionals and repeats in the order", () => {
    const gone = "0123456789abcdef0123eeee";
    expect(build({ curation: { order: [gone, A, A, B], hidden: [gone] } }).map((pro) => pro.id)).toEqual([A, B, C]);
  });

  it("shows the team every active professional in the public order, with why each is or is not listed", () => {
    const rows = buildProfessionalsDirectoryAdminRows(
      input({
        profiles: [profile(A, { profileVisible: false }), profile(B), profile(C, { profileCompleted: false })],
        curation: { order: [C, A], hidden: [A, B] },
      }),
    );
    expect(rows).toEqual([
      { id: C, displayName: "Amélie Desbiens", title: { key: "psychologist", label: null }, showcasePath: null, excludedBy: "incomplete", hiddenByTeam: false, placed: true },
      { id: A, displayName: "Dre Leanna Zozula", title: { key: "psychologist", label: null }, showcasePath: "/leanna-zozula", excludedBy: "hiddenByProfessional", hiddenByTeam: true, placed: true },
      { id: B, displayName: "Jean-Marc Assaad", title: { key: "psychologist", label: null }, showcasePath: null, excludedBy: "hiddenByTeam", hiddenByTeam: true, placed: false },
    ]);
  });
});

describe("what professionals typed, as the page shows it", () => {
  it("shows a degree only when it is an abbreviation, the first such one", () => {
    for (const degree of ["Ph.D.", "M.A.", "Ph. D.", "B.Sc.", "PhD", "MSc", "MBA"]) {
      expect(degreeOf({ education: [{ degree }] }), degree).toBe(degree);
    }
    for (const degree of ["Master", "Maitrise", "Maîtrise en travail social", "Maitrise en éducation ( carriérologie/counselling)", "Doctorat", "Maitrise."]) {
      expect(degreeOf({ education: [{ degree }] }), degree).toBeNull();
    }
    expect(degreeOf({ education: [{ degree: "Maîtrise en psychologie" }, { degree: "Ph.D." }] })).toBe("Ph.D.");
    expect(degreeOf({ education: null })).toBeNull();
  });

  it("drops a summary that only repeats titles, and keeps a real text", () => {
    expect(isTitlesOnly("Psychothérapeute")).toBe(true);
    expect(isTitlesOnly("Psychologue Psychologue scolaire Psychothérapeute")).toBe(true);
    expect(isTitlesOnly("Travailleur social et psychothérapeute autorisé")).toBe(true);
    expect(isTitlesOnly("Psychologue depuis douze ans, je reçois à Mascouche.")).toBe(false);
    expect(isTitlesOnly("")).toBe(false);
    const list = build({ profiles: [profile(B, { bio: "Psychologue Psychologue scolaire" }), profile(C, { bio: "Travailleur social depuis 2009." })] });
    expect(list.find((pro) => pro.id === B)!.summary).toBe("");
    expect(list.find((pro) => pro.id === C)!.summary).toBe("Travailleur social depuis 2009.");
  });
});

describe("parseDirectoryCuration", () => {
  it("accepts two lists of distinct ids and the version the screen loaded", () => {
    expect(parseDirectoryCuration({ order: [A, B.toUpperCase()], hidden: [], expectedUpdatedAt: null })).toEqual({
      order: [A, B],
      hidden: [],
      expectedUpdatedAt: null,
    });
    expect(parseDirectoryCuration({ order: [], hidden: [C], expectedUpdatedAt: "2026-09-15T20:00:00.000Z" })?.expectedUpdatedAt).toBe(
      "2026-09-15T20:00:00.000Z",
    );
  });

  it("refuses anything else whole", () => {
    const tooMany = Array.from({ length: DIRECTORY_CURATION_MAX_IDS + 1 }, (_, i) => i.toString(16).padStart(24, "0"));
    for (const body of [
      null,
      "x",
      { order: [A], hidden: [] },
      { order: [A, A], hidden: [], expectedUpdatedAt: null },
      { order: ["../x"], hidden: [], expectedUpdatedAt: null },
      { order: [A], hidden: "B", expectedUpdatedAt: null },
      { order: [A], hidden: [{ $ne: null }], expectedUpdatedAt: null },
      { order: [], hidden: [], expectedUpdatedAt: "yesterday" },
      { order: tooMany, hidden: [], expectedUpdatedAt: null },
    ]) {
      expect(parseDirectoryCuration(body)).toBeNull();
    }
  });
});

describe("shortenSummary", () => {
  it("keeps a short text and cuts a long one at a word, with an ellipsis", () => {
    expect(shortenSummary("  Un   texte court. ")).toBe("Un texte court.");
    const long = "mot ".repeat(200);
    const cut = shortenSummary(long);
    expect(cut.length).toBeLessThanOrEqual(DIRECTORY_SUMMARY_MAX);
    expect(cut.endsWith("mot…")).toBe(true);
  });
});

/**
 * « Nos professionnels »: who is listed, what text and photo they get, and when « Lire plus » links
 * to their page. Pure.
 */
import { describe, it, expect } from "vitest";
import {
  DIRECTORY_PROFESSIONAL_KEYS,
  DIRECTORY_SUMMARY_MAX,
  buildProfessionalsDirectory,
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
const build = (over: Partial<Parameters<typeof buildProfessionalsDirectory>[0]> = {}) =>
  buildProfessionalsDirectory({
    locale: "fr",
    users,
    profiles: [profile(A), profile(B), profile(C, { specialty: "psychotherapist", education: [{ degree: "M.A." }] })],
    pages: [page(A)],
    showcaseOn: true,
    ...over,
  });

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

describe("shortenSummary", () => {
  it("keeps a short text and cuts a long one at a word, with an ellipsis", () => {
    expect(shortenSummary("  Un   texte court. ")).toBe("Un texte court.");
    const long = "mot ".repeat(200);
    const cut = shortenSummary(long);
    expect(cut.length).toBeLessThanOrEqual(DIRECTORY_SUMMARY_MAX);
    expect(cut.endsWith("mot…")).toBe(true);
  });
});

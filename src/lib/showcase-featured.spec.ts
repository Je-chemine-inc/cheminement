import { describe, it, expect } from "vitest";
import {
  FEATURED_LIMIT,
  FEATURED_PROFESSIONAL_KEYS,
  buildFeaturedProfessionals,
  degreeOf,
  isTitlesOnly,
  shortenSummary,
  type FeaturedInput,
} from "@/lib/showcase-featured";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccc";
const PHOTO = "dddddddddddddddddddddddd";

const input = (over: Partial<FeaturedInput> = {}): FeaturedInput => ({
  locale: "fr",
  showcaseOn: true,
  users: [
    { _id: A, firstName: "Julie", lastName: "Gagnon" },
    { _id: B, firstName: "Marc", lastName: "Côté" },
  ],
  profiles: [
    { userId: A, specialty: "psychologist", bio: "J'accompagne les adultes anxieux.", profileCompleted: true, yearsOfExperience: 12, languages: ["French"], modalities: ["Video Call"] },
    { userId: B, specialty: "psychotherapist", bio: "Thérapie de couple.", profileCompleted: true },
  ],
  pages: [],
  ...over,
});

describe("buildFeaturedProfessionals", () => {
  it("lists professionals without a page too, with no photo and no link", () => {
    const [marc, julie] = buildFeaturedProfessionals(input());
    expect(marc).toMatchObject({ displayName: "Marc Côté", pagePath: null, photoUrl: null, summary: "Thérapie de couple." });
    expect(julie).toMatchObject({ displayName: "Julie Gagnon", yearsOfExperience: 12, title: { key: "psychologist" } });
  });

  it("uses the page's name, portrait and text, links to it, and puts it first", () => {
    const list = buildFeaturedProfessionals(
      input({
        pages: [{ userId: A, slug: "psychologue-julie-gagnon", published: { displayName: "Dre Julie Gagnon", photoFileId: PHOTO, intro: { fr: "Intro de la page." } } }],
      }),
    );
    expect(list[0]).toMatchObject({
      displayName: "Dre Julie Gagnon",
      photoUrl: `/api/files/${PHOTO}`,
      pagePath: "/psychologue-julie-gagnon",
      summary: "Intro de la page.",
    });
    expect(list[1]!.pagePath).toBeNull();
  });

  it("names only the ways of consulting a page names: in person and video, never phone or chat", () => {
    const [pro] = buildFeaturedProfessionals(
      input({
        users: [{ _id: A, firstName: "Julie", lastName: "Gagnon" }],
        profiles: [{ userId: A, profileCompleted: true, modalities: ["Phone Call", "Video Call", "Chat/Messaging", "In-Person (Office)"] }],
      }),
    );
    expect(pro!.modalities).toEqual(["inPerson", "video"]);
  });

  it("gives no link while the pages are switched off", () => {
    const list = buildFeaturedProfessionals(
      input({ showcaseOn: false, pages: [{ userId: A, slug: "julie", published: { displayName: "Julie" } }] }),
    );
    expect(list.every((pro) => pro.pagePath === null && pro.photoUrl === null)).toBe(true);
  });

  it("never shows a professional who hid their profile, even with a page", () => {
    const list = buildFeaturedProfessionals(
      input({
        profiles: [{ userId: A, profileVisible: false, profileCompleted: true }, { userId: B, profileCompleted: true }],
        pages: [{ userId: A, slug: "julie", published: { displayName: "Julie" } }],
      }),
    );
    expect(list.map((pro) => pro.id)).toEqual([B]);
  });

  it("leaves out an unfinished profile with no page, and anyone without a profile", () => {
    const list = buildFeaturedProfessionals(
      input({
        users: [...input().users, { _id: C, firstName: "Sans", lastName: "Profil" }],
        profiles: [{ userId: A, profileCompleted: false }, { userId: B, profileCompleted: true }],
      }),
    );
    expect(list.map((pro) => pro.id)).toEqual([B]);
  });

  it("shows only a few, and nothing but the public keys", () => {
    const users = Array.from({ length: 9 }, (_, i) => ({ _id: `${i}`.padStart(24, "e"), firstName: "P", lastName: `${i}` }));
    const profiles = users.map((user) => ({ userId: user._id, profileCompleted: true }));
    const list = buildFeaturedProfessionals(input({ users, profiles }));
    expect(list).toHaveLength(FEATURED_LIMIT);
    expect(Object.keys(list[0]!).sort()).toEqual([...FEATURED_PROFESSIONAL_KEYS]);
  });
});

describe("the texts", () => {
  it("drops a bio that only repeats titles", () => {
    expect(isTitlesOnly("Psychologue Psychologue scolaire Psychothérapeute")).toBe(true);
    expect(isTitlesOnly("Travailleur social depuis 2009")).toBe(false);
  });

  it("keeps an abbreviated degree only", () => {
    expect(degreeOf({ education: [{ degree: "Ph.D." }] })).toBe("Ph.D.");
    expect(degreeOf({ education: [{ degree: "Maîtrise en travail social" }] })).toBeNull();
  });

  it("cuts a long text at a word", () => {
    const text = shortenSummary("mot ".repeat(200));
    expect(text.endsWith("mot…")).toBe(true);
  });
});

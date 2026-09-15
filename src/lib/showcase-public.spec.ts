import { describe, it, expect } from "vitest";
import {
  SHOWCASE_PUBLIC_KEYS,
  buildShowcasePublicProfile,
  showcaseLanguageKey,
  showcaseModalityKey,
  showcaseServiceOffered,
  toShowcaseCard,
  type BuildShowcaseInput,
} from "@/lib/showcase-public";

const PHOTO = "0123456789abcdef01234567";

function input(over: Partial<BuildShowcaseInput> = {}): BuildShowcaseInput {
  return {
    locale: "fr",
    page: { slug: "sassi", cityKey: "mascouche", services: { standard: true, quick: true } },
    content: {
      displayName: "Amel Sassi",
      headline: { fr: "Psychologue pour adultes", en: "Psychologist for adults" },
      intro: { fr: "Bonjour.\n\nBienvenue.", en: "" },
      bio: { fr: "Parcours.\n\nApproche humaine.", en: "Background." },
      approach: { fr: "TCC", en: "CBT" },
      insuranceNote: { fr: "Reçus pour assurances.", en: "" },
      values: [{ fr: "Écoute", en: "Listening", details: { fr: "Sans jugement.", en: "Without judgement." } }, { fr: "Respect", en: "" }],
      quote: { fr: "Chacun trouve ses ressources.", en: "" },
      highlights: [{ fr: "Reçus pour assurances", en: "Insurance receipts" }, { fr: "", en: "Orphan" }],
      credentials: [{ fr: "D. Psy., Université de Montréal", en: "" }],
      focusAreas: [
        { title: { fr: "Anxiété et stress", en: "Anxiety and stress" }, body: { fr: "On apprend.\n\nEnsemble.", en: "" } },
        { title: { fr: "", en: "No French title" }, body: { fr: "Dropped", en: "" } },
      ],
      methods: [{ name: { fr: "TCC", en: "CBT" }, title: { fr: "Thérapie cognitive", en: "" }, body: { fr: "Des outils concrets.", en: "" } }],
      expertiseIds: ["e2", "gone", "e1"],
      orderCode: "OPQ",
      orderLabel: "",
      photoFileId: PHOTO,
    },
    user: { firstName: "Amel", lastName: "Sassi" },
    profile: {
      specialty: "psychologist",
      license: " 12345-67 ",
      languages: ["french", "English", "other"],
      modalities: ["Video Call", "In-Person (Office)"],
      sessionTypes: ["Individual", "Couple", "Coaching"],
      officeAddress: { city: "Mascouche" },
      yearsOfExperience: 12,
      acceptingNewClients: true,
      acceptingEmergencyConsultations: true,
      availability: { sessionDurationMinutes: 50 },
      quickConsultation: { durationMinutes: 25 },
    },
    expertises: [
      { id: "e1", slug: "anxiete", labelFr: "Anxiété", labelEn: "Anxiety" },
      { id: "e2", slug: "burn-out", labelFr: "Épuisement professionnel", labelEn: "" },
    ],
    prices: { solo: 130, couple: 160, group: 90 },
    quickPrice: 70,
    ...over,
  };
}

describe("buildShowcasePublicProfile", () => {
  it("builds the public page from the published content and the live profile", () => {
    expect(buildShowcasePublicProfile(input())).toEqual({
      slug: "sassi",
      url: "https://psymascouche.jechemine.ca/sassi",
      city: { key: "mascouche", name: "Mascouche", region: "Lanaudière", regionKey: "lanaudiere" },
      displayName: "Amel Sassi",
      title: { key: "psychologist", label: null },
      order: { code: "OPQ", label: null },
      licenseNumber: "12345-67",
      photoUrl: `/api/files/${PHOTO}`,
      headline: "Psychologue pour adultes",
      intro: ["Bonjour.", "Bienvenue."],
      bio: ["Parcours.", "Approche humaine."],
      approach: ["TCC"],
      values: ["Écoute", "Respect"],
      valueCards: [
        { label: "Écoute", description: "Sans jugement." },
        { label: "Respect", description: "" },
      ],
      quote: "Chacun trouve ses ressources.",
      highlights: ["Reçus pour assurances"],
      credentials: ["D. Psy., Université de Montréal"],
      focusAreas: [{ title: "Anxiété et stress", body: ["On apprend.", "Ensemble."] }],
      methods: [{ name: "TCC", title: "Thérapie cognitive", body: ["Des outils concrets."] }],
      expertises: [
        { slug: "burn-out", label: "Épuisement professionnel" },
        { slug: "anxiete", label: "Anxiété" },
      ],
      languages: ["french", "english"],
      modalities: ["inPerson", "video"],
      officeCity: "Mascouche",
      yearsOfExperience: 12,
      services: {
        standard: {
          offered: true,
          durationMinutes: 50,
          prices: [
            { therapyType: "solo", price: 130 },
            { therapyType: "couple", price: 160 },
          ],
        },
        quick: { offered: true, durationMinutes: 25, price: 70 },
      },
      insuranceNote: ["Reçus pour assurances."],
      freeCancellationHours: 48,
    });
  });

  it("uses English where it was written, French otherwise", () => {
    const profile = buildShowcasePublicProfile(input({ locale: "en" }))!;
    expect(profile.headline).toBe("Psychologist for adults");
    expect(profile.intro).toEqual(["Bonjour.", "Bienvenue."]);
    expect(profile.values).toEqual(["Listening", "Respect"]);
    expect(profile.valueCards[0]).toEqual({ label: "Listening", description: "Without judgement." });
    expect(profile.highlights).toEqual(["Insurance receipts"]);
    expect(profile.focusAreas).toEqual([{ title: "Anxiety and stress", body: ["On apprend.", "Ensemble."] }]);
    expect(profile.methods[0]).toMatchObject({ name: "CBT", title: "Thérapie cognitive" });
    expect(profile.quote).toBe("Chacun trouve ses ressources.");
    expect(profile.expertises.map((e) => e.label)).toEqual(["Épuisement professionnel", "Anxiety"]);
  });

  it("never lets a private field through, whatever the sources carry", () => {
    const poisoned = input();
    const secret = "POISON";
    Object.assign(poisoned.user, { email: `${secret}@x.ca`, phone: secret, location: secret, password: secret, stripeConnectAccountId: secret });
    Object.assign(poisoned.profile!, {
      bio: secret,
      payoutInteracEmail: secret,
      payoutChequeUrl: secret,
      calendarFeedToken: secret,
      rates: {
        solo: { clientPrice: 130, professionalRate: 99999 },
        quick: { clientPrice: 70, professionalRate: 99999 },
      },
      pricing: { individualSession: 99999 },
      officeAddress: { city: "Mascouche", street: secret, postalCode: secret },
      officeNotes: secret,
      problematics: [secret],
    });
    Object.assign(poisoned.page, { userId: secret, consent: { ip: secret }, draft: { bio: { fr: secret } }, history: [{ note: secret }] });
    Object.assign(poisoned.content, { reviewNotes: secret });
    Object.assign(poisoned.content.methods![0]!, { internalNote: secret });
    Object.assign(poisoned.content.focusAreas![0]!, { draftOnly: secret });
    const json = JSON.stringify(buildShowcasePublicProfile(poisoned));
    expect(json).not.toContain(secret);
    expect(json).not.toContain("99999");
  });

  it("carries exactly the documented keys", () => {
    expect(Object.keys(buildShowcasePublicProfile(input())!).sort()).toEqual([...SHOWCASE_PUBLIC_KEYS]);
  });

  it("offers a service only when the page and the professional both do", () => {
    const services = (over: Parameters<typeof input>[0]) => buildShowcasePublicProfile(input(over))!.services;
    expect(services({ page: { slug: "s", cityKey: "mascouche", services: { standard: false, quick: false } } })).toMatchObject({
      standard: { offered: false },
      quick: { offered: false },
    });
    const base = input();
    expect(
      services({ profile: { ...base.profile!, acceptingNewClients: false, acceptingEmergencyConsultations: false } }),
    ).toMatchObject({ standard: { offered: false }, quick: { offered: false } });
    expect(services({ page: { slug: "s", cityKey: "mascouche", services: null } })).toMatchObject({
      standard: { offered: true },
      quick: { offered: false },
    });
  });

  it("applies the same rule to the booking routes", () => {
    expect(showcaseServiceOffered("standard", undefined, null)).toBe(true);
    expect(showcaseServiceOffered("quick", undefined, null)).toBe(false);
    expect(showcaseServiceOffered("quick", { quick: true }, { acceptingEmergencyConsultations: false })).toBe(false);
    expect(showcaseServiceOffered("standard", { standard: true }, { acceptingNewClients: false })).toBe(false);
  });

  it("gives the quick consultation its own length and price, or the defaults", () => {
    const base = input();
    const quick = (over: Parameters<typeof input>[0]) => buildShowcasePublicProfile(input(over))!.services.quick;
    expect(quick({ quickPrice: null, profile: { ...base.profile!, quickConsultation: null } })).toEqual({
      offered: true,
      durationMinutes: 30,
      price: null,
    });
    expect(quick({ quickPrice: 0, profile: { ...base.profile!, quickConsultation: { durationMinutes: 200 } } })).toEqual({
      offered: true,
      durationMinutes: 30,
      price: null,
    });
    expect(buildShowcasePublicProfile(input({ profile: { ...base.profile!, availability: null } }))!.services.standard.durationMinutes).toBe(60);
  });

  it("lists prices only for the therapy types offered, individual by default", () => {
    const base = input();
    const prices = (sessionTypes: string[], p: BuildShowcaseInput["prices"] = base.prices) =>
      buildShowcasePublicProfile(input({ profile: { ...base.profile!, sessionTypes }, prices: p }))!.services.standard.prices;
    expect(prices([])).toEqual([{ therapyType: "solo", price: 130 }]);
    expect(prices(["Groupe", "Couple"])).toEqual([
      { therapyType: "couple", price: 160 },
      { therapyType: "group", price: 90 },
    ]);
    expect(prices(["Individual"], { solo: 0 })).toEqual([]);
  });

  it("shows an unknown title as written, and no title for 'other professionals'", () => {
    const base = input();
    const titleOf = (specialty: string) =>
      buildShowcasePublicProfile(input({ profile: { ...base.profile!, specialty } }))!.title;
    expect(titleOf("Sexologue")).toEqual({ key: null, label: "Sexologue" });
    expect(titleOf("otherProfessionals")).toEqual({ key: null, label: null });
  });

  it("names another order only when it is named, and drops an unusable photo id", () => {
    const base = input();
    const build = (content: Partial<BuildShowcaseInput["content"]>) =>
      buildShowcasePublicProfile(input({ content: { ...base.content, ...content } }))!;
    expect(build({ orderCode: "other", orderLabel: "Ordre des criminologues" }).order).toEqual({
      code: "other",
      label: "Ordre des criminologues",
    });
    expect(build({ orderCode: "other", orderLabel: "" }).order).toBeNull();
    expect(build({ orderCode: "XYZ" }).order).toBeNull();
    expect(build({ photoFileId: "../../etc/passwd" }).photoUrl).toBeNull();
  });

  it("is null for a city that is not in the registry", () => {
    expect(buildShowcasePublicProfile(input({ page: { slug: "sassi", cityKey: "atlantis" } }))).toBeNull();
  });

  it("makes a card of the first three expertises", () => {
    const card = toShowcaseCard(buildShowcasePublicProfile(input())!);
    expect(card).toEqual({
      slug: "sassi",
      url: "https://psymascouche.jechemine.ca/sassi",
      city: { key: "mascouche", name: "Mascouche" },
      displayName: "Amel Sassi",
      title: { key: "psychologist", label: null },
      photoUrl: `/api/files/${PHOTO}`,
      headline: "Psychologue pour adultes",
      modalities: ["inPerson", "video"],
      expertises: ["Épuisement professionnel", "Anxiété"],
      expertiseSlugs: ["burn-out", "anxiete"],
      officeCity: "Mascouche",
    });
  });
});

describe("normalization of stored values", () => {
  it("recognises languages however the profile stored them", () => {
    expect(["french", "Français", "FRENCH", "fr"].map(showcaseLanguageKey)).toEqual(["french", "french", "french", "french"]);
    expect(showcaseLanguageKey("Chinois")).toBe("mandarin");
    expect(showcaseLanguageKey("other")).toBeNull();
  });

  it("recognises modalities however the profile stored them", () => {
    expect(showcaseModalityKey("In-Person (Office)")).toBe("inPerson");
    expect(showcaseModalityKey("En personne")).toBe("inPerson");
    expect(showcaseModalityKey("Video Call")).toBe("video");
    expect(showcaseModalityKey("Vidéo")).toBe("video");
    expect(showcaseModalityKey("Téléphone")).toBe("phone");
    expect(showcaseModalityKey("Phone Call")).toBe("phone");
    expect(showcaseModalityKey("Chat/Messaging")).toBe("chat");
    expect(showcaseModalityKey("Carrier pigeon")).toBeNull();
  });
});

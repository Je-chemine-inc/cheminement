import { describe, it, expect } from "vitest";
import {
  changedShowcaseFields,
  cleanLine,
  cleanParagraphs,
  decideShowcaseAction,
  isValidShowcaseSlug,
  missingShowcaseRequirements,
  normalizeShowcaseDraft,
  paragraphsOf,
  pickShowcaseSlug,
  showcaseSlugCandidates,
  type ShowcaseWorkflowState,
} from "@/lib/showcase-workflow";
import { SHOWCASE_CONSENT_VERSION } from "@/lib/showcase-constants";

describe("slugs", () => {
  it("proposes the full name, then numbered full names (www.jechemine.ca/amel-sassi)", () => {
    const candidates = showcaseSlugCandidates("Amel", "Sassi");
    expect(candidates.slice(0, 3)).toEqual(["amel-sassi", "amel-sassi-2", "amel-sassi-3"]);
    expect(candidates).not.toContain("sassi");
    expect(showcaseSlugCandidates("Marie-Ève", "Côté")[0]).toBe("marie-eve-cote");
  });

  it("never proposes a reserved or unusable slug", () => {
    expect(showcaseSlugCandidates("Jean", "Admin")[0]).toBe("jean-admin");
    expect(showcaseSlugCandidates("", "")[0]).toBe("professionnel-2");
    expect(showcaseSlugCandidates("X", "Y")[0]).toBe("x-y");
    for (const slug of showcaseSlugCandidates("Élodie", "D'Amour-O'Neil")) {
      expect(isValidShowcaseSlug(slug)).toBe(true);
    }
  });

  it("takes the first free candidate", () => {
    const candidates = showcaseSlugCandidates("Amel", "Sassi");
    expect(pickShowcaseSlug(candidates, new Set(["amel-sassi"]))).toBe("amel-sassi-2");
    expect(pickShowcaseSlug(["a1"], new Set(["a1"]))).toBeNull();
  });

  it("validates slugs", () => {
    expect(isValidShowcaseSlug("sassi")).toBe(true);
    expect(isValidShowcaseSlug("amel-sassi-2")).toBe(true);
    for (const bad of ["", "a", "Sassi", "-sassi", "sassi-", "sa--ssi", "sa_ssi", "specialite", "api", "robots-txt", "contact", "book", "x".repeat(61)]) {
      expect(isValidShowcaseSlug(bad), bad).toBe(false);
    }
  });
});

describe("text cleaning", () => {
  it("keeps paragraphs, drops control characters and extra blank lines", () => {
    expect(cleanParagraphs("  Un\r\n\r\n\r\n\r\nDeux \u0007 trois\t\tquatre  ", 100)).toEqual({
      ok: true,
      value: "Un\n\nDeux trois quatre",
    });
    expect(paragraphsOf("Un\n\nDeux\nsuite\n\n\nTrois")).toEqual(["Un", "Deux\nsuite", "Trois"]);
  });

  it("makes a single line of a title", () => {
    expect(cleanLine(" Psychologue\n  à\tMascouche ", 50)).toEqual({ ok: true, value: "Psychologue à Mascouche" });
  });

  it("refuses too long text and non-strings, accepts nothing as empty", () => {
    expect(cleanParagraphs("x".repeat(11), 10)).toEqual({ ok: false });
    expect(cleanLine(42, 10)).toEqual({ ok: false });
    expect(cleanLine(undefined, 10)).toEqual({ ok: true, value: "" });
  });
});

describe("normalizeShowcaseDraft", () => {
  const allowed = new Set(["e1", "e2", "e3"]);

  it("sets only the allowlisted fields", () => {
    const result = normalizeShowcaseDraft(
      {
        displayName: "Amel Sassi",
        headline: { fr: "Psychologue", en: "Psychologist" },
        bio: { fr: "Bio" },
        status: "published",
        slug: "hacked",
        photoFileId: "0123456789abcdef01234567",
        published: { displayName: "x" },
        consent: { version: SHOWCASE_CONSENT_VERSION },
        userId: "someone-else",
      },
      allowed,
    );
    expect(result).toEqual({
      ok: true,
      set: {
        "draft.displayName": "Amel Sassi",
        "draft.headline": { fr: "Psychologue", en: "Psychologist" },
        "draft.bio": { fr: "Bio", en: "" },
      },
      unset: [],
    });
  });

  it("accepts only catalog expertises offered on pages, at most 12, without duplicates", () => {
    expect(normalizeShowcaseDraft({ expertiseIds: ["e1", "e2", "e1"] }, allowed)).toEqual({
      ok: true,
      set: { "draft.expertiseIds": ["e1", "e2"] },
      unset: [],
    });
    expect(normalizeShowcaseDraft({ expertiseIds: ["e1", "nope"] }, allowed)).toEqual({
      ok: false,
      code: "UNKNOWN_EXPERTISE",
      field: "expertiseIds",
    });
    const many = new Set(Array.from({ length: 13 }, (_, i) => `x${i}`));
    expect(normalizeShowcaseDraft({ expertiseIds: [...many] }, many)).toMatchObject({ code: "TOO_MANY_EXPERTISES" });
  });

  it("no longer saves values, retired on 2026-09-18: a body carrying them changes nothing", () => {
    for (const actor of ["admin", "professional"] as const) {
      expect(
        normalizeShowcaseDraft({ values: [{ fr: "Écoute", en: "Listening", details: { fr: "Sans jugement." } }] }, allowed, actor),
      ).toEqual({ ok: true, set: {}, unset: [] });
    }
  });

  it("cleans the quote, the highlights and the credentials, dropping lines without French", () => {
    expect(
      normalizeShowcaseDraft(
        {
          quote: { fr: " Chacun trouve\nses ressources. " },
          highlights: [{ fr: "Reçus pour assurances" }, { fr: "", en: "Orphan" }],
          credentials: [{ fr: "D. Psy., 2013", en: "PsyD, 2013" }],
        },
        allowed,
      ),
    ).toEqual({
      ok: true,
      set: {
        "draft.quote": { fr: "Chacun trouve ses ressources.", en: "" },
        "draft.highlights": [{ fr: "Reçus pour assurances", en: "" }],
        "draft.credentials": [{ fr: "D. Psy., 2013", en: "PsyD, 2013" }],
      },
      unset: [],
    });
    const five = Array.from({ length: 5 }, (_, i) => ({ fr: `h${i}` }));
    expect(normalizeShowcaseDraft({ highlights: five }, allowed)).toEqual({ ok: false, code: "TOO_MANY_ITEMS", field: "highlights" });
    expect(normalizeShowcaseDraft({ credentials: "D. Psy." }, allowed)).toEqual({ ok: false, code: "INVALID_FIELD", field: "credentials" });
    expect(normalizeShowcaseDraft({ credentials: [{ fr: "x".repeat(121) }] }, allowed)).toMatchObject({ code: "TOO_LONG", field: "credentials.0" });
  });

  it("cleans focus areas and method cards, dropping a card without its French first part", () => {
    expect(
      normalizeShowcaseDraft(
        {
          focusAreas: [
            { title: { fr: "Anxiété et stress" }, body: { fr: "On apprend.\n\n\n\nEnsemble." }, extra: "ignored" },
            { title: { fr: "", en: "English only" }, body: { fr: "Dropped" } },
          ],
          methods: [{ name: { fr: "TCC", en: "CBT" }, title: { fr: "Thérapie cognitive" } }],
        },
        allowed,
      ),
    ).toEqual({
      ok: true,
      set: {
        "draft.focusAreas": [{ title: { fr: "Anxiété et stress", en: "" }, body: { fr: "On apprend.\n\nEnsemble.", en: "" } }],
        "draft.methods": [{ name: { fr: "TCC", en: "CBT" }, title: { fr: "Thérapie cognitive", en: "" }, body: { fr: "", en: "" } }],
      },
      unset: [],
    });
    const cards = Array.from({ length: 5 }, (_, i) => ({ name: { fr: `m${i}` } }));
    expect(normalizeShowcaseDraft({ methods: cards }, allowed)).toEqual({ ok: false, code: "TOO_MANY_ITEMS", field: "methods" });
    expect(normalizeShowcaseDraft({ focusAreas: ["not a card"] }, allowed)).toEqual({ ok: false, code: "INVALID_FIELD", field: "focusAreas.0" });
    expect(normalizeShowcaseDraft({ methods: [{ name: { fr: "TCC" }, body: { en: "x".repeat(321) } }] }, allowed)).toEqual({
      ok: false,
      code: "TOO_LONG",
      field: "methods.0.body.en",
    });
  });

  it("names the field and language that is too long", () => {
    expect(normalizeShowcaseDraft({ bio: { fr: "ok", en: "x".repeat(3001) } }, allowed)).toEqual({
      ok: false,
      code: "TOO_LONG",
      field: "bio.en",
    });
    expect(normalizeShowcaseDraft({ headline: "not an object" }, allowed)).toEqual({
      ok: false,
      code: "INVALID_FIELD",
      field: "headline",
    });
  });

  it("sets, clears and refuses the order", () => {
    expect(normalizeShowcaseDraft({ orderCode: "OPQ" }, allowed)).toMatchObject({ set: { "draft.orderCode": "OPQ" } });
    expect(normalizeShowcaseDraft({ orderCode: "" }, allowed)).toMatchObject({ unset: ["draft.orderCode"] });
    expect(normalizeShowcaseDraft({ orderCode: "ABC" }, allowed)).toMatchObject({ code: "INVALID_ORDER" });
  });

  it("never takes a city from anyone: the page's city follows the profile's office address", () => {
    for (const cityKey of ["berthierville", "", null, "atlantis", 42]) {
      expect(normalizeShowcaseDraft({ cityKey }, allowed)).toEqual({ ok: true, set: {}, unset: [] });
    }
  });

  it("ignores the page's city and order when the professional saves, without reading them", () => {
    expect(
      normalizeShowcaseDraft(
        { headline: { fr: "Psy" }, cityKey: "terrebonne", orderCode: "OPQ", orderLabel: "Ordre" },
        allowed,
        "professional",
      ),
    ).toEqual({ ok: true, set: { "draft.headline": { fr: "Psy", en: "" } }, unset: [] });
    expect(normalizeShowcaseDraft({ cityKey: "atlantis", orderCode: "ABC" }, allowed, "professional")).toEqual({
      ok: true,
      set: {},
      unset: [],
    });
  });

  it("refuses a body that is not an object", () => {
    expect(normalizeShowcaseDraft(null, allowed)).toMatchObject({ ok: false, field: "body" });
    expect(normalizeShowcaseDraft([], allowed)).toMatchObject({ ok: false, field: "body" });
  });
});

describe("missingShowcaseRequirements", () => {
  const complete = {
    draft: {
      displayName: "Amel Sassi",
      headline: { fr: "Psychologue à Mascouche" },
      bio: { fr: "x".repeat(200) },
      expertiseIds: ["e1", "e2", "e3"],
      orderCode: "OPQ",
      orderLabel: "",
      photoFileId: "f1",
    },
    profile: { specialty: "psychologist", license: "12345-67", modalities: ["Video Call"] },
    cityKey: "mascouche",
  };

  it("is empty for a complete page", () => {
    expect(missingShowcaseRequirements(complete)).toEqual([]);
  });

  it("lists everything missing, including what comes from the profile and the city", () => {
    expect(
      missingShowcaseRequirements({
        draft: { bio: { fr: "x".repeat(199) }, expertiseIds: ["e1", "e2"], orderCode: "other", orderLabel: " " },
        profile: { specialty: "", license: null, modalities: [] },
        cityKey: "atlantis",
      }),
    ).toEqual(["photo", "displayName", "headline", "bio", "expertises", "order", "title", "license", "modalities", "city"]);
    expect(missingShowcaseRequirements({ ...complete, profile: null })).toEqual(["title", "license", "modalities"]);
  });

  it("accepts another order when it is named", () => {
    expect(
      missingShowcaseRequirements({ ...complete, draft: { ...complete.draft, orderCode: "other", orderLabel: "Ordre X" } }),
    ).toEqual([]);
  });
});

describe("changedShowcaseFields", () => {
  it("names only the fields whose value differs from the public copy", () => {
    const published = { displayName: "Amel Sassi", headline: { fr: "Psychologue", en: "" } };
    expect(
      changedShowcaseFields(published, { displayName: "Amel Sassi", headline: { fr: "Psychologue", en: "Psychologist" } }),
    ).toEqual(["headline"]);
  });

  it("compares ids as strings and texts whatever their key order, but not reordered lists", () => {
    const ids = [{ toJSON: () => "e1" }, { toJSON: () => "e2" }];
    expect(
      changedShowcaseFields({ expertiseIds: ids, bio: { en: "", fr: "Bio" } }, { expertiseIds: ["e1", "e2"], bio: { fr: "Bio", en: "" } }),
    ).toEqual([]);
    expect(changedShowcaseFields({ expertiseIds: ids }, { expertiseIds: ["e2", "e1"] })).toEqual(["expertiseIds"]);
  });

  it("treats a missing value and an empty one as the same", () => {
    expect(changedShowcaseFields({}, { intro: { fr: "", en: "" }, values: [], displayName: "" })).toEqual([]);
    expect(changedShowcaseFields(null, { intro: { fr: "Bonjour", en: "" } })).toEqual(["intro"]);
  });

  it("sees a change inside a card, and none when only the key order differs", () => {
    const before = { methods: [{ name: { fr: "TCC", en: "" }, title: { fr: "Thérapie", en: "" }, body: { fr: "", en: "" } }] };
    expect(changedShowcaseFields(before, { methods: [{ body: { en: "", fr: "" }, title: { en: "", fr: "Thérapie" }, name: { en: "", fr: "TCC" } }] })).toEqual([]);
    expect(changedShowcaseFields(before, { methods: [{ name: { fr: "ACT", en: "" }, title: { fr: "Thérapie", en: "" }, body: { fr: "", en: "" } }] })).toEqual(["methods"]);
  });

  it("never reports a field the professional does not edit", () => {
    expect(changedShowcaseFields({}, { cityKey: "terrebonne", orderCode: "OPQ" })).toEqual([]);
  });
});

describe("decideShowcaseAction", () => {
  const base: ShowcaseWorkflowState = {
    status: "draft",
    draftRevision: 3,
    publishedRevision: null,
    hasPublishedSnapshot: false,
    unpublishedBy: null,
    consentVersion: SHOWCASE_CONSENT_VERSION,
  };
  const decide = (
    over: Partial<ShowcaseWorkflowState>,
    action: Parameters<typeof decideShowcaseAction>[1],
    actor: "professional" | "admin",
    options?: { consentAttested?: boolean },
  ) => decideShowcaseAction({ ...base, ...over }, action, actor, options);

  it("lets only an admin publish, and only something new", () => {
    expect(decide({}, "publish", "admin")).toEqual({ ok: true });
    expect(decide({}, "publish", "professional")).toEqual({ ok: false, code: "FORBIDDEN" });
    // A page activated before the change still reads « invited »: an admin prepares and publishes it all the same.
    expect(decide({ status: "invited" }, "publish", "admin")).toEqual({ ok: true });
    expect(decide({ status: "published", publishedRevision: 3, hasPublishedSnapshot: true }, "publish", "admin")).toEqual({
      ok: false,
      code: "NOTHING_TO_PUBLISH",
    });
    expect(decide({ status: "published", publishedRevision: 2, hasPublishedSnapshot: true }, "publish", "admin")).toEqual({ ok: true });
  });

  it("needs the professional's agreement: on record at the current version, or confirmed by the admin now", () => {
    expect(decide({ consentVersion: "showcase-2020-01" }, "publish", "admin")).toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    expect(decide({ consentVersion: null }, "publish", "admin")).toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    expect(decide({ consentVersion: null }, "publish", "admin", { consentAttested: false })).toEqual({
      ok: false,
      code: "CONSENT_REQUIRED",
    });
    expect(decide({ consentVersion: null }, "publish", "admin", { consentAttested: true })).toEqual({ ok: true });
  });

  it("lets the professional edit only a page that has been published", () => {
    expect(decide({}, "edit", "professional")).toEqual({ ok: false, code: "IN_PREPARATION" });
    expect(decide({ status: "published", hasPublishedSnapshot: true }, "edit", "professional")).toEqual({ ok: true });
    expect(decide({ status: "unpublished", hasPublishedSnapshot: true }, "edit", "professional")).toEqual({ ok: true });
    expect(decide({ status: "published", hasPublishedSnapshot: true }, "edit", "admin")).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("never lets an admin publish or put back a page the professional took down", () => {
    const withdrawn = { status: "unpublished" as const, unpublishedBy: "professional" as const, hasPublishedSnapshot: true, publishedRevision: 3 };
    expect(decide(withdrawn, "publish", "admin", { consentAttested: true })).toEqual({ ok: false, code: "WITHDRAWN_BY_PROFESSIONAL" });
    expect(decide({ ...withdrawn, draftRevision: 5 }, "publish", "admin")).toEqual({ ok: false, code: "WITHDRAWN_BY_PROFESSIONAL" });
    expect(decide(withdrawn, "republish", "admin")).toEqual({ ok: false, code: "WITHDRAWN_BY_PROFESSIONAL" });
    expect(decide(withdrawn, "republish", "professional")).toEqual({ ok: true });
  });

  it("never lets the professional alone put back a page an admin took down", () => {
    const takenDown = { status: "unpublished" as const, unpublishedBy: "admin" as const, hasPublishedSnapshot: true };
    expect(decide(takenDown, "republish", "professional")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(decide(takenDown, "republish", "admin")).toEqual({ ok: true });
    expect(decide({ ...takenDown, consentVersion: "old" }, "republish", "admin")).toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    expect(decide({ status: "unpublished", hasPublishedSnapshot: false }, "republish", "admin")).toEqual({
      ok: false,
      code: "NOTHING_TO_PUBLISH",
    });
    expect(decide({}, "republish", "admin")).toEqual({ ok: false, code: "NOT_UNPUBLISHED" });
  });

  it("takes down only a published page, by either side", () => {
    expect(decide({ status: "published" }, "unpublish", "professional")).toEqual({ ok: true });
    expect(decide({ status: "published" }, "unpublish", "admin")).toEqual({ ok: true });
    expect(decide({}, "unpublish", "admin")).toEqual({ ok: false, code: "NOT_PUBLISHED" });
  });
});

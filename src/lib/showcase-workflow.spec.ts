import { describe, it, expect } from "vitest";
import {
  cleanLine,
  cleanParagraphs,
  decideShowcaseAction,
  isValidShowcaseSlug,
  missingShowcaseRequirements,
  normalizeShowcaseDraft,
  requestedShowcaseCityKey,
  showcaseCityKeyOf,
  paragraphsOf,
  pickShowcaseSlug,
  showcaseSlugCandidates,
  type ShowcaseWorkflowState,
} from "@/lib/showcase-workflow";
import { SHOWCASE_CONSENT_VERSION } from "@/lib/showcase-constants";

describe("slugs", () => {
  it("proposes the last name, then the full name, then numbered full names", () => {
    const candidates = showcaseSlugCandidates("Amel", "Sassi");
    expect(candidates.slice(0, 3)).toEqual(["sassi", "amel-sassi", "amel-sassi-2"]);
    expect(showcaseSlugCandidates("Marie-Ève", "Côté")[0]).toBe("cote");
    expect(showcaseSlugCandidates("Marie-Ève", "Côté")[1]).toBe("marie-eve-cote");
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
    expect(pickShowcaseSlug(candidates, new Set(["sassi"]))).toBe("amel-sassi");
    expect(pickShowcaseSlug(["a1"], new Set(["a1"]))).toBeNull();
  });

  it("validates slugs", () => {
    expect(isValidShowcaseSlug("sassi")).toBe(true);
    expect(isValidShowcaseSlug("amel-sassi-2")).toBe(true);
    for (const bad of ["", "a", "Sassi", "-sassi", "sassi-", "sa--ssi", "sa_ssi", "specialite", "api", "robots-txt", "x".repeat(61)]) {
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

  it("keeps up to five values with their French wording", () => {
    const result = normalizeShowcaseDraft(
      { values: [{ fr: " Écoute ", en: "Listening" }, { fr: "", en: "Orphan" }, { fr: "Respect" }] },
      allowed,
    );
    expect(result).toEqual({
      ok: true,
      set: { "draft.values": [{ fr: "Écoute", en: "Listening" }, { fr: "Respect", en: "" }] },
      unset: [],
    });
    const six = Array.from({ length: 6 }, (_, i) => ({ fr: `v${i}` }));
    expect(normalizeShowcaseDraft({ values: six }, allowed)).toMatchObject({ code: "TOO_MANY_VALUES" });
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

  it("sets, clears and refuses the page's city", () => {
    expect(normalizeShowcaseDraft({ cityKey: "berthierville" }, allowed)).toEqual({
      ok: true,
      set: { "draft.cityKey": "berthierville" },
      unset: [],
    });
    expect(normalizeShowcaseDraft({ cityKey: "" }, allowed)).toMatchObject({ unset: ["draft.cityKey"] });
    expect(normalizeShowcaseDraft({ cityKey: null }, allowed)).toMatchObject({ unset: ["draft.cityKey"] });
    for (const bad of ["atlantis", "verdun", "Mascouche", 42, ["mascouche"]]) {
      expect(normalizeShowcaseDraft({ cityKey: bad }, allowed)).toEqual({ ok: false, code: "INVALID_CITY", field: "cityKey" });
    }
  });

  it("refuses a body that is not an object", () => {
    expect(normalizeShowcaseDraft(null, allowed)).toMatchObject({ ok: false, field: "body" });
    expect(normalizeShowcaseDraft([], allowed)).toMatchObject({ ok: false, field: "body" });
  });
});

describe("the page's city", () => {
  it("is the one the draft asks for when it is a listed city, else the page's own", () => {
    expect(showcaseCityKeyOf({ cityKey: "mascouche", draft: { cityKey: "terrebonne" } })).toBe("terrebonne");
    expect(showcaseCityKeyOf({ cityKey: "mascouche", draft: {} })).toBe("mascouche");
    expect(showcaseCityKeyOf({ cityKey: "mascouche" })).toBe("mascouche");
    // A city removed from the list since the draft was saved does not move the page anywhere.
    expect(showcaseCityKeyOf({ cityKey: "mascouche", draft: { cityKey: "atlantis" } })).toBe("mascouche");
  });

  it("asks for a move only when the draft names another listed city", () => {
    expect(requestedShowcaseCityKey({ cityKey: "mascouche", draft: { cityKey: "terrebonne" } })).toBe("terrebonne");
    expect(requestedShowcaseCityKey({ cityKey: "mascouche", draft: { cityKey: "mascouche" } })).toBeNull();
    expect(requestedShowcaseCityKey({ cityKey: "mascouche", draft: { cityKey: null } })).toBeNull();
    expect(requestedShowcaseCityKey({ cityKey: "mascouche", draft: { cityKey: "verdun" } })).toBeNull();
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

describe("decideShowcaseAction", () => {
  const base: ShowcaseWorkflowState = {
    status: "draft",
    reviewState: "none",
    draftRevision: 3,
    publishedRevision: null,
    hasPublishedSnapshot: false,
    unpublishedBy: null,
    consentVersion: SHOWCASE_CONSENT_VERSION,
    remindedAt: null,
  };
  const decide = (over: Partial<ShowcaseWorkflowState>, action: Parameters<typeof decideShowcaseAction>[1], actor: "professional" | "admin", now?: Date) =>
    decideShowcaseAction({ ...base, ...over }, action, actor, now);

  it("lets only the professional submit, once at a time", () => {
    expect(decide({}, "submit", "professional")).toEqual({ ok: true });
    expect(decide({}, "submit", "admin")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(decide({ reviewState: "pending" }, "submit", "professional")).toEqual({ ok: false, code: "ALREADY_SUBMITTED" });
    expect(decide({ reviewState: "changes_requested" }, "submit", "professional")).toEqual({ ok: true });
  });

  it("lets only an admin publish, with the professional's current consent and something new", () => {
    expect(decide({ reviewState: "pending" }, "approve", "admin")).toEqual({ ok: true });
    expect(decide({ reviewState: "pending" }, "approve", "professional")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(decide({ consentVersion: "showcase-2020-01" }, "approve", "admin")).toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    expect(decide({ consentVersion: null }, "approve", "admin")).toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    expect(decide({ status: "invited" }, "approve", "admin")).toEqual({ ok: false, code: "NOTHING_TO_PUBLISH" });
    expect(decide({ status: "published", publishedRevision: 3, hasPublishedSnapshot: true }, "approve", "admin")).toEqual({
      ok: false,
      code: "NOTHING_TO_PUBLISH",
    });
    expect(decide({ status: "published", publishedRevision: 2, hasPublishedSnapshot: true }, "approve", "admin")).toEqual({ ok: true });
  });

  it("never lets an admin put back a page the professional took down, unless they resubmitted", () => {
    const withdrawn = { status: "unpublished" as const, unpublishedBy: "professional" as const, hasPublishedSnapshot: true, publishedRevision: 3 };
    expect(decide(withdrawn, "approve", "admin")).toEqual({ ok: false, code: "WITHDRAWN_BY_PROFESSIONAL" });
    expect(decide(withdrawn, "republish", "admin")).toEqual({ ok: false, code: "WITHDRAWN_BY_PROFESSIONAL" });
    expect(decide({ ...withdrawn, reviewState: "pending" }, "approve", "admin")).toEqual({ ok: true });
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

  it("asks for changes only on a submitted page", () => {
    expect(decide({ reviewState: "pending" }, "request_changes", "admin")).toEqual({ ok: true });
    expect(decide({}, "request_changes", "admin")).toEqual({ ok: false, code: "NOT_SUBMITTED" });
    expect(decide({ reviewState: "pending" }, "request_changes", "professional")).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("takes down only a published page, by either side", () => {
    expect(decide({ status: "published" }, "unpublish", "professional")).toEqual({ ok: true });
    expect(decide({ status: "published" }, "unpublish", "admin")).toEqual({ ok: true });
    expect(decide({}, "unpublish", "admin")).toEqual({ ok: false, code: "NOT_PUBLISHED" });
  });

  it("reminds an invited professional at most once a day, before they submit", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    expect(decide({ status: "invited" }, "remind", "admin", now)).toEqual({ ok: true });
    expect(decide({ status: "invited", remindedAt: new Date("2026-09-12T00:00:00Z") }, "remind", "admin", now)).toEqual({
      ok: false,
      code: "REMINDED_RECENTLY",
    });
    expect(decide({ status: "invited", remindedAt: new Date("2026-09-11T11:59:00Z") }, "remind", "admin", now)).toEqual({ ok: true });
    expect(decide({ reviewState: "pending" }, "remind", "admin", now)).toEqual({ ok: false, code: "ALREADY_SUBMITTED" });
    expect(decide({ status: "published" }, "remind", "admin", now)).toEqual({ ok: false, code: "NOT_REMINDABLE" });
    expect(decide({ status: "invited" }, "remind", "professional", now)).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});

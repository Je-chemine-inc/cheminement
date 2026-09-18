/**
 * Spec 003 — the changes to a showcase page. What must hold: an admin
 * activates and publishes, and nothing is published without the
 * professional's agreement on record or confirmed by the admin, on the exact
 * revision the admin saw; the professional edits only a published page, live,
 * never its city or order, never leaving it missing what it had; every change
 * is a conditional write on the state it was decided from; emails go out only
 * after the response; a photo is deleted only when no copy of the page shows it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SHOWCASE_CONSENT_VERSION } from "@/lib/showcase-constants";

const h = vi.hoisted(() => {
  const chain = (value: () => unknown) => {
    const query = {
      select: () => query,
      sort: () => query,
      lean: async () => value(),
    };
    return query;
  };
  return {
    chain,
    page: null as Record<string, unknown> | null,
    user: null as Record<string, unknown> | null,
    profile: null as Record<string, unknown> | null,
    options: [] as Record<string, unknown>[],
    taken: [] as Record<string, unknown>[],
    exists: false,
    updateResult: { _id: "p1" } as Record<string, unknown> | null,
    /** Results for the next findOneAndUpdate calls, in order; then `updateResult`. */
    updateQueue: [] as (Record<string, unknown> | null)[],
    createError: null as unknown,
    enabled: true,
    created: [] as Record<string, unknown>[],
    updateOne: [] as [Record<string, unknown>, Record<string, unknown>][],
    findOneAndUpdate: [] as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>][],
    deleteMany: [] as Record<string, unknown>[],
    deleteOne: [] as Record<string, unknown>[],
    sendUpdated: vi.fn<[Record<string, unknown>], Promise<undefined>>(async () => undefined),
    sendPublished: vi.fn<[Record<string, unknown>], Promise<boolean>>(async () => true),
    sendUnpublished: vi.fn<[Record<string, unknown>], Promise<boolean>>(async () => true),
    bookingReads: [] as string[],
    bookingOptions: [] as unknown[] | Error,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/showcase-stats", () => ({
  SHOWCASE_STATS_DAYS: 30,
  loadShowcaseStats: async () => new Map(),
}));
vi.mock("@/models/ShowcasePage", () => ({
  default: {
    findOne: () => h.chain(() => h.page),
    find: () => h.chain(() => h.taken),
    exists: async () => (h.exists ? { _id: "x" } : null),
    create: async (doc: Record<string, unknown>) => {
      h.created.push(doc);
      if (h.createError) throw h.createError;
      return { _id: "new" };
    },
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      h.updateOne.push([filter, update]);
      return { matchedCount: 1 };
    },
    findOneAndUpdate: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => {
      h.findOneAndUpdate.push([filter, update, options]);
      const result = h.updateQueue.length > 0 ? h.updateQueue.shift() : h.updateResult;
      return h.chain(() => result);
    },
  },
}));
vi.mock("@/models/User", () => ({
  default: {
    findOne: () => h.chain(() => h.user),
    findById: () => h.chain(() => h.user),
    find: () => h.chain(() => []),
  },
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: () => h.chain(() => h.profile),
    find: () => h.chain(() => []),
  },
}));
vi.mock("@/models/ProCatalogItem", () => ({
  default: { find: () => h.chain(() => h.options) },
}));
vi.mock("@/models/StoredFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/StoredFile")>()),
  default: {
    deleteMany: async (filter: Record<string, unknown>) => {
      h.deleteMany.push(filter);
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      h.deleteOne.push(filter);
    },
  },
}));
vi.mock("@/lib/showcase-booking", () => ({
  showcaseBookingOptions: async (slug: string) => {
    h.bookingReads.push(slug);
    if (h.bookingOptions instanceof Error) throw h.bookingOptions;
    return h.bookingOptions;
  },
}));
vi.mock("@/lib/notifications", () => ({
  sendAdminShowcaseUpdatedAlert: h.sendUpdated,
  sendShowcasePublishedEmail: h.sendPublished,
  sendShowcaseUnpublishedEmail: h.sendUnpublished,
}));

import {
  activateShowcase,
  loadShowcaseEditor,
  moveShowcase,
  removeShowcaseOfficePhoto,
  setShowcaseOfficePhoto,
  publishShowcase,
  republishShowcase,
  saveShowcaseDraft,
  setShowcasePhoto,
  unpublishShowcase,
  updateShowcaseServices,
  type ServiceResult,
} from "@/lib/showcase-service";

const PRO = "0123456789abcdef01234567";
const ADMIN = "0123456789abcdef0123abcd";

const completeDraft = {
  displayName: "Amel Sassi",
  headline: { fr: "Psychologue pour adultes", en: "" },
  bio: { fr: "x".repeat(220), en: "" },
  expertiseIds: ["e1", "e2", "e3"],
  orderCode: "OPQ",
  orderLabel: "",
  photoFileId: "f-draft",
};
const completeProfile = {
  specialty: "psychologist",
  license: "12345-67",
  modalities: ["Video Call"],
  languages: ["french"],
  officeAddress: { city: "Mascouche" },
};
const activePro = { firstName: "Amel", lastName: "Sassi", email: "amel@exemple.ca", language: "fr", status: "active", adminApproved: true };

function page(over: Record<string, unknown> = {}) {
  return {
    _id: "p1",
    userId: PRO,
    slug: "sassi",
    previousSlugs: [],
    cityKey: "mascouche",
    status: "draft",
    draft: completeDraft,
    draftRevision: 4,
    services: { standard: true, quick: false },
    consent: { version: SHOWCASE_CONSENT_VERSION },
    ...over,
  };
}

/** A page an admin published at revision 4, as the professional finds it. */
function livePage(over: Record<string, unknown> = {}) {
  return page({
    status: "published",
    published: { ...completeDraft },
    publishedRevision: 4,
    publishedAt: new Date("2026-09-01"),
    ...over,
  });
}

async function runDeferred(result: ServiceResult<unknown>) {
  if (!result.ok) throw new Error(`expected success, got ${result.code}`);
  for (const task of result.deferred) await task();
}

beforeEach(() => {
  h.page = null;
  h.user = { ...activePro };
  h.profile = { ...completeProfile };
  h.options = [
    { _id: "e1", labelFr: "Anxiété", labelEn: "Anxiety", aliases: [] },
    { _id: "e2", labelFr: "Deuil", labelEn: "Grief", aliases: ["perte"] },
    { _id: "e3", labelFr: "Épuisement professionnel", labelEn: "Burnout", aliases: [] },
  ];
  h.taken = [];
  h.exists = false;
  h.updateResult = { _id: "p1" };
  h.updateQueue = [];
  h.createError = null;
  h.enabled = true;
  h.created = [];
  h.updateOne = [];
  h.findOneAndUpdate = [];
  h.deleteMany = [];
  h.deleteOne = [];
  for (const send of [h.sendUpdated, h.sendPublished, h.sendUnpublished]) send.mockClear();
});

describe("activateShowcase", () => {
  it("creates a draft page prefilled from the profile, with a free slug and the office city, and emails no one", async () => {
    h.profile = { specialty: "psychologist", problematics: ["anxiete", "Perte"], bio: " Mon parcours. ", officeAddress: { city: "Mascouche, QC" } };
    h.taken = [{ slug: "sassi", previousSlugs: [] }];
    const result = await activateShowcase({ userId: PRO, adminId: ADMIN });
    expect(result).toMatchObject({ ok: true, value: { slug: "amel-sassi", cityKey: "mascouche" }, deferred: [] });
    expect(h.created[0]).toMatchObject({
      userId: PRO,
      slug: "amel-sassi",
      cityKey: "mascouche",
      status: "draft",
      invitedBy: ADMIN,
      draft: {
        displayName: "Amel Sassi",
        bio: { fr: "Mon parcours.", en: "" },
        expertiseIds: ["e1", "e2"],
        orderCode: "OPQ",
      },
      history: [{ actor: "admin", by: ADMIN, action: "activate", note: "mascouche/amel-sassi" }],
    });
    expect(h.created[0].draft).not.toHaveProperty("cityKey");
  });

  it("takes the city from the office address, never from the request, and refuses an address naming no listed city", async () => {
    h.profile = { ...completeProfile, officeAddress: { city: "Terrebonne" } };
    expect(await activateShowcase({ userId: PRO, cityKey: "mascouche", adminId: ADMIN } as Parameters<typeof activateShowcase>[0])).toMatchObject({
      ok: true,
      value: { cityKey: "terrebonne" },
    });
    h.created = [];
    for (const city of ["Atlantis", "", undefined]) {
      h.profile = { ...completeProfile, officeAddress: { city } };
      expect(await activateShowcase({ userId: PRO, adminId: ADMIN })).toMatchObject({ ok: false, status: 409, code: "OFFICE_CITY_UNKNOWN" });
    }
    h.profile = null;
    expect(await activateShowcase({ userId: PRO, adminId: ADMIN })).toMatchObject({ code: "OFFICE_CITY_UNKNOWN" });
    expect(h.created).toEqual([]);
  });

  it("refuses a professional whose account is not active and approved", async () => {
    h.user = { ...activePro, status: "pending" };
    expect(await activateShowcase({ userId: PRO, adminId: ADMIN })).toMatchObject({
      ok: false,
      status: 409,
      code: "PROFESSIONAL_NOT_ACTIVE",
    });
    h.user = { ...activePro, adminApproved: false };
    expect(await activateShowcase({ userId: PRO, adminId: ADMIN })).toMatchObject({
      code: "PROFESSIONAL_NOT_ACTIVE",
    });
    expect(h.created).toEqual([]);
  });

  it("refuses a second page, a slug in use (even a former one) and a reserved slug", async () => {
    h.profile = { ...completeProfile, officeAddress: { city: "Mascouche" } };
    h.exists = true;
    expect(await activateShowcase({ userId: PRO, adminId: ADMIN })).toMatchObject({ code: "ALREADY_INVITED" });
    h.exists = false;
    h.taken = [{ slug: "autre", previousSlugs: ["sassi"] }];
    expect(await activateShowcase({ userId: PRO, slug: "sassi", adminId: ADMIN })).toMatchObject({
      status: 409,
      code: "SLUG_TAKEN",
    });
    expect(await activateShowcase({ userId: PRO, slug: "API", adminId: ADMIN })).toMatchObject({
      status: 400,
      code: "INVALID_SLUG",
    });
    expect(h.created).toEqual([]);
  });
});

describe("saveShowcaseDraft by an admin", () => {
  it("writes only allowlisted fields to the draft, bumps the revision and moves an invited page to draft", async () => {
    h.page = page({ status: "invited" });
    const result = await saveShowcaseDraft({
      userId: PRO,
      body: { headline: { fr: "Psychologue" }, status: "published", slug: "pirate", published: { displayName: "X" } },
      actor: "admin",
    });
    expect(result.ok).toBe(true);
    const [filter, update] = h.updateOne[0];
    expect(filter).toEqual({ _id: "p1" });
    expect(update).toMatchObject({
      $set: { "draft.headline": { fr: "Psychologue", en: "" }, draftUpdatedBy: "admin", status: "draft" },
      $inc: { draftRevision: 1 },
    });
    const set = update.$set as Record<string, unknown>;
    expect(Object.keys(set).sort()).toEqual(["draft.headline", "draftUpdatedAt", "draftUpdatedBy", "status"]);
  });

  it("refuses an expertise that is not offered on pages, and a page that does not exist", async () => {
    h.page = page();
    expect(await saveShowcaseDraft({ userId: PRO, body: { expertiseIds: ["zz"] }, actor: "admin" })).toEqual({
      ok: false,
      status: 400,
      code: "UNKNOWN_EXPERTISE",
      details: { field: "expertiseIds" },
    });
    h.page = null;
    expect(await saveShowcaseDraft({ userId: PRO, body: { displayName: "X" }, actor: "admin" })).toMatchObject({ status: 404 });
    expect(h.updateOne).toEqual([]);
  });

  it("ignores a city in the body: the page's city follows the office address", async () => {
    h.page = page({ status: "draft" });
    expect(await saveShowcaseDraft({ userId: PRO, body: { cityKey: "berthierville" }, actor: "admin" })).toMatchObject({
      status: 400,
      code: "NOTHING_TO_SAVE",
    });
    await saveShowcaseDraft({ userId: PRO, body: { headline: { fr: "Psy" }, cityKey: "berthierville" }, actor: "admin" });
    const [, update] = h.updateOne[0];
    expect(Object.keys(update.$set as Record<string, unknown>).filter((key) => /cityKey/.test(key))).toEqual([]);
    expect(update).not.toHaveProperty("$push");
  });
});

describe("the professional's live edits", () => {
  it("are refused while the team prepares the page, before any write — an uploaded photo is thrown away", async () => {
    h.page = page();
    expect(await saveShowcaseDraft({ userId: PRO, body: { headline: { fr: "Accroche" } }, actor: "professional" })).toEqual({
      ok: false,
      status: 409,
      code: "IN_PREPARATION",
    });
    expect(await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "professional" })).toMatchObject({ code: "IN_PREPARATION" });
    expect(h.deleteOne).toEqual([{ _id: "f-new", kind: "showcase-photo" }]);
    expect(h.updateOne).toEqual([]);
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("write the draft and the public copy together, on the revision they read", async () => {
    h.page = livePage();
    const result = await saveShowcaseDraft({ userId: PRO, body: { headline: { fr: "Nouvelle accroche" } }, actor: "professional" });
    expect(result.ok).toBe(true);
    expect(h.updateOne).toEqual([]);
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", draftRevision: 4 });
    expect(update.$set).toMatchObject({
      "draft.headline": { fr: "Nouvelle accroche", en: "" },
      "published.headline": { fr: "Nouvelle accroche", en: "" },
      draftRevision: 5,
      publishedRevision: 5,
      draftUpdatedBy: "professional",
    });
    expect(update.$push).toMatchObject({ history: { $each: [{ actor: "professional", by: PRO, action: "edit", note: "headline" }] } });
  });

  it("never touch the page's city or order, whatever the body says", async () => {
    h.page = livePage();
    await saveShowcaseDraft({
      userId: PRO,
      body: { headline: { fr: "Nouvelle accroche" }, cityKey: "terrebonne", orderCode: "OPPQ", orderLabel: "Autre" },
      actor: "professional",
    });
    const set = h.findOneAndUpdate[0][1].$set as Record<string, unknown>;
    expect(Object.keys(set).filter((key) => /cityKey|order/.test(key))).toEqual([]);
    expect(set).not.toHaveProperty("cityKey");

    h.findOneAndUpdate = [];
    expect(await saveShowcaseDraft({ userId: PRO, body: { cityKey: "terrebonne" }, actor: "professional" })).toMatchObject({
      status: 400,
      code: "NOTHING_TO_SAVE",
    });
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("are refused when they would leave the public page missing what it had, but not for what was already missing", async () => {
    h.page = livePage();
    expect(await saveShowcaseDraft({ userId: PRO, body: { bio: { fr: "Trop court" } }, actor: "professional" })).toEqual({
      ok: false,
      status: 422,
      code: "INCOMPLETE",
      details: { missing: ["bio"] },
    });
    expect(h.findOneAndUpdate).toEqual([]);

    // The permit number comes from the profile: its absence must not block the text.
    h.profile = { ...completeProfile, license: "" };
    expect(await saveShowcaseDraft({ userId: PRO, body: { headline: { fr: "Accroche" } }, actor: "professional" })).toMatchObject({ ok: true });
  });

  it("leave corrections an admin has not published yet pending", async () => {
    h.page = livePage({ draftRevision: 6 });
    await saveShowcaseDraft({ userId: PRO, body: { headline: { fr: "Nouvelle accroche" } }, actor: "professional" });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", draftRevision: 6 });
    expect(update.$set).toMatchObject({ draftRevision: 7 });
    expect(update.$set).not.toHaveProperty("publishedRevision");
  });

  it("answer CONFLICT when the page changed meanwhile, and send nothing", async () => {
    h.page = livePage();
    h.updateResult = null;
    expect(await saveShowcaseDraft({ userId: PRO, body: { headline: { fr: "Accroche" } }, actor: "professional" })).toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
    expect(h.sendUpdated).not.toHaveBeenCalled();
  });

  it("tell the team what changed, after the response, at most once an hour per page", async () => {
    h.page = livePage();
    const result = await saveShowcaseDraft({
      userId: PRO,
      body: { headline: { fr: "Nouvelle accroche" }, displayName: "Amel Sassi" },
      actor: "professional",
    });
    const [claimFilter, claimUpdate] = h.findOneAndUpdate[1];
    expect(claimFilter).toMatchObject({ _id: "p1" });
    expect(claimFilter).toHaveProperty("$or");
    expect(claimUpdate).toMatchObject({ $set: { changeAlertedAt: expect.any(Date) } });
    expect(h.sendUpdated).not.toHaveBeenCalled();
    await runDeferred(result);
    expect(h.sendUpdated).toHaveBeenCalledWith({
      professionalName: "Amel Sassi",
      professionalId: PRO,
      cityName: "Mascouche",
      publicUrl: "https://www.jechemine.ca/sassi",
      fields: ["headline"],
    });

    // An alert went out less than an hour ago: the edit is saved and recorded, the team is not emailed again.
    h.findOneAndUpdate = [];
    h.updateQueue = [{ _id: "p1" }, null];
    const again = await saveShowcaseDraft({ userId: PRO, body: { headline: { fr: "Autre accroche" } }, actor: "professional" });
    expect(again).toMatchObject({ ok: true, deferred: [] });
    expect(h.findOneAndUpdate[0][1]).toHaveProperty("$push");
  });

  it("that change nothing are saved without a history entry or an alert", async () => {
    h.page = livePage();
    const result = await saveShowcaseDraft({ userId: PRO, body: { headline: { fr: "Psychologue pour adultes" } }, actor: "professional" });
    expect(result).toMatchObject({ ok: true, deferred: [] });
    expect(h.findOneAndUpdate).toHaveLength(1);
    expect(h.findOneAndUpdate[0][1]).not.toHaveProperty("$push");
  });

  it("replace the photo of the live page at once, delete the old one, and never remove it", async () => {
    h.page = livePage();
    const result = await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "professional" });
    expect(result).toMatchObject({ ok: true, value: { photoUrl: "/api/files/f-new" } });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", draftRevision: 4 });
    expect(update.$set).toMatchObject({ "draft.photoFileId": "f-new", "published.photoFileId": "f-new", publishedRevision: 5 });
    expect(h.deleteMany).toEqual([{ _id: { $in: ["f-draft"] }, kind: "showcase-photo" }]);
    await runDeferred(result);
    expect(h.sendUpdated).toHaveBeenCalledWith(expect.objectContaining({ fields: ["photo"] }));

    h.findOneAndUpdate = [];
    expect(await setShowcasePhoto({ userId: PRO, fileId: null, actor: "professional" })).toEqual({
      ok: false,
      status: 422,
      code: "INCOMPLETE",
      details: { missing: ["photo"] },
    });
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("delete the uploaded photo when the page changed meanwhile", async () => {
    h.page = livePage();
    h.updateResult = null;
    expect(await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "professional" })).toMatchObject({ code: "CONFLICT" });
    expect(h.deleteOne).toEqual([{ _id: "f-new", kind: "showcase-photo" }]);
    expect(h.deleteMany).toEqual([]);
  });
});

describe("publishShowcase", () => {
  beforeEach(() => {
    h.page = page();
    h.updateResult = { draft: { photoFileId: "f-draft" }, published: { photoFileId: "f-draft" } };
  });

  it("publishes exactly the revision the admin looked at", async () => {
    const result = await publishShowcase({ userId: PRO, revision: 4, consentAttested: undefined, adminId: ADMIN });
    expect(result).toMatchObject({ ok: true, value: { publicUrl: "https://www.jechemine.ca/sassi" } });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", draftRevision: 4 });
    expect(update.$set).toMatchObject({
      published: completeDraft,
      publishedRevision: 4,
      publishedBy: ADMIN,
      status: "published",
      "review.state": "none",
    });
    expect(update.$set).not.toHaveProperty("consent");
    expect(update.$unset).toEqual({ unpublishedAt: "", unpublishedBy: "" });
    expect(update.$set).not.toHaveProperty("cityKey");
  });

  it("needs the professional's agreement, and records the one an admin confirms in the admin's name", async () => {
    h.page = page({ consent: undefined });
    expect(await publishShowcase({ userId: PRO, revision: 4, consentAttested: undefined, adminId: ADMIN })).toMatchObject({
      status: 409,
      code: "CONSENT_REQUIRED",
    });
    expect(await publishShowcase({ userId: PRO, revision: 4, consentAttested: "true", adminId: ADMIN })).toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    expect(h.findOneAndUpdate).toEqual([]);

    expect(await publishShowcase({ userId: PRO, revision: 4, consentAttested: true, adminId: ADMIN })).toMatchObject({ ok: true });
    const [, update] = h.findOneAndUpdate[0];
    expect(update.$set).toMatchObject({
      consent: { version: SHOWCASE_CONSENT_VERSION, source: "admin", attestedBy: ADMIN, acceptedAt: expect.any(Date) },
    });
    expect(update.$push).toMatchObject({ history: { $each: [{ action: "approve", note: "revision 4 · consent attested" }] } });
  });

  it("publishes a page still marked invited from before the change", async () => {
    h.page = page({ status: "invited" });
    expect(await publishShowcase({ userId: PRO, revision: 4, consentAttested: undefined, adminId: ADMIN })).toMatchObject({ ok: true });
  });

  it("takes the city the office address names now, from the city it was decided on — never one the draft names", async () => {
    h.page = page({
      status: "published",
      publishedAt: new Date("2026-09-01"),
      publishedRevision: 2,
      published: { ...completeDraft },
      draft: { ...completeDraft, cityKey: "berthierville" },
    });
    h.profile = { ...completeProfile, officeAddress: { city: "Terrebonne, QC" } };
    const result = await publishShowcase({ userId: PRO, revision: 4, consentAttested: undefined, adminId: ADMIN });
    expect(result).toMatchObject({ ok: true, value: { publicUrl: "https://www.jechemine.ca/sassi" } });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", draftRevision: 4, cityKey: "mascouche" });
    expect(update.$set).toMatchObject({ cityKey: "terrebonne" });
    expect(update.$push).toMatchObject({ history: { $each: [{ action: "approve", note: "revision 4 · mascouche > terrebonne" }] } });
    await runDeferred(result);
    expect(h.sendPublished).toHaveBeenCalledWith(
      expect.objectContaining({ publicUrl: "https://www.jechemine.ca/sassi", firstPublication: false }),
    );
  });

  it("refuses another revision, an inactive professional, an incomplete page and a page the professional took down — without writing", async () => {
    const publish = (revision: unknown) => publishShowcase({ userId: PRO, revision, consentAttested: true, adminId: ADMIN });
    expect(await publish(3)).toEqual({ ok: false, status: 409, code: "REVISION_CHANGED", details: { draftRevision: 4 } });
    expect(await publish("4")).toMatchObject({ code: "REVISION_CHANGED" });
    h.user = { ...activePro, status: "inactive" };
    expect(await publish(4)).toMatchObject({ code: "PROFESSIONAL_NOT_ACTIVE" });
    h.user = { ...activePro };
    h.profile = { ...completeProfile, modalities: [] };
    expect(await publish(4)).toMatchObject({ status: 422, details: { missing: ["modalities"] } });
    h.profile = { ...completeProfile, officeAddress: { city: "Atlantis" } };
    expect(await publish(4)).toMatchObject({ status: 422, details: { missing: ["city"] } });
    h.profile = { ...completeProfile };
    h.page = page({ status: "unpublished", unpublishedBy: "professional", published: completeDraft, publishedRevision: 2 });
    expect(await publish(4)).toMatchObject({ code: "WITHDRAWN_BY_PROFESSIONAL" });
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("deletes the photo the page stops showing, and only that one", async () => {
    h.page = page({ status: "published", publishedRevision: 2, published: { ...completeDraft, photoFileId: "f-old" } });
    await publishShowcase({ userId: PRO, revision: 4, consentAttested: undefined, adminId: ADMIN });
    expect(h.deleteMany).toEqual([{ _id: { $in: ["f-old"] }, kind: "showcase-photo" }]);

    h.deleteMany = [];
    h.findOneAndUpdate = [];
    h.page = page({ status: "published", publishedRevision: 2, published: { ...completeDraft } });
    await publishShowcase({ userId: PRO, revision: 4, consentAttested: undefined, adminId: ADMIN });
    expect(h.deleteMany).toEqual([]);
  });

  it("tells the professional without a public address while the pages are not open", async () => {
    h.enabled = false;
    await runDeferred(await publishShowcase({ userId: PRO, revision: 4, consentAttested: undefined, adminId: ADMIN }));
    expect(h.sendPublished).toHaveBeenCalledWith(
      expect.objectContaining({ live: false, firstPublication: true, professionalEmail: "amel@exemple.ca" }),
    );
  });
});

describe("taking a page down and putting it back", () => {
  it("the professional takes it down without an email; an admin tells them why", async () => {
    h.page = livePage();
    const own = await unpublishShowcase({ userId: PRO, actor: "professional", byUserId: PRO });
    expect(h.findOneAndUpdate[0][0]).toEqual({ _id: "p1", status: "published" });
    expect(h.findOneAndUpdate[0][1].$set).toMatchObject({ status: "unpublished", unpublishedBy: "professional" });
    expect(own.ok && own.deferred).toEqual([]);

    const byAdmin = await unpublishShowcase({ userId: PRO, actor: "admin", byUserId: ADMIN, note: "Numéro de permis à corriger" });
    await runDeferred(byAdmin);
    expect(h.sendUnpublished).toHaveBeenCalledWith(expect.objectContaining({ note: "Numéro de permis à corriger" }));
  });

  it("an admin cannot put back a page the professional took down; the professional can", async () => {
    h.page = livePage({ status: "unpublished", unpublishedBy: "professional" });
    expect(await republishShowcase({ userId: PRO, actor: "admin", byUserId: ADMIN })).toMatchObject({
      code: "WITHDRAWN_BY_PROFESSIONAL",
    });
    expect(h.findOneAndUpdate).toEqual([]);
    expect(await republishShowcase({ userId: PRO, actor: "professional", byUserId: PRO })).toMatchObject({ ok: true });
    expect(h.findOneAndUpdate[0][0]).toEqual({ _id: "p1", status: "unpublished", unpublishedBy: "professional" });
    expect(h.findOneAndUpdate[0][1].$set).toEqual({ status: "published" });
  });

  it("a page put back online takes the city the office address names now", async () => {
    h.page = livePage({ status: "unpublished", unpublishedBy: "admin" });
    h.profile = { ...completeProfile, officeAddress: { city: "Terrebonne" } };
    expect(await republishShowcase({ userId: PRO, actor: "admin", byUserId: ADMIN })).toMatchObject({ ok: true });
    expect(h.findOneAndUpdate[0][1].$set).toEqual({ status: "published", cityKey: "terrebonne" });
  });
});

describe("setShowcasePhoto by an admin", () => {
  it("replacing the draft photo deletes the old one, unless the published page shows it", async () => {
    h.updateResult = { _id: "p1", status: "draft", draft: { photoFileId: "f-old" }, published: { photoFileId: "f-pub" } };
    await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "admin" });
    expect(h.findOneAndUpdate[0][2]).toEqual({ new: false });
    expect(h.findOneAndUpdate[0][1].$set).not.toHaveProperty("published.photoFileId");
    expect(h.deleteMany).toEqual([{ _id: { $in: ["f-old"] }, kind: "showcase-photo" }]);

    h.deleteMany = [];
    h.updateResult = { _id: "p1", status: "published", draft: { photoFileId: "f-pub" }, published: { photoFileId: "f-pub" } };
    await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "admin" });
    expect(h.deleteMany).toEqual([]);
  });

  it("deletes the uploaded file when there is no page to put it on", async () => {
    h.updateResult = null;
    expect(await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "admin" })).toMatchObject({ status: 404 });
    expect(h.deleteOne).toEqual([{ _id: "f-new", kind: "showcase-photo" }]);
  });
});

describe("moveShowcase", () => {
  it("keeps the old slug answering once the page has been public", async () => {
    h.page = page({ status: "published", publishedAt: new Date("2026-09-01"), previousSlugs: ["amel-sassi"] });
    expect(await moveShowcase({ userId: PRO, slug: "dre-sassi", adminId: ADMIN })).toMatchObject({
      ok: true,
      value: { slug: "dre-sassi" },
    });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", slug: "sassi" });
    expect(update.$set).toEqual({ slug: "dre-sassi", previousSlugs: ["amel-sassi", "sassi"] });
    expect(update.$push).toMatchObject({ history: { $each: [{ action: "move", note: "sassi > dre-sassi" }] } });
  });

  it("leaves no former slug for a page never published, and can move back to a former slug", async () => {
    h.page = page({ previousSlugs: ["dre-sassi"] });
    await moveShowcase({ userId: PRO, slug: "dre-sassi", adminId: ADMIN });
    expect(h.findOneAndUpdate[0][1].$set).toEqual({ slug: "dre-sassi", previousSlugs: [] });
  });

  it("never sets the city, and writes nothing for the same address", async () => {
    h.page = page();
    const sameAddress = { userId: PRO, slug: "sassi", cityKey: "terrebonne", adminId: ADMIN } as Parameters<typeof moveShowcase>[0];
    expect(await moveShowcase(sameAddress)).toEqual({ ok: true, value: { slug: "sassi" }, deferred: [] });
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("refuses a slug in use and a reserved slug", async () => {
    h.page = page();
    h.taken = [{ slug: "dre-sassi", previousSlugs: [] }];
    expect(await moveShowcase({ userId: PRO, slug: "dre-sassi", adminId: ADMIN })).toMatchObject({ code: "SLUG_TAKEN" });
    h.taken = [];
    expect(await moveShowcase({ userId: PRO, slug: "specialite", adminId: ADMIN })).toMatchObject({ code: "INVALID_SLUG" });
    expect(h.findOneAndUpdate).toEqual([]);
  });
});

describe("office photos", () => {
  const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const C = "cccccccccccccccccccccccc";

  it("the professional sets it on the live page at once, on the revision read, and the team is told", async () => {
    h.page = livePage();
    const result = await setShowcaseOfficePhoto({ userId: PRO, fileId: B, actor: "professional" });
    expect(result).toMatchObject({ ok: true, value: { officePhotos: [{ id: B, url: `/api/files/${B}` }] } });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", draftRevision: 4 });
    expect(update.$set).toMatchObject({
      "draft.officePhotoFileIds": [B],
      "published.officePhotoFileIds": [B],
      draftRevision: 5,
      publishedRevision: 5,
    });
    expect(update.$push).toMatchObject({ history: { $each: [{ action: "edit", note: "officePhotos" }] } });
    expect(h.deleteMany).toEqual([]);
    await runDeferred(result);
    expect(h.sendUpdated).toHaveBeenCalledWith(expect.objectContaining({ fields: ["officePhotos"] }));
  });

  it("a new photo replaces the one shown, and older extras, and their files go (one photo since 2026-09-18)", async () => {
    h.page = livePage({ draft: { ...completeDraft, officePhotoFileIds: [A, B] }, published: { ...completeDraft, officePhotoFileIds: [A, B] } });
    const result = await setShowcaseOfficePhoto({ userId: PRO, fileId: C, actor: "professional" });
    expect(result).toMatchObject({ ok: true, value: { officePhotos: [{ id: C }] } });
    expect(h.findOneAndUpdate[0][1].$set).toMatchObject({ "draft.officePhotoFileIds": [C], "published.officePhotoFileIds": [C] });
    expect(h.deleteMany).toEqual([{ _id: { $in: [A, B] }, kind: "showcase-photo" }]);
  });

  it("an admin sets it on the draft only, without telling the team", async () => {
    h.page = page({ status: "published", published: { ...completeDraft }, publishedRevision: 4 });
    const result = await setShowcaseOfficePhoto({ userId: PRO, fileId: A, actor: "admin" });
    expect(result).toMatchObject({ ok: true, deferred: [] });
    const update = h.findOneAndUpdate[0][1];
    expect(update.$set).toMatchObject({ "draft.officePhotoFileIds": [A], draftUpdatedBy: "admin" });
    expect(update.$set).not.toHaveProperty("published.officePhotoFileIds");
    expect(update.$set).not.toHaveProperty("publishedRevision");
    expect(update).not.toHaveProperty("$push");
  });

  it("deletes the uploaded file when it cannot be set: page in preparation, page changed", async () => {
    h.page = page();
    expect(await setShowcaseOfficePhoto({ userId: PRO, fileId: A, actor: "professional" })).toMatchObject({ code: "IN_PREPARATION" });
    h.page = livePage();
    h.updateResult = null;
    expect(await setShowcaseOfficePhoto({ userId: PRO, fileId: C, actor: "professional" })).toMatchObject({ code: "CONFLICT" });
    expect(h.deleteOne).toEqual([
      { _id: A, kind: "showcase-photo" },
      { _id: C, kind: "showcase-photo" },
    ]);
  });

  it("removing it clears the photo, older extras included, and deletes the files only once neither copy shows them", async () => {
    h.page = livePage({ draft: { ...completeDraft, officePhotoFileIds: [A, B] }, published: { ...completeDraft, officePhotoFileIds: [A, B] } });
    await removeShowcaseOfficePhoto({ userId: PRO, fileId: A, actor: "professional" });
    expect(h.findOneAndUpdate[0][1].$set).toMatchObject({ "draft.officePhotoFileIds": [], "published.officePhotoFileIds": [] });
    expect(h.deleteMany).toEqual([{ _id: { $in: [A, B] }, kind: "showcase-photo" }]);

    // An admin removing it from the draft of a live page: the public copy still shows it until they publish.
    h.findOneAndUpdate = [];
    h.deleteMany = [];
    h.page = page({ status: "published", draft: { ...completeDraft, officePhotoFileIds: [A] }, published: { ...completeDraft, officePhotoFileIds: [A] }, publishedRevision: 4 });
    await removeShowcaseOfficePhoto({ userId: PRO, fileId: A, actor: "admin" });
    expect(h.findOneAndUpdate[0][1].$set).toMatchObject({ "draft.officePhotoFileIds": [] });
    expect(h.deleteMany).toEqual([]);
  });

  it("refuses to remove a photo the page does not have", async () => {
    h.page = livePage({ draft: { ...completeDraft, officePhotoFileIds: [A] }, published: { ...completeDraft, officePhotoFileIds: [A] } });
    expect(await removeShowcaseOfficePhoto({ userId: PRO, fileId: "dddddddddddddddddddddddd", actor: "professional" })).toMatchObject({
      status: 404,
      code: "OFFICE_PHOTO_NOT_FOUND",
    });
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("publishing deletes an office photo the public copy stops showing, unless the draft still has it", async () => {
    h.page = page({
      status: "published",
      publishedRevision: 2,
      published: { ...completeDraft, officePhotoFileIds: [A, B] },
      draft: { ...completeDraft, officePhotoFileIds: [B] },
    });
    h.updateResult = { draft: { photoFileId: "f-draft", officePhotoFileIds: [B] }, published: { photoFileId: "f-draft", officePhotoFileIds: [B] } };
    await publishShowcase({ userId: PRO, revision: 4, consentAttested: undefined, adminId: ADMIN });
    expect(h.deleteMany).toEqual([{ _id: { $in: [A] }, kind: "showcase-photo" }]);
  });
});

describe("updateShowcaseServices", () => {
  it("takes booleans only", async () => {
    expect(await updateShowcaseServices({ userId: PRO, body: { quick: "yes" } })).toMatchObject({ code: "INVALID_FIELD" });
    expect(await updateShowcaseServices({ userId: PRO, body: {} })).toMatchObject({ code: "NOTHING_TO_SAVE" });
    h.updateResult = { services: { standard: false, quick: true } };
    expect(await updateShowcaseServices({ userId: PRO, body: { standard: false, quick: true } })).toMatchObject({
      ok: true,
      value: { standard: false, quick: true },
    });
    expect(h.findOneAndUpdate[0][1]).toEqual({ $set: { "services.standard": false, "services.quick": true } });
  });
});

/**
 * Phase 3b: « Ma page vitrine » says what the page's « Disponibilités » shows, read the way the page
 * reads it — and reads nothing until the professional switched it on, the page is online and their
 * hours are their own.
 */
describe("loadShowcaseEditor — « Disponibilités »", () => {
  const STANDARD = { service: "standard", minutes: 50, price: 195, first: { day: "2026-09-22", time: "13:00" } };
  const hours = {
    days: [
      { day: "Thursday", isWorkDay: true, startTime: "13:00", endTime: "17:00" },
      { day: "Monday", isWorkDay: false, startTime: "09:00", endTime: "17:00" },
      { day: "Tuesday", isWorkDay: true, startTime: "13:00", endTime: "17:00" },
    ],
    sessionDurationMinutes: 50,
    breakDurationMinutes: 10,
  };

  beforeEach(() => {
    h.enabled = true;
    h.page = page({ status: "published", published: completeDraft, publishedRevision: 4, services: { standard: true, quick: false } });
    h.profile = { availability: hours, availabilityConfirmedAt: new Date("2026-09-18T12:00:00Z"), quickConsultation: { durationMinutes: 30 } };
    h.bookingReads = [];
    h.bookingOptions = [STANDARD];
  });

  it("shows what the page offers, with the hours the professional saved", async () => {
    const view = (await loadShowcaseEditor(PRO))!;
    expect(h.bookingReads).toEqual(["sassi"]);
    expect(view.page.services).toEqual({ standard: true, quick: false });
    expect(view.availability).toEqual({
      hoursConfirmedAt: new Date("2026-09-18T12:00:00Z"),
      week: [
        { day: "Tuesday", start: "13:00", end: "17:00" },
        { day: "Thursday", start: "13:00", end: "17:00" },
      ],
      sessionMinutes: 50,
      quickMinutes: 30,
      options: [STANDARD],
    });
  });

  it("reads no time while switched off, and calls a page never switched on off", async () => {
    h.page = page({ status: "published", published: completeDraft, services: undefined });
    const view = (await loadShowcaseEditor(PRO))!;
    expect(view.page.services).toEqual({ standard: false, quick: false });
    expect(view.availability.options).toEqual([]);
    expect(h.bookingReads).toEqual([]);
  });

  it("reads no time on hours the professional never saved themselves", async () => {
    h.profile = { availability: hours };
    const view = (await loadShowcaseEditor(PRO))!;
    expect(view.availability).toMatchObject({ hoursConfirmedAt: null, options: [] });
    expect(h.bookingReads).toEqual([]);
  });

  it("reads no time for a page that is not online", async () => {
    h.page = page({ status: "unpublished", published: completeDraft, services: { standard: true, quick: false } });
    expect((await loadShowcaseEditor(PRO))!.availability.options).toEqual([]);
    h.page = page({ status: "published", published: completeDraft, services: { standard: true, quick: false } });
    h.enabled = false;
    expect((await loadShowcaseEditor(PRO))!.availability.options).toEqual([]);
    expect(h.bookingReads).toEqual([]);
  });

  it("still opens the editor when the times cannot be read", async () => {
    h.bookingOptions = new Error("database down");
    const view = await loadShowcaseEditor(PRO);
    expect(view?.availability.options).toEqual([]);
  });
});

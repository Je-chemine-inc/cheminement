/**
 * Spec 003 — the changes to a showcase page. What must hold: nothing is
 * published without the professional's current consent and an admin
 * approving the exact revision they saw; every change is a conditional write
 * on the state it was decided from; emails go out only after the response;
 * a photo is deleted only when no copy of the page shows it.
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
    createError: null as unknown,
    enabled: true,
    created: [] as Record<string, unknown>[],
    updateOne: [] as [Record<string, unknown>, Record<string, unknown>][],
    findOneAndUpdate: [] as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>][],
    deleteMany: [] as Record<string, unknown>[],
    deleteOne: [] as Record<string, unknown>[],
    sendInvitation: vi.fn<[Record<string, unknown>], Promise<boolean>>(async () => true),
    sendAdminAlert: vi.fn<[Record<string, unknown>], Promise<undefined>>(async () => undefined),
    sendPublished: vi.fn<[Record<string, unknown>], Promise<boolean>>(async () => true),
    sendChanges: vi.fn<[Record<string, unknown>], Promise<boolean>>(async () => true),
    sendUnpublished: vi.fn<[Record<string, unknown>], Promise<boolean>>(async () => true),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
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
      return h.chain(() => h.updateResult);
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
vi.mock("@/lib/notifications", () => ({
  sendShowcaseInvitationEmail: h.sendInvitation,
  sendAdminShowcaseSubmittedAlert: h.sendAdminAlert,
  sendShowcasePublishedEmail: h.sendPublished,
  sendShowcaseChangesRequestedEmail: h.sendChanges,
  sendShowcaseUnpublishedEmail: h.sendUnpublished,
}));

import {
  approveShowcase,
  inviteToShowcase,
  moveShowcase,
  remindShowcase,
  republishShowcase,
  requestShowcaseChanges,
  saveShowcaseDraft,
  setShowcasePhoto,
  submitShowcase,
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
const completeProfile = { specialty: "psychologist", license: "12345-67", modalities: ["Video Call"], languages: ["french"] };
const activePro = { firstName: "Amel", lastName: "Sassi", email: "amel@exemple.ca", language: "fr", status: "active", adminApproved: true };

function page(over: Record<string, unknown> = {}) {
  return {
    _id: "p1",
    userId: PRO,
    slug: "sassi",
    previousSlugs: [],
    cityKey: "mascouche",
    status: "draft",
    review: { state: "none" },
    draft: completeDraft,
    draftRevision: 4,
    services: { standard: true, quick: false },
    consent: { version: SHOWCASE_CONSENT_VERSION },
    ...over,
  };
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
  h.createError = null;
  h.enabled = true;
  h.created = [];
  h.updateOne = [];
  h.findOneAndUpdate = [];
  h.deleteMany = [];
  h.deleteOne = [];
  for (const send of [h.sendInvitation, h.sendAdminAlert, h.sendPublished, h.sendChanges, h.sendUnpublished]) {
    send.mockClear();
  }
});

describe("inviteToShowcase", () => {
  it("invites an active professional with a free slug, their city and a prefilled draft; emails after the response", async () => {
    h.profile = { specialty: "psychologist", problematics: ["anxiete", "Perte"], bio: " Mon parcours. ", officeAddress: { city: "Mascouche, QC" } };
    h.taken = [{ slug: "sassi", previousSlugs: [] }];
    const result = await inviteToShowcase({ userId: PRO, adminId: ADMIN });
    expect(result).toMatchObject({ ok: true, value: { slug: "amel-sassi", cityKey: "mascouche" } });
    expect(h.created[0]).toMatchObject({
      userId: PRO,
      slug: "amel-sassi",
      cityKey: "mascouche",
      status: "invited",
      invitedBy: ADMIN,
      draft: { displayName: "Amel Sassi", bio: { fr: "Mon parcours.", en: "" }, expertiseIds: ["e1", "e2"], orderCode: "OPQ" },
    });
    expect(h.sendInvitation).not.toHaveBeenCalled();
    await runDeferred(result);
    expect(h.sendInvitation).toHaveBeenCalledWith({
      professionalName: "Amel Sassi",
      professionalEmail: "amel@exemple.ca",
      cityName: "Mascouche",
      locale: "fr",
    });
  });

  it("refuses a professional whose account is not active and approved", async () => {
    h.user = { ...activePro, status: "pending" };
    expect(await inviteToShowcase({ userId: PRO, cityKey: "mascouche", adminId: ADMIN })).toMatchObject({
      ok: false,
      status: 409,
      code: "PROFESSIONAL_NOT_ACTIVE",
    });
    h.user = { ...activePro, adminApproved: false };
    expect(await inviteToShowcase({ userId: PRO, cityKey: "mascouche", adminId: ADMIN })).toMatchObject({
      code: "PROFESSIONAL_NOT_ACTIVE",
    });
    expect(h.created).toEqual([]);
  });

  it("refuses an unknown city, a second invitation, a slug in use (even a former one) and a reserved slug", async () => {
    expect(await inviteToShowcase({ userId: PRO, cityKey: "atlantis", adminId: ADMIN })).toMatchObject({ code: "INVALID_CITY" });
    h.exists = true;
    expect(await inviteToShowcase({ userId: PRO, cityKey: "mascouche", adminId: ADMIN })).toMatchObject({ code: "ALREADY_INVITED" });
    h.exists = false;
    h.taken = [{ slug: "autre", previousSlugs: ["sassi"] }];
    expect(await inviteToShowcase({ userId: PRO, cityKey: "mascouche", slug: "sassi", adminId: ADMIN })).toMatchObject({
      status: 409,
      code: "SLUG_TAKEN",
    });
    expect(await inviteToShowcase({ userId: PRO, cityKey: "mascouche", slug: "API", adminId: ADMIN })).toMatchObject({
      status: 400,
      code: "INVALID_SLUG",
    });
    expect(h.created).toEqual([]);
  });
});

describe("saveShowcaseDraft", () => {
  it("writes only allowlisted fields, bumps the revision and moves an invited page to draft", async () => {
    h.page = page({ status: "invited" });
    const result = await saveShowcaseDraft({
      userId: PRO,
      body: { headline: { fr: "Psychologue" }, status: "published", slug: "pirate", published: { displayName: "X" } },
      actor: "professional",
    });
    expect(result.ok).toBe(true);
    const [filter, update] = h.updateOne[0];
    expect(filter).toEqual({ _id: "p1" });
    expect(update).toMatchObject({
      $set: { "draft.headline": { fr: "Psychologue", en: "" }, draftUpdatedBy: "professional", status: "draft" },
      $inc: { draftRevision: 1 },
    });
    const set = update.$set as Record<string, unknown>;
    expect(Object.keys(set).sort()).toEqual(["draft.headline", "draftUpdatedAt", "draftUpdatedBy", "status"]);
  });

  it("refuses an expertise that is not offered on pages, and a page that does not exist", async () => {
    h.page = page();
    expect(await saveShowcaseDraft({ userId: PRO, body: { expertiseIds: ["zz"] }, actor: "professional" })).toEqual({
      ok: false,
      status: 400,
      code: "UNKNOWN_EXPERTISE",
      details: { field: "expertiseIds" },
    });
    h.page = null;
    expect(await saveShowcaseDraft({ userId: PRO, body: { displayName: "X" }, actor: "admin" })).toMatchObject({ status: 404 });
    expect(h.updateOne).toEqual([]);
  });
});

describe("submitShowcase", () => {
  it("needs the current consent, and a complete page", async () => {
    h.page = page();
    expect(await submitShowcase({ userId: PRO, consent: true, consentVersion: "showcase-2020-01" })).toMatchObject({
      status: 400,
      code: "CONSENT_REQUIRED",
    });
    expect(await submitShowcase({ userId: PRO, consent: "yes", consentVersion: SHOWCASE_CONSENT_VERSION })).toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    h.page = page({ draft: { ...completeDraft, photoFileId: undefined } });
    h.profile = { ...completeProfile, license: "" };
    expect(await submitShowcase({ userId: PRO, consent: true, consentVersion: SHOWCASE_CONSENT_VERSION })).toEqual({
      ok: false,
      status: 422,
      code: "INCOMPLETE",
      details: { missing: ["photo", "license"] },
    });
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("submits once, records the consent, and alerts the team after the response", async () => {
    h.page = page();
    const result = await submitShowcase({ userId: PRO, consent: true, consentVersion: SHOWCASE_CONSENT_VERSION });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", "review.state": { $ne: "pending" } });
    expect(update.$set).toMatchObject({
      "review.state": "pending",
      consent: { version: SHOWCASE_CONSENT_VERSION },
    });
    expect(h.sendAdminAlert).not.toHaveBeenCalled();
    await runDeferred(result);
    expect(h.sendAdminAlert).toHaveBeenCalledWith({
      professionalName: "Amel Sassi",
      professionalId: PRO,
      cityName: "Mascouche",
      resubmission: false,
    });
  });

  it("refuses a page already waiting for review, before writing, and a lost race", async () => {
    h.page = page({ review: { state: "pending" } });
    expect(await submitShowcase({ userId: PRO, consent: true, consentVersion: SHOWCASE_CONSENT_VERSION })).toMatchObject({
      status: 409,
      code: "ALREADY_SUBMITTED",
    });
    expect(h.findOneAndUpdate).toEqual([]);
    h.page = page();
    h.updateResult = null;
    expect(await submitShowcase({ userId: PRO, consent: true, consentVersion: SHOWCASE_CONSENT_VERSION })).toMatchObject({
      code: "ALREADY_SUBMITTED",
    });
  });
});

describe("approveShowcase", () => {
  beforeEach(() => {
    h.page = page({ review: { state: "pending" } });
    h.updateResult = { draft: { photoFileId: "f-draft" }, published: { photoFileId: "f-draft" } };
  });

  it("publishes exactly the revision the admin looked at", async () => {
    const result = await approveShowcase({ userId: PRO, revision: 4, adminId: ADMIN });
    expect(result).toMatchObject({ ok: true, value: { publicUrl: "https://psymascouche.jechemine.ca/sassi" } });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", draftRevision: 4 });
    expect(update.$set).toMatchObject({
      published: completeDraft,
      publishedRevision: 4,
      publishedBy: ADMIN,
      status: "published",
      "review.state": "none",
    });
    expect(update.$unset).toEqual({ unpublishedAt: "", unpublishedBy: "" });
  });

  it("refuses another revision, a missing consent, an inactive professional or an incomplete page — without writing", async () => {
    expect(await approveShowcase({ userId: PRO, revision: 3, adminId: ADMIN })).toEqual({
      ok: false,
      status: 409,
      code: "REVISION_CHANGED",
      details: { draftRevision: 4 },
    });
    expect(await approveShowcase({ userId: PRO, revision: "4", adminId: ADMIN })).toMatchObject({ code: "REVISION_CHANGED" });
    h.page = page({ review: { state: "pending" }, consent: { version: "showcase-2020-01" } });
    expect(await approveShowcase({ userId: PRO, revision: 4, adminId: ADMIN })).toMatchObject({ code: "CONSENT_REQUIRED" });
    h.page = page({ review: { state: "pending" } });
    h.user = { ...activePro, status: "inactive" };
    expect(await approveShowcase({ userId: PRO, revision: 4, adminId: ADMIN })).toMatchObject({ code: "PROFESSIONAL_NOT_ACTIVE" });
    h.user = { ...activePro };
    h.profile = { ...completeProfile, modalities: [] };
    expect(await approveShowcase({ userId: PRO, revision: 4, adminId: ADMIN })).toMatchObject({
      status: 422,
      details: { missing: ["modalities"] },
    });
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("deletes the photo the page stops showing, and only that one", async () => {
    h.page = page({ review: { state: "pending" }, status: "published", publishedRevision: 2, published: { ...completeDraft, photoFileId: "f-old" } });
    await approveShowcase({ userId: PRO, revision: 4, adminId: ADMIN });
    expect(h.deleteMany).toEqual([{ _id: { $in: ["f-old"] }, kind: "showcase-photo" }]);

    h.deleteMany = [];
    h.findOneAndUpdate = [];
    h.page = page({ review: { state: "pending" }, status: "published", publishedRevision: 2, published: { ...completeDraft } });
    await approveShowcase({ userId: PRO, revision: 4, adminId: ADMIN });
    expect(h.deleteMany).toEqual([]);
  });

  it("says the page is approved, without a public address, while the pages are not open", async () => {
    h.enabled = false;
    await runDeferred(await approveShowcase({ userId: PRO, revision: 4, adminId: ADMIN }));
    expect(h.sendPublished).toHaveBeenCalledWith(
      expect.objectContaining({ live: false, firstPublication: true, professionalEmail: "amel@exemple.ca" }),
    );
  });
});

describe("requestShowcaseChanges", () => {
  it("needs comments, and a page waiting for review", async () => {
    h.page = page({ review: { state: "pending" } });
    expect(await requestShowcaseChanges({ userId: PRO, notes: "  ", adminId: ADMIN })).toMatchObject({ code: "NOTES_REQUIRED" });
    h.page = page();
    expect(await requestShowcaseChanges({ userId: PRO, notes: "La photo est floue.", adminId: ADMIN })).toMatchObject({
      code: "NOT_SUBMITTED",
    });
    expect(h.findOneAndUpdate).toEqual([]);
  });

  it("records the comments and sends them to the professional", async () => {
    h.page = page({ review: { state: "pending" } });
    const result = await requestShowcaseChanges({ userId: PRO, notes: "La photo est floue.", adminId: ADMIN });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", "review.state": "pending" });
    expect(update.$set).toMatchObject({ "review.state": "changes_requested", "review.notes": "La photo est floue." });
    await runDeferred(result);
    expect(h.sendChanges).toHaveBeenCalledWith(expect.objectContaining({ notes: "La photo est floue." }));
  });
});

describe("taking a page down and putting it back", () => {
  it("the professional takes it down without an email; an admin tells them why", async () => {
    h.page = page({ status: "published", published: completeDraft, publishedRevision: 4 });
    const own = await unpublishShowcase({ userId: PRO, actor: "professional", byUserId: PRO });
    expect(h.findOneAndUpdate[0][0]).toEqual({ _id: "p1", status: "published" });
    expect(h.findOneAndUpdate[0][1].$set).toMatchObject({ status: "unpublished", unpublishedBy: "professional" });
    expect(own.ok && own.deferred).toEqual([]);

    const byAdmin = await unpublishShowcase({ userId: PRO, actor: "admin", byUserId: ADMIN, note: "Numéro de permis à corriger" });
    await runDeferred(byAdmin);
    expect(h.sendUnpublished).toHaveBeenCalledWith(expect.objectContaining({ note: "Numéro de permis à corriger" }));
  });

  it("an admin cannot put back a page the professional took down; the professional can", async () => {
    h.page = page({ status: "unpublished", unpublishedBy: "professional", published: completeDraft, publishedRevision: 4 });
    expect(await republishShowcase({ userId: PRO, actor: "admin", byUserId: ADMIN })).toMatchObject({
      code: "WITHDRAWN_BY_PROFESSIONAL",
    });
    expect(h.findOneAndUpdate).toEqual([]);
    expect(await republishShowcase({ userId: PRO, actor: "professional", byUserId: PRO })).toMatchObject({ ok: true });
    expect(h.findOneAndUpdate[0][0]).toEqual({ _id: "p1", status: "unpublished", unpublishedBy: "professional" });
  });
});

describe("remindShowcase", () => {
  it("reminds at most once a day, with a conditional write", async () => {
    h.page = page({ status: "invited", remindedAt: new Date(Date.now() - 2 * 3600 * 1000) });
    expect(await remindShowcase({ userId: PRO, adminId: ADMIN })).toMatchObject({ code: "REMINDED_RECENTLY" });
    expect(h.findOneAndUpdate).toEqual([]);

    h.page = page({ status: "invited", remindedAt: new Date(Date.now() - 48 * 3600 * 1000) });
    const result = await remindShowcase({ userId: PRO, adminId: ADMIN });
    expect(h.findOneAndUpdate[0][0]).toMatchObject({ _id: "p1", status: { $in: ["invited", "draft"] } });
    expect(h.findOneAndUpdate[0][0]).toHaveProperty("$or");
    await runDeferred(result);
    expect(h.sendInvitation).toHaveBeenCalledWith(expect.objectContaining({ reminder: true }));
  });
});

describe("setShowcasePhoto", () => {
  it("replacing the draft photo deletes the old one, unless the published page shows it", async () => {
    h.updateResult = { _id: "p1", status: "draft", draft: { photoFileId: "f-old" }, published: { photoFileId: "f-pub" } };
    await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "professional" });
    expect(h.findOneAndUpdate[0][2]).toEqual({ new: false });
    expect(h.deleteMany).toEqual([{ _id: { $in: ["f-old"] }, kind: "showcase-photo" }]);

    h.deleteMany = [];
    h.updateResult = { _id: "p1", status: "published", draft: { photoFileId: "f-pub" }, published: { photoFileId: "f-pub" } };
    await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "professional" });
    expect(h.deleteMany).toEqual([]);
  });

  it("deletes the uploaded file when there is no page to put it on", async () => {
    h.updateResult = null;
    expect(await setShowcasePhoto({ userId: PRO, fileId: "f-new", actor: "professional" })).toMatchObject({ status: 404 });
    expect(h.deleteOne).toEqual([{ _id: "f-new", kind: "showcase-photo" }]);
  });
});

describe("moveShowcase", () => {
  it("keeps the old slug answering once the page has been public", async () => {
    h.page = page({ status: "published", publishedAt: new Date("2026-09-01"), previousSlugs: ["amel-sassi"] });
    expect(await moveShowcase({ userId: PRO, slug: "dre-sassi", adminId: ADMIN })).toMatchObject({
      ok: true,
      value: { slug: "dre-sassi", cityKey: "mascouche" },
    });
    const [filter, update] = h.findOneAndUpdate[0];
    expect(filter).toEqual({ _id: "p1", slug: "sassi", cityKey: "mascouche" });
    expect(update.$set).toMatchObject({ slug: "dre-sassi", previousSlugs: ["amel-sassi", "sassi"] });
  });

  it("leaves no former slug for a page never published, and can move back to a former slug", async () => {
    h.page = page({ previousSlugs: ["dre-sassi"] });
    await moveShowcase({ userId: PRO, slug: "dre-sassi", cityKey: "terrebonne", adminId: ADMIN });
    expect(h.findOneAndUpdate[0][1].$set).toMatchObject({ slug: "dre-sassi", cityKey: "terrebonne", previousSlugs: [] });
  });

  it("refuses a slug in use, an unknown city and a reserved slug", async () => {
    h.page = page();
    h.taken = [{ slug: "dre-sassi", previousSlugs: [] }];
    expect(await moveShowcase({ userId: PRO, slug: "dre-sassi", adminId: ADMIN })).toMatchObject({ code: "SLUG_TAKEN" });
    expect(await moveShowcase({ userId: PRO, cityKey: "atlantis", adminId: ADMIN })).toMatchObject({ code: "INVALID_CITY" });
    h.taken = [];
    expect(await moveShowcase({ userId: PRO, slug: "specialite", adminId: ADMIN })).toMatchObject({ code: "INVALID_SLUG" });
    expect(h.findOneAndUpdate).toEqual([]);
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

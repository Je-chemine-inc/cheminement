/**
 * Professionals' products (spec 003 phase 5): creating, editing, sending for
 * review, the team's decision, going live, deleting, and a sale reaching the
 * professional. The rules and the HTML sanitizer are the real ones; the
 * database, emails and the ledger are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { productSlugCandidates } from "@/lib/product-rules";

const PRO = "0123456789abcdef01234567";
const OTHER_PRO = "0123456789abcdef0123ffff";
const ADMIN = "0123456789abcdef0123aaaa";
const FILE = "0123456789abcdef0123bbbb";
const ENT = "0123456789abcdef0123cccc";
const SLUG = "gerer-son-stress";

type Moderation = {
  status: string;
  revision?: number;
  approvedRevision?: number;
  history?: Record<string, unknown>[];
  submittedAt?: Date;
  attestedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: unknown;
  notes?: string;
  unpublishedBy?: string;
};

type Row = {
  kind: string;
  slug: string;
  locale: "fr" | "en";
  title: string;
  summary: string;
  contentHtml: string;
  previewHtml: string;
  priceCents: number;
  isPremium: boolean;
  productType: string;
  status: string;
  publishedAt?: Date;
  ownerProfessionalId: string;
  productFileId?: string;
  moderation?: Moderation;
  mediaUrl?: string;
  save: ReturnType<typeof vi.fn>;
  markModified: ReturnType<typeof vi.fn>;
};

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  entryFind: vi.fn(),
  entryExists: vi.fn(),
  entryInsertMany: vi.fn(),
  entryDeleteMany: vi.fn(),
  entryFindOne: vi.fn(),
  entExists: vi.fn(),
  entFindById: vi.fn(),
  entCount: vi.fn(),
  fileExists: vi.fn(),
  fileDeleteMany: vi.fn(),
  fileFindById: vi.fn(),
  userExists: vi.fn(),
  userFindById: vi.fn(),
  showcaseFindOne: vi.fn(),
  sendAdminProductSubmittedAlert: vi.fn(),
  sendProductModerationDecisionEmail: vi.fn(),
  sendProductSoldEmail: vi.fn(),
  syncProductLedger: vi.fn(),
}));

const chain = (result: unknown) => {
  const query = { select: () => query, sort: () => query, limit: () => query, lean: async () => result };
  return query;
};

const extra = vi.hoisted(() => ({ entryDistinct: vi.fn(), userFind: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/ContentEntry", () => ({
  default: {
    find: h.entryFind,
    exists: h.entryExists,
    insertMany: h.entryInsertMany,
    deleteMany: h.entryDeleteMany,
    findOne: h.entryFindOne,
    distinct: extra.entryDistinct,
  },
}));
vi.mock("@/models/ResourceEntitlement", () => ({
  default: { exists: h.entExists, findById: h.entFindById, countDocuments: h.entCount },
}));
vi.mock("@/models/StoredFile", () => ({
  default: { exists: h.fileExists, deleteMany: h.fileDeleteMany, findById: h.fileFindById },
}));
vi.mock("@/models/User", () => ({ default: { exists: h.userExists, findById: h.userFindById, find: extra.userFind } }));
vi.mock("@/models/ShowcasePage", () => ({ default: { findOne: h.showcaseFindOne } }));
vi.mock("@/lib/showcase-hosts", () => ({
  canonicalSiteUrl: (path: string) => `https://www.jechemine.ca${path}`,
  showcasePageUrl: (slug: string) => `https://www.jechemine.ca/${slug}`,
}));
vi.mock("@/lib/product-ledger", () => ({ syncProductLedger: h.syncProductLedger }));
// Articles have their own spec; here only that the account sync reaches them.
vi.mock("@/lib/articles", () => ({ syncProfessionalArticles: vi.fn(async () => 0) }));
vi.mock("@/lib/notifications", () => ({
  sendAdminProductSubmittedAlert: h.sendAdminProductSubmittedAlert,
  sendProductModerationDecisionEmail: h.sendProductModerationDecisionEmail,
  sendProductSoldEmail: h.sendProductSoldEmail,
}));

import {
  adminProductAction,
  createProduct,
  deleteProduct,
  professionalProductAction,
  reconcileProductLiveStatus,
  settleProductPurchase,
  syncProductLiveStatus,
  syncProfessionalProducts,
  updateProduct,
} from "@/lib/products";

const makeRow = (locale: "fr" | "en", over: Partial<Row> = {}): Row => ({
  kind: "resource",
  slug: SLUG,
  locale,
  title: locale === "fr" ? "Gérer son stress" : "Managing stress",
  summary: "",
  contentHtml: "",
  previewHtml: "",
  priceCents: 0,
  isPremium: true,
  productType: "pdf",
  status: "draft",
  ownerProfessionalId: PRO,
  moderation: { status: "draft", revision: 1, history: [] },
  save: vi.fn().mockResolvedValue(undefined),
  markModified: vi.fn(),
  ...over,
});

let fr: Row;
let en: Row;

/** Both rows with the same overrides; moderation objects are never shared. */
const setPair = (over: Partial<Row> = {}) => {
  const { moderation, ...rest } = over;
  fr = makeRow("fr", { ...rest, ...(moderation ? { moderation: { ...moderation } } : {}) });
  en = makeRow("en", { ...rest, ...(moderation ? { moderation: { ...moderation } } : {}) });
  h.rows = [fr, en];
};

const completePdf: Partial<Row> = {
  title: "Gérer son stress",
  summary: "Un guide pratique.",
  priceCents: 4900,
  productFileId: FILE,
};

const findFilter = (n = 0) => h.entryFind.mock.calls[n]?.[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  setPair();
  h.entryFind.mockImplementation(async () => h.rows);
  h.entryExists.mockResolvedValue(null);
  h.entryInsertMany.mockResolvedValue([]);
  h.entryDeleteMany.mockResolvedValue({ deletedCount: 2 });
  h.entryFindOne.mockImplementation(() => chain({ title: "Gérer son stress" }));
  h.entExists.mockResolvedValue(null);
  h.entFindById.mockImplementation(() =>
    chain({ slug: SLUG, ownerProfessionalId: PRO, amountCents: 4900, locale: "fr" }),
  );
  h.entCount.mockResolvedValue(0);
  h.fileExists.mockResolvedValue({ _id: FILE });
  h.fileDeleteMany.mockResolvedValue({ deletedCount: 1 });
  h.userExists.mockResolvedValue({ _id: PRO });
  h.userFindById.mockImplementation(() =>
    chain({ firstName: "Léa", lastName: "Sassi", email: "lea@example.com", language: "fr" }),
  );
  h.sendAdminProductSubmittedAlert.mockResolvedValue(undefined);
  h.sendProductModerationDecisionEmail.mockResolvedValue(undefined);
  h.sendProductSoldEmail.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createProduct", () => {
  it("refuses an unknown type", async () => {
    const result = await createProduct({ professionalId: PRO, type: "podcast", titleFr: "Gérer son stress" });
    expect(result).toEqual({ ok: false, status: 400, code: "INVALID_TYPE" });
    expect(h.entryInsertMany).not.toHaveBeenCalled();
  });

  it("refuses a missing or blank title", async () => {
    for (const titleFr of [undefined, "", "   ", 42]) {
      const result = await createProduct({ professionalId: PRO, type: "pdf", titleFr });
      expect(result).toMatchObject({ ok: false, status: 400, code: "INVALID_TITLE" });
    }
    expect(h.entryInsertMany).not.toHaveBeenCalled();
  });

  it("takes the next address when the first one is taken", async () => {
    const [first, second] = productSlugCandidates("Gérer son stress");
    h.entryExists.mockResolvedValueOnce({ _id: "taken" }).mockResolvedValue(null);

    const result = await createProduct({ professionalId: PRO, type: "pdf", titleFr: "Gérer son stress" });

    expect(result).toEqual({ ok: true, slug: second });
    expect(h.entryExists.mock.calls[0][0]).toEqual({ kind: "resource", slug: first });
    const inserted = h.entryInsertMany.mock.calls[0][0] as Record<string, unknown>[];
    expect(inserted.every((row) => row.slug === second)).toBe(true);
  });

  it("writes a French and an English draft owned by the professional", async () => {
    await createProduct({ professionalId: PRO, type: "pdf", titleFr: "Gérer son stress" });

    const inserted = h.entryInsertMany.mock.calls[0][0] as Record<string, unknown>[];
    expect(inserted.map((row) => row.locale)).toEqual(["fr", "en"]);
    for (const row of inserted) {
      expect(String(row.ownerProfessionalId)).toBe(PRO);
      expect(row.status).toBe("draft");
      expect(row.title).toBe("Gérer son stress");
      expect(row.isPremium).toBe(true);
      expect((row.moderation as Moderation).status).toBe("draft");
      expect((row.moderation as Moderation).revision).toBe(1);
    }
  });

  it("never marks an external link as premium", async () => {
    await createProduct({ professionalId: PRO, type: "external", titleFr: "Mon site" });
    const inserted = h.entryInsertMany.mock.calls[0][0] as Record<string, unknown>[];
    expect(inserted.map((row) => row.isPremium)).toEqual([false, false]);
  });
});

describe("updateProduct", () => {
  it("is 404 for another professional's product, looked up by owner", async () => {
    h.rows = [];
    const result = await updateProduct({ professionalId: OTHER_PRO, slug: SLUG, body: { titleFr: "Volé" } });

    expect(result).toEqual({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(findFilter()).toMatchObject({ kind: "resource", slug: SLUG, ownerProfessionalId: OTHER_PRO });
  });

  it("refuses to edit a product under review", async () => {
    setPair({ moderation: { status: "submitted", revision: 1 } });
    const result = await updateProduct({ professionalId: PRO, slug: SLUG, body: { titleFr: "Nouveau" } });
    expect(result).toEqual({ ok: false, status: 409, code: "UNDER_REVIEW" });
    expect(fr.save).not.toHaveBeenCalled();
  });

  it("sanitizes the HTML it stores", async () => {
    const result = await updateProduct({
      professionalId: PRO,
      slug: SLUG,
      body: { contentHtmlFr: '<p>Bonjour</p><script>alert("x")</script><img src="https://evil.example/x.png" onerror="alert(1)">' },
    });

    expect(result).toEqual({ ok: true });
    expect(fr.contentHtml).toContain("<p>Bonjour</p>");
    expect(fr.contentHtml).not.toContain("script");
    expect(fr.contentHtml).not.toContain("onerror");
    expect(fr.contentHtml).not.toContain("evil.example");
  });

  it("falls back to the French text when the English is empty", async () => {
    await updateProduct({
      professionalId: PRO,
      slug: SLUG,
      body: { titleFr: "Gérer le stress", titleEn: "", summaryFr: "Résumé", summaryEn: "", contentHtmlFr: "<p>Texte</p>", contentHtmlEn: "" },
    });

    expect(en.title).toBe("Gérer le stress");
    expect(en.summary).toBe("Résumé");
    expect(en.contentHtml).toBe("<p>Texte</p>");
  });

  it("keeps the English following the French when only the French is written, until the English is its own", async () => {
    await updateProduct({ professionalId: PRO, slug: SLUG, body: { summaryFr: "Résumé", contentHtmlFr: "<p>Texte</p>" } });
    expect([en.summary, en.contentHtml]).toEqual(["Résumé", "<p>Texte</p>"]);

    await updateProduct({ professionalId: PRO, slug: SLUG, body: { contentHtmlFr: "<p>Texte revu</p>" } });
    expect(en.contentHtml).toBe("<p>Texte revu</p>");

    await updateProduct({ professionalId: PRO, slug: SLUG, body: { contentHtmlEn: "<p>English text</p>" } });
    await updateProduct({ professionalId: PRO, slug: SLUG, body: { contentHtmlFr: "<p>Texte encore revu</p>" } });
    expect(en.contentHtml).toBe("<p>English text</p>");
  });

  it("mirrors the price on both rows and makes a priced product premium", async () => {
    setPair({ isPremium: false });
    await updateProduct({ professionalId: PRO, slug: SLUG, body: { priceCents: 4900 } });

    expect([fr.priceCents, en.priceCents]).toEqual([4900, 4900]);
    expect([fr.isPremium, en.isPremium]).toEqual([true, true]);
  });

  it("keeps an external product free", async () => {
    setPair({ productType: "external", isPremium: false });
    await updateProduct({ professionalId: PRO, slug: SLUG, body: { priceCents: 0 } });

    expect([fr.priceCents, en.priceCents]).toEqual([0, 0]);
    expect([fr.isPremium, en.isPremium]).toEqual([false, false]);
  });

  it("bumps the revision on both rows and saves them", async () => {
    setPair({ moderation: { status: "approved", revision: 3, approvedRevision: 3 } });
    await updateProduct({ professionalId: PRO, slug: SLUG, body: { summaryFr: "Changé" } });

    expect(fr.moderation?.revision).toBe(4);
    expect(en.moderation?.revision).toBe(4);
    expect(fr.markModified).toHaveBeenCalledWith("moderation");
    expect(fr.save).toHaveBeenCalled();
    expect(en.save).toHaveBeenCalled();
  });

  it("passes a validation failure through with its field", async () => {
    const result = await updateProduct({ professionalId: PRO, slug: SLUG, body: { priceCents: 1 } });
    expect(result).toEqual({ ok: false, status: 400, code: "INVALID_PRICE", details: { field: "priceCents" } });
    expect(fr.save).not.toHaveBeenCalled();
  });
});

describe("professionalProductAction", () => {
  it("refuses to send an incomplete product, attestation included", async () => {
    h.fileExists.mockResolvedValue(null);
    const result = await professionalProductAction({ professionalId: PRO, slug: SLUG, action: "submit", attest: false });

    expect(result).toMatchObject({ ok: false, status: 400, code: "INCOMPLETE" });
    const missing = (result as unknown as { details: { missing: string[] } }).details.missing;
    expect(missing).toEqual(expect.arrayContaining(["summary", "price", "file", "attestation"]));
    expect(fr.save).not.toHaveBeenCalled();
    expect(h.sendAdminProductSubmittedAlert).not.toHaveBeenCalled();
  });

  it("asks for the attestation alone when everything else is there", async () => {
    setPair(completePdf);
    const result = await professionalProductAction({ professionalId: PRO, slug: SLUG, action: "submit" });
    expect(result).toEqual({ ok: false, status: 400, code: "INCOMPLETE", details: { missing: ["attestation"] } });
  });

  it("checks the file is really a product file", async () => {
    setPair(completePdf);
    await professionalProductAction({ professionalId: PRO, slug: SLUG, action: "submit", attest: true });
    expect(h.fileExists).toHaveBeenCalledWith({ _id: FILE, kind: "product-file" });
  });

  it("sends a complete PDF product for review and alerts the team", async () => {
    setPair(completePdf);
    const result = await professionalProductAction({ professionalId: PRO, slug: SLUG, action: "submit", attest: true });

    expect(result).toEqual({ ok: true, status: "submitted" });
    for (const row of [fr, en]) {
      expect(row.moderation?.status).toBe("submitted");
      expect(row.moderation?.attestedAt).toBeInstanceOf(Date);
      expect(row.moderation?.submittedAt).toBeInstanceOf(Date);
      expect(row.save).toHaveBeenCalled();
    }
    expect(h.sendAdminProductSubmittedAlert).toHaveBeenCalledWith({
      professionalName: "Léa Sassi",
      productTitle: "Gérer son stress",
      slug: SLUG,
    });
  });

  it("refuses to send when the professional's account is not active", async () => {
    setPair(completePdf);
    h.userExists.mockResolvedValue(null);
    const result = await professionalProductAction({ professionalId: PRO, slug: SLUG, action: "submit", attest: true });
    expect(result).toEqual({ ok: false, status: 403, code: "ACCOUNT_NOT_ACTIVE" });
  });

  it("withdraws a submission back to draft", async () => {
    setPair({ ...completePdf, moderation: { status: "submitted", revision: 1 } });
    const result = await professionalProductAction({ professionalId: PRO, slug: SLUG, action: "withdraw" });

    expect(result).toEqual({ ok: true, status: "draft" });
    expect(fr.moderation?.status).toBe("draft");
    expect(en.moderation?.status).toBe("draft");
    expect(h.sendAdminProductSubmittedAlert).not.toHaveBeenCalled();
  });

  it("takes a live product down as the professional", async () => {
    setPair({ ...completePdf, status: "published", moderation: { status: "approved", revision: 1, approvedRevision: 1 } });
    const result = await professionalProductAction({ professionalId: PRO, slug: SLUG, action: "unpublish" });

    expect(result).toEqual({ ok: true, status: "unpublished" });
    expect(fr.moderation?.unpublishedBy).toBe("professional");
    expect(en.moderation?.unpublishedBy).toBe("professional");
    expect([fr.status, en.status]).toEqual(["draft", "draft"]);
  });

  it("refuses a move the rules do not allow", async () => {
    const result = await professionalProductAction({ professionalId: PRO, slug: SLUG, action: "withdraw" });
    expect(result).toEqual({ ok: false, status: 409, code: "TRANSITION_NOT_ALLOWED", details: { from: "draft" } });
    expect(fr.save).not.toHaveBeenCalled();
  });

  it("looks the product up by its owner", async () => {
    h.rows = [];
    const result = await professionalProductAction({ professionalId: OTHER_PRO, slug: SLUG, action: "withdraw" });
    expect(result).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(findFilter()).toMatchObject({ ownerProfessionalId: OTHER_PRO });
  });
});

describe("adminProductAction", () => {
  it("refuses to reject without notes", async () => {
    setPair({ moderation: { status: "submitted", revision: 1 } });
    for (const notes of [undefined, "", "   "]) {
      const result = await adminProductAction({ adminId: ADMIN, slug: SLUG, action: "reject", notes });
      expect(result).toEqual({ ok: false, status: 400, code: "NOTES_REQUIRED" });
    }
    expect(fr.save).not.toHaveBeenCalled();
  });

  it("rejects with notes and tells the professional", async () => {
    setPair({ moderation: { status: "submitted", revision: 1 } });
    const result = await adminProductAction({ adminId: ADMIN, slug: SLUG, action: "reject", notes: "  Ajoutez un résumé.  " });

    expect(result).toEqual({ ok: true, status: "rejected" });
    expect(fr.moderation?.notes).toBe("Ajoutez un résumé.");
    expect(h.sendProductModerationDecisionEmail).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "rejected", notes: "Ajoutez un résumé.", productUrl: null }),
    );
  });

  it("approves, sanitizing both rows again, and records the approved revision", async () => {
    setPair({
      contentHtml: '<p>Texte</p><script>alert(1)</script>',
      previewHtml: '<p onclick="x()">Extrait</p><iframe src="https://evil.example"></iframe>',
      moderation: { status: "submitted", revision: 4 },
    });
    const result = await adminProductAction({ adminId: ADMIN, slug: SLUG, action: "approve" });

    expect(result).toEqual({ ok: true, status: "approved" });
    for (const row of [fr, en]) {
      expect(row.contentHtml).toBe("<p>Texte</p>");
      expect(row.previewHtml).toBe("<p>Extrait</p>");
      expect(row.moderation?.approvedRevision).toBe(4);
      expect(String(row.moderation?.reviewedBy)).toBe(ADMIN);
      expect(row.status).toBe("published");
      expect(row.publishedAt).toBeInstanceOf(Date);
    }
    expect(h.sendProductModerationDecisionEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "approved",
        professionalEmail: "lea@example.com",
        productUrl: `https://www.jechemine.ca/book/${SLUG}`,
      }),
    );
  });

  it("accepts the changes of a live product without emailing", async () => {
    setPair({ status: "published", moderation: { status: "approved", revision: 3, approvedRevision: 2 } });
    const result = await adminProductAction({ adminId: ADMIN, slug: SLUG, action: "approve" });

    expect(result).toEqual({ ok: true, status: "approved" });
    expect(fr.moderation?.approvedRevision).toBe(3);
    expect(fr.moderation?.history?.at(-1)).toMatchObject({ action: "approve_changes", actor: "admin" });
    expect(h.sendProductModerationDecisionEmail).not.toHaveBeenCalled();
  });

  it("refuses to approve a live product with nothing pending", async () => {
    setPair({ status: "published", moderation: { status: "approved", revision: 3, approvedRevision: 3 } });
    const result = await adminProductAction({ adminId: ADMIN, slug: SLUG, action: "approve" });
    expect(result).toMatchObject({ ok: false, status: 409, code: "TRANSITION_NOT_ALLOWED" });
  });

  it("takes a product down as the team and tells the professional", async () => {
    setPair({ status: "published", moderation: { status: "approved", revision: 1, approvedRevision: 1 } });
    const result = await adminProductAction({ adminId: ADMIN, slug: SLUG, action: "unpublish", notes: "Contenu trompeur" });

    expect(result).toEqual({ ok: true, status: "unpublished" });
    expect(fr.moderation?.unpublishedBy).toBe("admin");
    expect(en.moderation?.unpublishedBy).toBe("admin");
    expect([fr.status, en.status]).toEqual(["draft", "draft"]);
    expect(h.sendProductModerationDecisionEmail).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "unpublished", notes: "Contenu trompeur", productUrl: null }),
    );
  });

  it("finds a product whoever owns it", async () => {
    setPair({ moderation: { status: "submitted", revision: 1 } });
    await adminProductAction({ adminId: ADMIN, slug: SLUG, action: "approve" });
    expect(findFilter()).not.toHaveProperty("ownerProfessionalId", PRO);
    expect(findFilter()).toMatchObject({ ownerProfessionalId: { $exists: true } });
  });
});

describe("syncProductLiveStatus", () => {
  it("publishes an approved product of an active professional", async () => {
    setPair({ moderation: { status: "approved", revision: 1, approvedRevision: 1 } });
    expect(await syncProductLiveStatus(SLUG)).toBe(true);

    for (const row of [fr, en]) {
      expect(row.status).toBe("published");
      expect(row.publishedAt).toBeInstanceOf(Date);
      expect(row.save).toHaveBeenCalled();
    }
    expect(h.userExists).toHaveBeenCalledWith({ _id: PRO, role: "professional", status: "active" });
  });

  it("hides an approved product when its professional is no longer active", async () => {
    setPair({ status: "published", moderation: { status: "approved", revision: 1, approvedRevision: 1 } });
    h.userExists.mockResolvedValue(null);

    expect(await syncProductLiveStatus(SLUG)).toBe(false);
    expect([fr.status, en.status]).toEqual(["draft", "draft"]);
  });

  it("does not save rows already in the right state", async () => {
    setPair({ status: "draft" });
    await syncProductLiveStatus(SLUG);
    expect(fr.save).not.toHaveBeenCalled();
  });
});

describe("syncProfessionalProducts", () => {
  it("syncs every product the professional owns, so they leave the site with the account", async () => {
    extra.entryDistinct.mockResolvedValue([SLUG, "autre-produit"]);
    setPair({ status: "published", moderation: { status: "approved", revision: 1, approvedRevision: 1 } });
    h.userExists.mockResolvedValue(null);

    expect(await syncProfessionalProducts(PRO)).toBe(2);
    expect(extra.entryDistinct).toHaveBeenCalledWith("slug", { kind: "resource", ownerProfessionalId: PRO });
    expect(h.entryFind.mock.calls.map((call) => (call[0] as { slug: string }).slug)).toEqual([SLUG, "autre-produit"]);
    expect([fr.status, en.status]).toEqual(["draft", "draft"]);
  });

  it("does nothing for an id that is not one", async () => {
    expect(await syncProfessionalProducts("not-an-id")).toBe(0);
    expect(extra.entryDistinct).not.toHaveBeenCalled();
  });
});

describe("reconcileProductLiveStatus", () => {
  it("syncs only the products whose stored status disagrees with the moderation and the account", async () => {
    h.entryFind.mockImplementationOnce(() =>
      chain([
        { slug: "live-owner-inactive", status: "published", ownerProfessionalId: OTHER_PRO, moderation: { status: "approved" } },
        { slug: "hidden-owner-active", status: "draft", ownerProfessionalId: PRO, moderation: { status: "approved" } },
        { slug: "fine", status: "published", ownerProfessionalId: PRO, moderation: { status: "approved" } },
        { slug: "taken-down-still-live", status: "published", ownerProfessionalId: PRO, moderation: { status: "unpublished" } },
      ]),
    );
    extra.userFind.mockImplementation(() => chain([{ _id: PRO }]));

    expect(await reconcileProductLiveStatus()).toBe(3);
    expect(h.entryFind.mock.calls[0][0]).toMatchObject({ kind: "resource", ownerProfessionalId: { $exists: true } });
    expect(extra.userFind.mock.calls[0][0]).toMatchObject({
      _id: { $in: [OTHER_PRO, PRO] },
      role: "professional",
      status: "active",
    });
    const synced = h.entryFind.mock.calls.slice(1).map((call) => (call[0] as { slug: string }).slug);
    expect(synced.sort()).toEqual(["hidden-owner-active", "live-owner-inactive", "taken-down-still-live"]);
  });

  it("changes nothing when every product agrees", async () => {
    h.entryFind.mockImplementationOnce(() =>
      chain([{ slug: SLUG, status: "published", ownerProfessionalId: PRO, moderation: { status: "approved" } }]),
    );
    extra.userFind.mockImplementation(() => chain([{ _id: PRO }]));
    expect(await reconcileProductLiveStatus()).toBe(0);
    expect(h.entryFind).toHaveBeenCalledTimes(1);
  });
});

describe("deleteProduct", () => {
  it("refuses once the product has a paid or refunded purchase", async () => {
    h.entExists.mockResolvedValue({ _id: ENT });
    const result = await deleteProduct({ professionalId: PRO, slug: SLUG });

    expect(result).toEqual({ ok: false, status: 409, code: "HAS_SALES" });
    const filter = h.entExists.mock.calls[0][0] as { slug: string; status: { $in: string[] } };
    expect(filter.slug).toBe(SLUG);
    expect(filter.status.$in).toEqual(expect.arrayContaining(["paid", "refunded"]));
    expect(h.entryDeleteMany).not.toHaveBeenCalled();
    expect(h.fileDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes the rows and their product files otherwise", async () => {
    setPair({ productFileId: FILE });
    const result = await deleteProduct({ professionalId: PRO, slug: SLUG });

    expect(result).toEqual({ ok: true });
    expect(h.entryDeleteMany).toHaveBeenCalledWith({ kind: "resource", slug: SLUG, ownerProfessionalId: PRO });
    expect(h.fileDeleteMany).toHaveBeenCalledWith({ _id: { $in: [FILE, FILE] }, kind: "product-file" });
  });

  it("deletes no file when the product has none", async () => {
    await deleteProduct({ professionalId: PRO, slug: SLUG });
    expect(h.entryDeleteMany).toHaveBeenCalled();
    expect(h.fileDeleteMany).not.toHaveBeenCalled();
  });

  it("is 404 for another professional's product", async () => {
    h.rows = [];
    const result = await deleteProduct({ professionalId: OTHER_PRO, slug: SLUG });
    expect(result).toEqual({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(findFilter()).toMatchObject({ ownerProfessionalId: OTHER_PRO });
    expect(h.entryDeleteMany).not.toHaveBeenCalled();
  });
});

describe("settleProductPurchase", () => {
  it("tells the professional about a new sale with their net", async () => {
    h.syncProductLedger.mockResolvedValue({ changed: true, source: "product_sale", netCents: 3920 });
    await settleProductPurchase(ENT);

    expect(h.syncProductLedger).toHaveBeenCalledWith(ENT);
    expect(h.sendProductSoldEmail).toHaveBeenCalledWith({
      professionalName: "Léa Sassi",
      professionalEmail: "lea@example.com",
      productTitle: "Gérer son stress",
      amountCents: 4900,
      netCents: 3920,
      locale: "fr",
    });
  });

  it("sends nothing for a reversal or a recredit", async () => {
    for (const source of ["product_sale_reversal", "product_sale_recredit"]) {
      h.syncProductLedger.mockResolvedValue({ changed: true, source, netCents: -3920 });
      await settleProductPurchase(ENT);
    }
    expect(h.sendProductSoldEmail).not.toHaveBeenCalled();
    expect(h.entFindById).not.toHaveBeenCalled();
  });

  it("sends nothing when the ledger was already in balance", async () => {
    h.syncProductLedger.mockResolvedValue({ changed: false, reason: "in-balance" });
    await settleProductPurchase(ENT);
    expect(h.sendProductSoldEmail).not.toHaveBeenCalled();
  });

  it("does not throw when the sale email fails", async () => {
    h.syncProductLedger.mockResolvedValue({ changed: true, source: "product_sale", netCents: 3920 });
    h.sendProductSoldEmail.mockRejectedValue(new Error("smtp down"));
    await expect(settleProductPurchase(ENT)).resolves.toBeUndefined();
  });
});

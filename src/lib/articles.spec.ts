/**
 * Articles professionals write (2026-09-15): creating, editing, sending to the team, the team's
 * decision, featuring in « Nouveautés », going live with the account, and the page's list. The rules
 * and the HTML sanitizer are the real ones; the database and emails are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO = "0123456789abcdef01234567";
const OTHER_PRO = "0123456789abcdef0123ffff";
const ADMIN = "0123456789abcdef0123aaaa";
const SLUG = "mieux-dormir";

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
  iconUrl?: string;
  status: string;
  publishedAt?: Date;
  listInLibrary?: boolean;
  ownerProfessionalId: string;
  moderation?: Moderation;
  updatedAt: Date;
  save: ReturnType<typeof vi.fn>;
  markModified: ReturnType<typeof vi.fn>;
};

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  finds: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[][],
  deleted: [] as Record<string, unknown>[],
  taken: new Set<string>(),
  ownerActive: true,
  owner: null as Record<string, unknown> | null,
  page: null as Record<string, unknown> | null,
  submitted: vi.fn(),
  decision: vi.fn(),
}));

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key.startsWith("$")) return true;
    if (expected !== null && typeof expected === "object") return true;
    const actual = key === "moderation.status" ? (row.moderation as Moderation | undefined)?.status : row[key];
    return String(actual) === String(expected);
  });
}

function query(result: unknown) {
  const q = {
    select: () => q,
    sort: () => q,
    limit: () => q,
    lean: async () => result,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/ContentEntry", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.finds.push(filter);
      return query(h.rows.filter((row) => matches(row as unknown as Record<string, unknown>, filter)));
    },
    exists: async (filter: { slug: string }) => (h.taken.has(filter.slug) ? { _id: "x" } : null),
    insertMany: async (docs: Record<string, unknown>[]) => {
      h.inserted.push(docs);
    },
    deleteMany: async (filter: Record<string, unknown>) => {
      h.deleted.push(filter);
    },
    distinct: async () => [...new Set(h.rows.map((row) => row.slug))],
  },
}));
vi.mock("@/models/User", () => ({
  default: {
    exists: async () => (h.ownerActive ? { _id: PRO } : null),
    findById: () => query(h.owner),
    find: () => query(h.ownerActive ? [{ _id: PRO, firstName: "Amel", lastName: "Sassi" }] : []),
  },
}));
vi.mock("@/models/ShowcasePage", () => ({ default: { findOne: () => query(h.page) } }));
vi.mock("@/lib/showcase-hosts", () => ({ canonicalSiteUrl: (path: string) => `https://www.jechemine.ca${path}` }));
vi.mock("@/lib/notifications", () => ({
  sendAdminArticleSubmittedAlert: h.submitted,
  sendArticleModerationDecisionEmail: h.decision,
}));

import {
  adminArticleAction,
  createArticle,
  deleteArticle,
  listShowcaseArticles,
  loadArticleEditor,
  professionalArticleAction,
  reconcileArticleLiveStatus,
  updateArticle,
} from "@/lib/articles";

const row = (locale: "fr" | "en", over: Partial<Row> = {}): Row => ({
  kind: "nouveaute",
  slug: SLUG,
  locale,
  title: locale === "fr" ? "Mieux dormir" : "Sleep better",
  summary: "",
  contentHtml: "",
  status: "draft",
  listInLibrary: false,
  ownerProfessionalId: PRO,
  moderation: { status: "draft", revision: 1, history: [] },
  updatedAt: new Date("2026-09-15T12:00:00Z"),
  save: vi.fn().mockResolvedValue(undefined),
  markModified: vi.fn(),
  ...over,
});

const complete = { summary: "Un résumé.", contentHtml: "<p>Du texte utile.</p>" };
const pair = (over: Partial<Row> = {}) => {
  const fr = row("fr", { ...complete, ...over });
  const en = row("en", { ...complete, ...over, moderation: over.moderation ? structuredClone(over.moderation) : { status: "draft", revision: 1, history: [] } });
  h.rows = [fr, en];
  return { fr, en };
};

beforeEach(() => {
  h.rows = [];
  h.finds = [];
  h.inserted = [];
  h.deleted = [];
  h.taken = new Set();
  h.ownerActive = true;
  h.owner = { firstName: "Amel", lastName: "Sassi", email: "amel@exemple.ca", language: "fr" };
  h.page = { userId: PRO };
  h.submitted.mockReset();
  h.decision.mockReset();
});

describe("createArticle", () => {
  it("creates a French and an English draft owned by the professional, never public, at the next free address", async () => {
    h.taken.add(SLUG);
    expect(await createArticle({ professionalId: PRO, titleFr: " Mieux dormir " })).toEqual({ ok: true, slug: `${SLUG}-2` });
    const [docs] = h.inserted;
    expect(docs.map((doc) => [doc.locale, doc.slug, doc.kind, doc.status, doc.listInLibrary, doc.isPremium, doc.priceCents])).toEqual([
      ["fr", `${SLUG}-2`, "nouveaute", "draft", false, false, 0],
      ["en", `${SLUG}-2`, "nouveaute", "draft", false, false, 0],
    ]);
    expect(String(docs[0].ownerProfessionalId)).toBe(PRO);
    expect(docs[0].moderation).toMatchObject({ status: "draft", revision: 1 });
  });

  it("refuses a missing title", async () => {
    expect(await createArticle({ professionalId: PRO, titleFr: "  " })).toMatchObject({ ok: false, status: 400, code: "INVALID_TITLE" });
    expect(h.inserted).toEqual([]);
  });
});

describe("updateArticle", () => {
  it("sanitizes the text, lets English follow French until written, bumps the revision and ignores the listing", async () => {
    const { fr, en } = pair({ contentHtml: "", summary: "" });
    const result = await updateArticle({
      professionalId: PRO,
      slug: SLUG,
      body: {
        titleFr: "Mieux dormir, vraiment",
        summaryFr: "Résumé",
        contentHtmlFr: '<p>Texte</p><script>alert(1)</script><img src="https://tracker.example/x.gif">',
        listInLibrary: true,
        status: "published",
      },
    });
    expect(result).toEqual({ ok: true });
    expect(fr.contentHtml).toBe("<p>Texte</p>");
    // The English title was written by the professional (« Sleep better »): it stays; the empty fields follow the French.
    expect(en).toMatchObject({ title: "Sleep better", summary: "Résumé", contentHtml: "<p>Texte</p>" });
    expect([fr.moderation?.revision, en.moderation?.revision]).toEqual([2, 2]);
    expect([fr.listInLibrary, fr.status]).toEqual([false, "draft"]);
  });

  it("is refused under review, and for an article that is not the professional's", async () => {
    pair({ moderation: { status: "submitted", revision: 1, history: [] } });
    expect(await updateArticle({ professionalId: PRO, slug: SLUG, body: { titleFr: "X" } })).toMatchObject({ status: 409, code: "UNDER_REVIEW" });
    expect(await updateArticle({ professionalId: OTHER_PRO, slug: SLUG, body: { titleFr: "X" } })).toMatchObject({ status: 404 });
    expect(await loadArticleEditor(OTHER_PRO, SLUG)).toBeNull();
    expect(await deleteArticle({ professionalId: OTHER_PRO, slug: SLUG })).toMatchObject({ status: 404 });
    expect(h.deleted).toEqual([]);
  });
});

describe("sending to the team", () => {
  it("needs a summary, some text and the attestation, lists what is missing, and changes nothing", async () => {
    const { fr } = pair({ summary: "", contentHtml: "<p> </p>" });
    expect(await professionalArticleAction({ professionalId: PRO, slug: SLUG, action: "submit" })).toEqual({
      ok: false,
      status: 400,
      code: "INCOMPLETE",
      details: { missing: ["summary", "content", "attestation"] },
    });
    expect(fr.moderation?.status).toBe("draft");
    expect(h.submitted).not.toHaveBeenCalled();
  });

  it("refuses an inactive account", async () => {
    pair();
    h.ownerActive = false;
    expect(await professionalArticleAction({ professionalId: PRO, slug: SLUG, action: "submit", attest: true })).toMatchObject({
      status: 403,
      code: "ACCOUNT_NOT_ACTIVE",
    });
  });

  it("puts both rows under review, not public, and alerts the team", async () => {
    const { fr, en } = pair({ moderation: { status: "rejected", revision: 3, notes: "Précisez", history: [] } });
    expect(await professionalArticleAction({ professionalId: PRO, slug: SLUG, action: "submit", attest: true })).toEqual({ ok: true, status: "submitted" });
    expect([fr.moderation?.status, en.moderation?.status]).toEqual(["submitted", "submitted"]);
    expect(fr.moderation?.notes).toBeUndefined();
    expect(fr.moderation?.attestedAt).toBeInstanceOf(Date);
    expect([fr.status, en.status]).toEqual(["draft", "draft"]);
    expect(h.submitted).toHaveBeenCalledWith({ professionalName: "Amel Sassi", articleTitle: "Mieux dormir", slug: SLUG });
  });

  it("only allows the professional's moves", async () => {
    pair();
    expect(await professionalArticleAction({ professionalId: PRO, slug: SLUG, action: "unpublish" })).toMatchObject({
      status: 409,
      code: "TRANSITION_NOT_ALLOWED",
    });
  });
});

describe("the team's decision", () => {
  it("needs notes to refuse, and tells the professional", async () => {
    const { fr } = pair({ moderation: { status: "submitted", revision: 2, history: [] } });
    expect(await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "reject" })).toMatchObject({ status: 400, code: "NOTES_REQUIRED" });
    expect(await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "reject", notes: " Précisez le public. " })).toEqual({ ok: true, status: "rejected" });
    expect(fr.moderation).toMatchObject({ status: "rejected", notes: "Précisez le public." });
    expect(h.decision).toHaveBeenCalledWith(expect.objectContaining({ decision: "rejected", notes: "Précisez le public.", articleUrl: null }));
  });

  it("approving publishes both rows while the account is active, sanitizes again and links to the article", async () => {
    const { fr, en } = pair({ moderation: { status: "submitted", revision: 4, history: [] }, contentHtml: "<p>Ok</p><img src=x onerror=alert(1)>" });
    expect(await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "approve" })).toEqual({ ok: true, status: "approved" });
    expect([fr.status, en.status]).toEqual(["published", "published"]);
    expect(fr.publishedAt).toBeInstanceOf(Date);
    expect(fr.contentHtml).toBe("<p>Ok</p>");
    expect(fr.moderation?.approvedRevision).toBe(4);
    expect(h.decision).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "approved", articleUrl: `https://www.jechemine.ca/nouveautes/${SLUG}` }),
    );
  });

  it("an approved article of an inactive professional stays hidden", async () => {
    const { fr } = pair({ moderation: { status: "submitted", revision: 1, history: [] } });
    h.ownerActive = false;
    await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "approve" });
    expect(fr.status).toBe("draft");
    expect(h.decision).toHaveBeenCalledWith(expect.objectContaining({ decision: "approved", articleUrl: null }));
  });

  it("a live edit waits for the team, whose approval of the changes sends no email", async () => {
    const { fr } = pair({ status: "published", moderation: { status: "approved", revision: 2, approvedRevision: 2, history: [] } });
    await updateArticle({ professionalId: PRO, slug: SLUG, body: { summaryFr: "Nouveau résumé" } });
    expect((await loadArticleEditor(PRO, SLUG))?.moderation.changesPending).toBe(true);
    expect(fr.status).toBe("published");
    expect(await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "approve" })).toEqual({ ok: true, status: "approved" });
    expect(fr.moderation?.approvedRevision).toBe(3);
    expect(fr.moderation?.history?.at(-1)).toMatchObject({ action: "approve_changes", actor: "admin" });
    expect(h.decision).not.toHaveBeenCalled();
  });

  it("features only an approved article in « Nouveautés », and taking it down removes it from there too", async () => {
    const { fr, en } = pair({ moderation: { status: "submitted", revision: 1, history: [] } });
    expect(await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "feature" })).toMatchObject({ status: 409, code: "TRANSITION_NOT_ALLOWED" });
    await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "approve" });
    h.decision.mockReset();
    expect(await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "feature" })).toEqual({ ok: true, status: "approved" });
    expect([fr.listInLibrary, en.listInLibrary]).toEqual([true, true]);
    expect(h.decision).not.toHaveBeenCalled();
    await adminArticleAction({ adminId: ADMIN, slug: SLUG, action: "unpublish" });
    expect([fr.listInLibrary, fr.status, fr.moderation?.unpublishedBy]).toEqual([false, "draft", "admin"]);
    expect(h.decision).toHaveBeenCalledWith(expect.objectContaining({ decision: "unpublished" }));
  });
});

describe("going live with the account", () => {
  it("hides a published article whose professional is no longer active", async () => {
    const { fr, en } = pair({ status: "published", moderation: { status: "approved", revision: 1, approvedRevision: 1, history: [] } });
    h.ownerActive = false;
    expect(await reconcileArticleLiveStatus()).toBe(1);
    expect([fr.status, en.status]).toEqual(["draft", "draft"]);
  });
});

describe("listShowcaseArticles", () => {
  it("lists the professional's live articles in the page's language, with their address", async () => {
    pair({ status: "published", moderation: { status: "approved", revision: 1, approvedRevision: 1, history: [] }, publishedAt: new Date("2026-09-10T12:00:00Z") });
    const cards = await listShowcaseArticles("amel-sassi", "fr");
    expect(cards).toEqual([
      {
        slug: SLUG,
        title: "Mieux dormir",
        summary: "Un résumé.",
        iconUrl: null,
        publishedAt: "2026-09-10T12:00:00.000Z",
        url: `https://www.jechemine.ca/nouveautes/${SLUG}`,
      },
    ]);
    expect(h.finds.at(-1)).toMatchObject({ kind: "nouveaute", locale: "fr", status: "published", "moderation.status": "approved", ownerProfessionalId: PRO });
    h.page = null;
    expect(await listShowcaseArticles("amel-sassi", "fr")).toEqual([]);
  });
});

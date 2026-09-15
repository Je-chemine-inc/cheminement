import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ContentEntry, { type IContentEntry } from "@/models/ContentEntry";
import User from "@/models/User";
import ShowcasePage from "@/models/ShowcasePage";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import { sanitizeProductHtml } from "@/lib/product-html";
import { productIsLive, productTransition, type ProductModerationStatus } from "@/lib/product-rules";
import {
  articleMissing,
  articleSlugCandidates,
  parseArticleWrite,
  type ArticleRequirement,
  type ArticleWriteError,
} from "@/lib/article-rules";
import { sendAdminArticleSubmittedAlert, sendArticleModerationDecisionEmail } from "@/lib/notifications";

/**
 * Articles professionals write for their page (owner's decisions, 2026-09-15): creating, editing,
 * sending to the team, the team's decision, and what the public sees. Rules in lib/article-rules.ts.
 *
 * An article is two `ContentEntry` rows (fr, en) of kind "nouveaute" sharing a slug, owned by the
 * professional, with the products' moderation block. It is read at /nouveautes/<slug> and listed on
 * the professional's page; in « Nouveautés » only when the team features it (`listInLibrary`, which
 * listPublishedContent already honours). The team's content screens never edit it (PRO_OWNED). The
 * stored `status` is written only by syncArticleLiveStatus: published while approved and the
 * professional's account is active.
 */

const KIND = "nouveaute" as const;

export type ArticleFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  code:
    | ArticleWriteError
    | "NOT_FOUND"
    | "UNDER_REVIEW"
    | "TRANSITION_NOT_ALLOWED"
    | "INCOMPLETE"
    | "NOTES_REQUIRED"
    | "ACCOUNT_NOT_ACTIVE";
  details?: Record<string, unknown>;
};

function fail(status: ArticleFailure["status"], code: ArticleFailure["code"], details?: Record<string, unknown>): ArticleFailure {
  return { ok: false, status, code, ...(details ? { details } : {}) };
}

async function settle(label: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`[articles] ${label} failed:`, error);
  }
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function loadPair(slug: string, filter: Record<string, unknown> = {}) {
  if (typeof slug !== "string" || !SLUG.test(slug)) return null;
  await connectToDatabase();
  const rows = await ContentEntry.find({ kind: KIND, slug, ownerProfessionalId: { $exists: true }, ...filter });
  const fr = rows.find((row) => row.locale === "fr");
  const en = rows.find((row) => row.locale === "en");
  return fr && en ? { fr, en } : null;
}

async function ownerIsActive(professionalId: unknown): Promise<boolean> {
  return Boolean(await User.exists({ _id: professionalId, role: "professional", status: "active" }));
}

function changesPendingOf(moderation: IContentEntry["moderation"]): boolean {
  return moderation?.status === "approved" && (moderation.approvedRevision ?? 0) < (moderation.revision ?? 1);
}

const articleUrl = (slug: string) => canonicalSiteUrl(`/nouveautes/${slug}`);

/** Publish or hide an article's rows from its moderation state and its professional's account. */
export async function syncArticleLiveStatus(slug: string): Promise<boolean> {
  const pair = await loadPair(slug);
  if (!pair) return false;
  const live = productIsLive({
    moderation: pair.fr.moderation?.status ?? "draft",
    ownerActive: await ownerIsActive(pair.fr.ownerProfessionalId),
  });
  const now = new Date();
  for (const row of [pair.fr, pair.en]) {
    const next = live ? "published" : "draft";
    if (row.status === next) continue;
    row.status = next;
    if (live && !row.publishedAt) row.publishedAt = now;
    await row.save();
  }
  return live;
}

/** Publish or hide every article of one professional after their account changed. */
export async function syncProfessionalArticles(professionalId: string): Promise<number> {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) return 0;
  await connectToDatabase();
  const slugs = (await ContentEntry.distinct("slug", { kind: KIND, ownerProfessionalId: professionalId })) as string[];
  for (const slug of slugs) await syncArticleLiveStatus(slug);
  return slugs.length;
}

/** Put right every article whose stored status disagrees with its moderation and its professional's account. */
export async function reconcileArticleLiveStatus(): Promise<number> {
  await connectToDatabase();
  const rows = await ContentEntry.find({
    kind: KIND,
    ownerProfessionalId: { $exists: true },
    $or: [{ status: "published" }, { "moderation.status": "approved" }],
  })
    .select("slug status ownerProfessionalId moderation.status")
    .lean<{ slug: string; status: string; ownerProfessionalId: unknown; moderation?: { status?: ProductModerationStatus } }[]>();
  if (rows.length === 0) return 0;
  const owners = [...new Set(rows.map((row) => String(row.ownerProfessionalId)))];
  const active = await User.find({ _id: { $in: owners }, role: "professional", status: "active" })
    .select("_id")
    .lean<{ _id: unknown }[]>();
  const activeIds = new Set(active.map((user) => String(user._id)));
  const stale = new Set<string>();
  for (const row of rows) {
    const live = productIsLive({ moderation: row.moderation?.status ?? "draft", ownerActive: activeIds.has(String(row.ownerProfessionalId)) });
    if ((row.status === "published") !== live) stale.add(row.slug);
  }
  for (const slug of stale) await syncArticleLiveStatus(slug);
  return stale.size;
}

/* ------------------------------------------------------------------------ */
/* The professional's side                                                    */
/* ------------------------------------------------------------------------ */

export async function createArticle(input: { professionalId: string; titleFr: unknown }): Promise<{ ok: true; slug: string } | ArticleFailure> {
  const parsed = parseArticleWrite({ titleFr: input.titleFr });
  if (!parsed.ok || !parsed.value.titleFr) return fail(400, "INVALID_TITLE");
  const titleFr = parsed.value.titleFr;
  await connectToDatabase();
  const owner = new mongoose.Types.ObjectId(input.professionalId);
  const common = {
    kind: KIND,
    ownerProfessionalId: owner,
    isPremium: false,
    priceCents: 0,
    status: "draft" as const,
    sortOrder: 100,
    listInLibrary: false,
    moderation: {
      status: "draft" as const,
      revision: 1,
      history: [{ at: new Date(), action: "create", actor: "professional" as const }],
    },
    updatedBy: owner,
  };
  for (const slug of articleSlugCandidates(titleFr)) {
    if (await ContentEntry.exists({ kind: KIND, slug })) continue;
    try {
      await ContentEntry.insertMany([
        { ...common, slug, locale: "fr", title: titleFr, summary: "", contentHtml: "", previewHtml: "" },
        { ...common, slug, locale: "en", title: titleFr, summary: "", contentHtml: "", previewHtml: "" },
      ]);
      return { ok: true, slug };
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        await ContentEntry.deleteMany({ kind: KIND, slug, ownerProfessionalId: owner });
        continue;
      }
      throw error;
    }
  }
  return fail(409, "INVALID_TITLE");
}

export interface ArticleEditorView {
  slug: string;
  moderation: {
    status: ProductModerationStatus;
    notes: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    changesPending: boolean;
    unpublishedBy: "professional" | "admin" | null;
  };
  live: boolean;
  /** Featured by the team in « Nouveautés ». */
  inNews: boolean;
  fields: {
    titleFr: string;
    titleEn: string;
    summaryFr: string;
    summaryEn: string;
    contentHtmlFr: string;
    contentHtmlEn: string;
    iconUrl: string | null;
  };
  missing: Exclude<ArticleRequirement, "attestation">[];
  url: string;
}

function missingOf(fr: IContentEntry): Exclude<ArticleRequirement, "attestation">[] {
  return articleMissing({
    titleFr: fr.title,
    summaryFr: fr.summary ?? "",
    contentHtmlFr: fr.contentHtml ?? "",
    attested: true,
  }).filter((item): item is Exclude<ArticleRequirement, "attestation"> => item !== "attestation");
}

export async function loadArticleEditor(professionalId: string, slug: string): Promise<ArticleEditorView | null> {
  const pair = await loadPair(slug, { ownerProfessionalId: professionalId });
  if (!pair) return null;
  const { fr, en } = pair;
  const moderation = fr.moderation;
  return {
    slug,
    moderation: {
      status: moderation?.status ?? "draft",
      notes: moderation?.notes ?? null,
      submittedAt: moderation?.submittedAt?.toISOString() ?? null,
      reviewedAt: moderation?.reviewedAt?.toISOString() ?? null,
      changesPending: changesPendingOf(moderation),
      unpublishedBy: moderation?.unpublishedBy ?? null,
    },
    live: fr.status === "published",
    inNews: fr.listInLibrary === true,
    fields: {
      titleFr: fr.title,
      titleEn: en.title,
      summaryFr: fr.summary ?? "",
      summaryEn: en.summary ?? "",
      contentHtmlFr: fr.contentHtml ?? "",
      contentHtmlEn: en.contentHtml ?? "",
      iconUrl: fr.iconUrl ?? null,
    },
    missing: missingOf(fr),
    url: articleUrl(slug),
  };
}

export interface ProfessionalArticleRow {
  slug: string;
  title: string;
  status: ProductModerationStatus;
  live: boolean;
  inNews: boolean;
  changesPending: boolean;
  updatedAt: string;
}

export async function listProfessionalArticles(professionalId: string): Promise<ProfessionalArticleRow[]> {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) return [];
  await connectToDatabase();
  const rows = await ContentEntry.find({ kind: KIND, ownerProfessionalId: professionalId, locale: "fr" })
    .sort({ updatedAt: -1 })
    .limit(200);
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    status: row.moderation?.status ?? "draft",
    live: row.status === "published",
    inNews: row.listInLibrary === true,
    changesPending: changesPendingOf(row.moderation),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * The professional's edit. HTML is sanitized here, English follows the French text until written.
 * An article under review is not edited (withdraw it first); a live article stays live with its
 * changes flagged for the team.
 */
export async function updateArticle(input: { professionalId: string; slug: string; body: unknown }): Promise<{ ok: true } | ArticleFailure> {
  const pair = await loadPair(input.slug, { ownerProfessionalId: input.professionalId });
  if (!pair) return fail(404, "NOT_FOUND");
  const { fr, en } = pair;
  if (fr.moderation?.status === "submitted") return fail(409, "UNDER_REVIEW");
  const parsed = parseArticleWrite(input.body);
  if (!parsed.ok) return fail(400, parsed.code, { field: parsed.field });
  const v = parsed.value;
  const frBefore = { title: fr.title, summary: fr.summary ?? "", contentHtml: fr.contentHtml ?? "" };

  if (v.titleFr !== undefined) fr.title = v.titleFr;
  if (v.titleEn !== undefined) en.title = v.titleEn || fr.title;
  if (v.summaryFr !== undefined) fr.summary = v.summaryFr;
  if (v.summaryEn !== undefined) en.summary = v.summaryEn || fr.summary;
  if (v.contentHtmlFr !== undefined) fr.contentHtml = sanitizeProductHtml(v.contentHtmlFr);
  if (v.contentHtmlEn !== undefined) en.contentHtml = sanitizeProductHtml(v.contentHtmlEn) || fr.contentHtml;
  const follows = (enValue: string | undefined, frOld: string) => !enValue || enValue === frOld;
  if (v.titleEn === undefined && follows(en.title, frBefore.title)) en.title = fr.title;
  if (v.summaryEn === undefined && follows(en.summary, frBefore.summary)) en.summary = fr.summary;
  if (v.contentHtmlEn === undefined && follows(en.contentHtml, frBefore.contentHtml)) en.contentHtml = fr.contentHtml;

  for (const row of [fr, en]) {
    if (v.iconUrl !== undefined) row.iconUrl = v.iconUrl ?? undefined;
    row.updatedBy = new mongoose.Types.ObjectId(input.professionalId);
    if (row.moderation) row.moderation.revision = (row.moderation.revision ?? 1) + 1;
    row.markModified("moderation");
  }
  await Promise.all([fr.save(), en.save()]);
  return { ok: true };
}

export async function professionalArticleAction(input: {
  professionalId: string;
  slug: string;
  action: "submit" | "withdraw" | "unpublish";
  attest?: boolean;
}): Promise<{ ok: true; status: ProductModerationStatus } | ArticleFailure> {
  const pair = await loadPair(input.slug, { ownerProfessionalId: input.professionalId });
  if (!pair) return fail(404, "NOT_FOUND");
  const { fr, en } = pair;
  const from = fr.moderation?.status ?? "draft";
  const to = productTransition(from, input.action, "professional");
  if (!to) return fail(409, "TRANSITION_NOT_ALLOWED", { from });
  const now = new Date();

  if (input.action === "submit") {
    if (!(await ownerIsActive(input.professionalId))) return fail(403, "ACCOUNT_NOT_ACTIVE");
    const missing: ArticleRequirement[] = missingOf(fr);
    if (input.attest !== true) missing.push("attestation");
    if (missing.length > 0) return fail(400, "INCOMPLETE", { missing });
  }

  for (const row of [fr, en]) {
    const moderation = row.moderation ?? { status: from, revision: 1, history: [] };
    moderation.status = to;
    if (input.action === "submit") {
      moderation.submittedAt = now;
      moderation.attestedAt = now;
      moderation.notes = undefined;
    }
    if (input.action === "unpublish") moderation.unpublishedBy = "professional";
    moderation.history = [...(moderation.history ?? []), { at: now, action: input.action, actor: "professional" }];
    row.moderation = moderation;
    row.markModified("moderation");
  }
  await Promise.all([fr.save(), en.save()]);
  await syncArticleLiveStatus(input.slug);

  if (input.action === "submit") {
    const owner = await User.findById(input.professionalId).select("firstName lastName").lean();
    await settle("submission alert", () =>
      sendAdminArticleSubmittedAlert({
        professionalName: `${owner?.firstName ?? ""} ${owner?.lastName ?? ""}`.trim(),
        articleTitle: fr.title,
        slug: input.slug,
      }),
    );
  }
  return { ok: true, status: to };
}

/** Delete an article (there is nothing to keep for anyone: it is free). */
export async function deleteArticle(input: { professionalId: string; slug: string }): Promise<{ ok: true } | ArticleFailure> {
  const pair = await loadPair(input.slug, { ownerProfessionalId: input.professionalId });
  if (!pair) return fail(404, "NOT_FOUND");
  await ContentEntry.deleteMany({ kind: KIND, slug: input.slug, ownerProfessionalId: input.professionalId });
  return { ok: true };
}

/* ------------------------------------------------------------------------ */
/* The team's side                                                            */
/* ------------------------------------------------------------------------ */

export interface AdminArticleRow {
  slug: string;
  title: string;
  professionalId: string;
  professionalName: string;
  status: ProductModerationStatus;
  live: boolean;
  inNews: boolean;
  changesPending: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  notes: string | null;
  url: string;
}

export async function listArticlesForAdmin(scope: "review" | "all"): Promise<AdminArticleRow[]> {
  await connectToDatabase();
  const filter: Record<string, unknown> = { kind: KIND, ownerProfessionalId: { $exists: true }, locale: "fr" };
  if (scope === "review") {
    filter.$or = [
      { "moderation.status": "submitted" },
      { "moderation.status": "approved", $expr: { $lt: [{ $ifNull: ["$moderation.approvedRevision", 0] }, "$moderation.revision"] } },
    ];
  }
  const rows = await ContentEntry.find(filter).sort({ "moderation.submittedAt": 1, updatedAt: -1 }).limit(500);
  const owners = await User.find({ _id: { $in: rows.map((row) => row.ownerProfessionalId) } })
    .select("firstName lastName")
    .lean();
  const names = new Map(owners.map((owner) => [String(owner._id), `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim()]));
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    professionalId: String(row.ownerProfessionalId),
    professionalName: names.get(String(row.ownerProfessionalId)) ?? "",
    status: row.moderation?.status ?? "draft",
    live: row.status === "published",
    inNews: row.listInLibrary === true,
    changesPending: changesPendingOf(row.moderation),
    submittedAt: row.moderation?.submittedAt?.toISOString() ?? null,
    reviewedAt: row.moderation?.reviewedAt?.toISOString() ?? null,
    notes: row.moderation?.notes ?? null,
    url: articleUrl(row.slug),
  }));
}

export type AdminArticleAction = "approve" | "reject" | "unpublish" | "feature" | "unfeature";

/**
 * The team's decision. Approving sanitizes the text again and also accepts a live article's changes;
 * rejecting needs notes; taking down is always possible. Featuring puts an approved article in
 * « Nouveautés » too (and unfeaturing takes it out); it changes nothing else and sends no email.
 */
export async function adminArticleAction(input: {
  adminId: string;
  slug: string;
  action: AdminArticleAction;
  notes?: unknown;
}): Promise<{ ok: true; status: ProductModerationStatus } | ArticleFailure> {
  const pair = await loadPair(input.slug);
  if (!pair) return fail(404, "NOT_FOUND");
  const { fr, en } = pair;
  const from = fr.moderation?.status ?? "draft";
  const now = new Date();

  if (input.action === "feature" || input.action === "unfeature") {
    if (from !== "approved") return fail(409, "TRANSITION_NOT_ALLOWED", { from });
    for (const row of [fr, en]) {
      row.listInLibrary = input.action === "feature";
      if (row.moderation) {
        row.moderation.history = [...(row.moderation.history ?? []), { at: now, action: input.action, actor: "admin" }];
        row.markModified("moderation");
      }
    }
    await Promise.all([fr.save(), en.save()]);
    return { ok: true, status: from };
  }

  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "";
  const approvingChanges = input.action === "approve" && from === "approved" && changesPendingOf(fr.moderation);
  const to = approvingChanges ? "approved" : productTransition(from, input.action, "admin");
  if (!to) return fail(409, "TRANSITION_NOT_ALLOWED", { from });
  if (input.action === "reject" && !notes) return fail(400, "NOTES_REQUIRED");

  for (const row of [fr, en]) {
    if (input.action === "approve") row.contentHtml = sanitizeProductHtml(row.contentHtml ?? "");
    if (input.action === "unpublish") row.listInLibrary = false;
    const moderation = row.moderation ?? { status: from, revision: 1, history: [] };
    moderation.status = to;
    moderation.reviewedAt = now;
    moderation.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
    moderation.notes = notes || undefined;
    if (input.action === "approve") moderation.approvedRevision = moderation.revision ?? 1;
    if (input.action === "unpublish") moderation.unpublishedBy = "admin";
    moderation.history = [
      ...(moderation.history ?? []),
      { at: now, action: approvingChanges ? "approve_changes" : input.action, actor: "admin", ...(notes ? { notes } : {}) },
    ];
    row.moderation = moderation;
    row.markModified("moderation");
  }
  await Promise.all([fr.save(), en.save()]);
  const live = await syncArticleLiveStatus(input.slug);

  const owner = await User.findById(fr.ownerProfessionalId).select("firstName lastName email language").lean();
  if (owner?.email && !approvingChanges) {
    await settle("decision email", () =>
      sendArticleModerationDecisionEmail({
        professionalName: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim(),
        professionalEmail: owner.email,
        articleTitle: fr.title,
        decision: input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "unpublished",
        notes: notes || null,
        articleUrl: live ? articleUrl(input.slug) : null,
        locale: owner.language,
      }),
    );
  }
  return { ok: true, status: to };
}

/* ------------------------------------------------------------------------ */
/* Public                                                                     */
/* ------------------------------------------------------------------------ */

export interface ShowcaseArticleCard {
  slug: string;
  title: string;
  summary: string;
  iconUrl: string | null;
  publishedAt: string | null;
  url: string;
}

/** A professional's live articles for their page, newest first. */
export async function listShowcaseArticles(showcaseSlug: string, locale: "fr" | "en"): Promise<ShowcaseArticleCard[]> {
  await connectToDatabase();
  const page = await ShowcasePage.findOne({ slug: showcaseSlug, status: "published" }).select("userId").lean<{ userId: unknown } | null>();
  if (!page) return [];
  const rows = await ContentEntry.find({
    kind: KIND,
    ownerProfessionalId: page.userId,
    locale,
    status: "published",
    "moderation.status": "approved",
  })
    .select("slug title summary iconUrl publishedAt")
    .sort({ publishedAt: -1 })
    .limit(12)
    .lean<Pick<IContentEntry, "slug" | "title" | "summary" | "iconUrl" | "publishedAt">[]>();
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? "",
    iconUrl: row.iconUrl ?? null,
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    url: articleUrl(row.slug),
  }));
}

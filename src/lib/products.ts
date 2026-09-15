import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ContentEntry, { type IContentEntry } from "@/models/ContentEntry";
import ResourceEntitlement from "@/models/ResourceEntitlement";
import StoredFile from "@/models/StoredFile";
import User from "@/models/User";
import ShowcasePage from "@/models/ShowcasePage";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import { sanitizeProductHtml } from "@/lib/product-html";
import { syncProductLedger } from "@/lib/product-ledger";
import { syncProfessionalArticles } from "@/lib/articles";
import {
  parseProductWrite,
  productIsLive,
  productMissing,
  productSlugCandidates,
  productTransition,
  type ProductModerationStatus,
  type ProductRequirement,
  type ProductType,
  type ProductWriteError,
} from "@/lib/product-rules";
import {
  sendAdminProductSubmittedAlert,
  sendProductModerationDecisionEmail,
  sendProductSoldEmail,
} from "@/lib/notifications";

/**
 * Trainings and digital products a professional publishes and sells (spec 003
 * phase 5): creating, editing, sending for review, the team's decision, and
 * what the public sees. Rules in lib/product-rules.ts; money in
 * lib/product-ledger.ts.
 *
 * A product is two `ContentEntry` rows (fr, en) of kind "resource" sharing a
 * slug, owned by the professional. Everything the checkout and the paywall
 * need is mirrored on both rows, like the team's premium resources. The
 * stored `status` — the one switch every public surface reads — is written
 * only by syncProductLiveStatus.
 */

export type ProductFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  code:
    | ProductWriteError
    | "INVALID_TYPE"
    | "NOT_FOUND"
    | "UNDER_REVIEW"
    | "TRANSITION_NOT_ALLOWED"
    | "INCOMPLETE"
    | "NOTES_REQUIRED"
    | "HAS_SALES"
    | "ACCOUNT_NOT_ACTIVE";
  details?: Record<string, unknown>;
};

function fail(status: ProductFailure["status"], code: ProductFailure["code"], details?: Record<string, unknown>): ProductFailure {
  return { ok: false, status, code, ...(details ? { details } : {}) };
}

function mediaTypeOf(type: ProductType): "video" | "podcast" | "article" {
  return type === "video" ? "video" : type === "audio" ? "podcast" : "article";
}

async function settle(label: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`[products] ${label} failed:`, error);
  }
}

async function loadPair(slug: string, filter: Record<string, unknown> = {}) {
  if (typeof slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  await connectToDatabase();
  const rows = await ContentEntry.find({ kind: "resource", slug, ownerProfessionalId: { $exists: true }, ...filter });
  const fr = rows.find((row) => row.locale === "fr");
  const en = rows.find((row) => row.locale === "en");
  return fr && en ? { fr, en } : null;
}

async function ownerIsActive(professionalId: unknown): Promise<boolean> {
  return Boolean(await User.exists({ _id: professionalId, role: "professional", status: "active" }));
}

/**
 * Publish or hide a product's rows from its moderation state and its
 * professional's account. Called after every change that could move it.
 */
export async function syncProductLiveStatus(slug: string): Promise<boolean> {
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

/**
 * Publish or hide every product of one professional after their account
 * changed — deactivated, reactivated, anonymized or deleted — so a product
 * leaves the site with its professional at once. Returns how many products it
 * looked at.
 */
export async function syncProfessionalProducts(professionalId: string): Promise<number> {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) return 0;
  await connectToDatabase();
  const slugs = (await ContentEntry.distinct("slug", {
    kind: "resource",
    ownerProfessionalId: professionalId,
  })) as string[];
  for (const slug of slugs) await syncProductLiveStatus(slug);
  // The professional's articles follow their account the same way (every caller of this sync).
  await syncProfessionalArticles(professionalId);
  return slugs.length;
}

/**
 * Put right every product whose stored status disagrees with its moderation
 * and its professional's account: an account changed by a path that does not
 * sync, or a sync that failed half-way. Run by the products job; returns how
 * many products it corrected.
 */
export async function reconcileProductLiveStatus(): Promise<number> {
  await connectToDatabase();
  // Every other row is a draft that should stay one.
  const rows = await ContentEntry.find({
    kind: "resource",
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
    const live = productIsLive({
      moderation: row.moderation?.status ?? "draft",
      ownerActive: activeIds.has(String(row.ownerProfessionalId)),
    });
    if ((row.status === "published") !== live) stale.add(row.slug);
  }
  for (const slug of stale) await syncProductLiveStatus(slug);
  return stale.size;
}

/* ------------------------------------------------------------------------ */
/* The professional's side                                                    */
/* ------------------------------------------------------------------------ */

export async function createProduct(input: {
  professionalId: string;
  type: unknown;
  titleFr: unknown;
}): Promise<{ ok: true; slug: string } | ProductFailure> {
  const type = input.type;
  if (typeof type !== "string" || !["video", "audio", "pdf", "webinar", "external"].includes(type)) {
    return fail(400, "INVALID_TYPE");
  }
  const parsed = parseProductWrite(type as ProductType, { titleFr: input.titleFr });
  if (!parsed.ok || !parsed.value.titleFr) return fail(400, "INVALID_TITLE");
  const titleFr = parsed.value.titleFr;
  await connectToDatabase();
  const now = new Date();
  const productType = type as ProductType;
  const common = {
    kind: "resource" as const,
    ownerProfessionalId: new mongoose.Types.ObjectId(input.professionalId),
    productType,
    mediaType: mediaTypeOf(productType),
    isPremium: productType !== "external",
    priceCents: 0,
    status: "draft" as const,
    sortOrder: 100,
    listInLibrary: false,
    moderation: {
      status: "draft" as const,
      revision: 1,
      history: [{ at: now, action: "create", actor: "professional" as const }],
    },
    updatedBy: new mongoose.Types.ObjectId(input.professionalId),
  };

  for (const slug of productSlugCandidates(titleFr)) {
    if (await ContentEntry.exists({ kind: "resource", slug })) continue;
    try {
      await ContentEntry.insertMany([
        { ...common, slug, locale: "fr", title: titleFr, summary: "", contentHtml: "", previewHtml: "" },
        { ...common, slug, locale: "en", title: titleFr, summary: "", contentHtml: "", previewHtml: "" },
      ]);
      return { ok: true, slug };
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        await ContentEntry.deleteMany({ kind: "resource", slug, ownerProfessionalId: common.ownerProfessionalId });
        continue;
      }
      throw error;
    }
  }
  return fail(409, "INVALID_TITLE");
}

export interface ProductEditorView {
  slug: string;
  type: ProductType;
  moderation: {
    status: ProductModerationStatus;
    notes: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    changesPending: boolean;
    attested: boolean;
    unpublishedBy: "professional" | "admin" | null;
  };
  live: boolean;
  fields: {
    titleFr: string;
    titleEn: string;
    summaryFr: string;
    summaryEn: string;
    contentHtmlFr: string;
    contentHtmlEn: string;
    previewHtmlFr: string;
    previewHtmlEn: string;
    iconUrl: string | null;
    priceCents: number;
    mediaUrlFr: string | null;
    mediaUrlEn: string | null;
    externalUrl: string | null;
    webinarStartsAt: string | null;
    webinarDurationMinutes: number | null;
    webinarJoinUrl: string | null;
    webinarReplayUrl: string | null;
    listInLibrary: boolean;
  };
  file: { fr: { name: string; size: number } | null; en: { name: string; size: number } | null };
  missing: ProductRequirement[];
  sales: number;
  url: string;
}

async function fileSummary(id: unknown): Promise<{ name: string; size: number } | null> {
  if (!id) return null;
  const file = await StoredFile.findById(id).select("fileName fileSize").lean<{ fileName: string; fileSize: number } | null>();
  return file ? { name: file.fileName, size: file.fileSize } : null;
}

function missingOf(fr: IContentEntry, hasFile: boolean): ProductRequirement[] {
  const type = fr.productType ?? "pdf";
  return productMissing({
    type,
    titleFr: fr.title,
    summaryFr: fr.summary ?? "",
    contentHtmlFr: fr.contentHtml ?? "",
    priceCents: fr.priceCents ?? 0,
    mediaUrlFr: fr.mediaUrl ?? null,
    hasFile,
    externalUrl: fr.externalUrl ?? null,
    webinarStartsAt: fr.webinar?.startsAt ?? null,
    webinarJoinUrl: fr.webinarAccess?.joinUrl ?? null,
    attested: true,
  }).filter((item) => item !== "attestation");
}

async function paidSales(slug: string): Promise<number> {
  return ResourceEntitlement.countDocuments({ slug, status: "paid" });
}

export async function loadProductEditor(professionalId: string, slug: string): Promise<ProductEditorView | null> {
  const pair = await loadPair(slug, { ownerProfessionalId: professionalId });
  if (!pair) return null;
  const { fr, en } = pair;
  const moderation = fr.moderation;
  const [fileFr, fileEn, sales] = await Promise.all([fileSummary(fr.productFileId), fileSummary(en.productFileId), paidSales(slug)]);
  return {
    slug,
    type: fr.productType ?? "pdf",
    moderation: {
      status: moderation?.status ?? "draft",
      notes: moderation?.notes ?? null,
      submittedAt: moderation?.submittedAt?.toISOString() ?? null,
      reviewedAt: moderation?.reviewedAt?.toISOString() ?? null,
      changesPending:
        moderation?.status === "approved" && (moderation.approvedRevision ?? 0) < (moderation.revision ?? 1),
      attested: Boolean(moderation?.attestedAt),
      unpublishedBy: moderation?.unpublishedBy ?? null,
    },
    live: fr.status === "published",
    fields: {
      titleFr: fr.title,
      titleEn: en.title,
      summaryFr: fr.summary ?? "",
      summaryEn: en.summary ?? "",
      contentHtmlFr: fr.contentHtml ?? "",
      contentHtmlEn: en.contentHtml ?? "",
      previewHtmlFr: fr.previewHtml ?? "",
      previewHtmlEn: en.previewHtml ?? "",
      iconUrl: fr.iconUrl ?? null,
      priceCents: fr.priceCents ?? 0,
      mediaUrlFr: fr.mediaUrl ?? null,
      mediaUrlEn: en.mediaUrl ?? null,
      externalUrl: fr.externalUrl ?? null,
      webinarStartsAt: fr.webinar?.startsAt?.toISOString() ?? null,
      webinarDurationMinutes: fr.webinar?.durationMinutes ?? null,
      webinarJoinUrl: fr.webinarAccess?.joinUrl ?? null,
      webinarReplayUrl: fr.webinarAccess?.replayUrl ?? null,
      listInLibrary: fr.listInLibrary === true,
    },
    file: { fr: fileFr, en: fileEn },
    missing: missingOf(fr, Boolean(fileFr)),
    sales,
    url: canonicalSiteUrl(`/book/${slug}`),
  };
}

export interface ProfessionalProductRow {
  slug: string;
  type: ProductType;
  title: string;
  priceCents: number;
  status: ProductModerationStatus;
  live: boolean;
  changesPending: boolean;
  sales: number;
  updatedAt: string;
}

export async function listProfessionalProducts(professionalId: string): Promise<ProfessionalProductRow[]> {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) return [];
  await connectToDatabase();
  const rows = await ContentEntry.find({ kind: "resource", ownerProfessionalId: professionalId, locale: "fr" })
    .sort({ updatedAt: -1 })
    .limit(200);
  const counts = await ResourceEntitlement.aggregate<{ _id: string; n: number }>([
    { $match: { slug: { $in: rows.map((row) => row.slug) }, status: "paid" } },
    { $group: { _id: "$slug", n: { $sum: 1 } } },
  ]);
  const sales = new Map(counts.map((row) => [row._id, row.n]));
  return rows.map((row) => ({
    slug: row.slug,
    type: row.productType ?? "pdf",
    title: row.title,
    priceCents: row.priceCents ?? 0,
    status: row.moderation?.status ?? "draft",
    live: row.status === "published",
    changesPending:
      row.moderation?.status === "approved" && (row.moderation.approvedRevision ?? 0) < (row.moderation.revision ?? 1),
    sales: sales.get(row.slug) ?? 0,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * The professional's edit. HTML is sanitized here, English falls back to the
 * French text, and the price, links and webinar are mirrored. A product under
 * review is not edited (withdraw it first); a live product stays live with its
 * changes flagged for the team.
 */
export async function updateProduct(input: {
  professionalId: string;
  slug: string;
  body: unknown;
}): Promise<{ ok: true } | ProductFailure> {
  const pair = await loadPair(input.slug, { ownerProfessionalId: input.professionalId });
  if (!pair) return fail(404, "NOT_FOUND");
  const { fr, en } = pair;
  if (fr.moderation?.status === "submitted") return fail(409, "UNDER_REVIEW");
  const type = fr.productType ?? "pdf";
  const parsed = parseProductWrite(type, input.body);
  if (!parsed.ok) return fail(400, parsed.code, { field: parsed.field });
  const v = parsed.value;
  // English follows the French text until the professional writes it: a field
  // still empty, or still equal to the French it was copied from, is copied again.
  const frBefore = {
    title: fr.title,
    summary: fr.summary ?? "",
    contentHtml: fr.contentHtml ?? "",
    previewHtml: fr.previewHtml ?? "",
    mediaUrl: fr.mediaUrl ?? "",
  };

  if (v.titleFr !== undefined) fr.title = v.titleFr;
  if (v.titleEn !== undefined) en.title = v.titleEn || fr.title;
  if (v.summaryFr !== undefined) fr.summary = v.summaryFr;
  if (v.summaryEn !== undefined) en.summary = v.summaryEn || fr.summary;
  if (v.contentHtmlFr !== undefined) fr.contentHtml = sanitizeProductHtml(v.contentHtmlFr);
  if (v.contentHtmlEn !== undefined) en.contentHtml = sanitizeProductHtml(v.contentHtmlEn) || fr.contentHtml;
  if (v.previewHtmlFr !== undefined) fr.previewHtml = sanitizeProductHtml(v.previewHtmlFr);
  if (v.previewHtmlEn !== undefined) en.previewHtml = sanitizeProductHtml(v.previewHtmlEn) || fr.previewHtml;
  if (v.mediaUrlFr !== undefined) fr.mediaUrl = v.mediaUrlFr ?? undefined;
  if (v.mediaUrlEn !== undefined) en.mediaUrl = v.mediaUrlEn ?? fr.mediaUrl;
  const follows = (enValue: string | undefined, frOld: string) => !enValue || enValue === frOld;
  if (v.titleEn === undefined && follows(en.title, frBefore.title)) en.title = fr.title;
  if (v.summaryEn === undefined && follows(en.summary, frBefore.summary)) en.summary = fr.summary;
  if (v.contentHtmlEn === undefined && follows(en.contentHtml, frBefore.contentHtml)) en.contentHtml = fr.contentHtml;
  if (v.previewHtmlEn === undefined && follows(en.previewHtml, frBefore.previewHtml)) en.previewHtml = fr.previewHtml;
  if (v.mediaUrlEn === undefined && follows(en.mediaUrl, frBefore.mediaUrl)) en.mediaUrl = fr.mediaUrl;

  for (const row of [fr, en]) {
    if (v.iconUrl !== undefined) row.iconUrl = v.iconUrl ?? undefined;
    if (v.priceCents !== undefined) {
      row.priceCents = v.priceCents;
      row.isPremium = type !== "external" && v.priceCents > 0;
    }
    if (v.externalUrl !== undefined) row.externalUrl = v.externalUrl ?? undefined;
    if (v.webinarStartsAt !== undefined || v.webinarDurationMinutes !== undefined) {
      row.webinar = {
        startsAt:
          v.webinarStartsAt !== undefined ? (v.webinarStartsAt ? new Date(v.webinarStartsAt) : undefined) : row.webinar?.startsAt,
        durationMinutes:
          v.webinarDurationMinutes !== undefined ? (v.webinarDurationMinutes ?? undefined) : row.webinar?.durationMinutes,
      };
    }
    if (v.webinarJoinUrl !== undefined || v.webinarReplayUrl !== undefined) {
      row.webinarAccess = {
        joinUrl: v.webinarJoinUrl !== undefined ? (v.webinarJoinUrl ?? undefined) : row.webinarAccess?.joinUrl,
        replayUrl: v.webinarReplayUrl !== undefined ? (v.webinarReplayUrl ?? undefined) : row.webinarAccess?.replayUrl,
      };
    }
    if (v.listInLibrary !== undefined) row.listInLibrary = v.listInLibrary;
    row.updatedBy = new mongoose.Types.ObjectId(input.professionalId);
    if (row.moderation) row.moderation.revision = (row.moderation.revision ?? 1) + 1;
    row.markModified("moderation");
  }
  // A premium product with no teaser shows its summary above the price.
  for (const row of [fr, en]) {
    if (row.isPremium && !row.previewHtml?.trim() && row.summary?.trim()) {
      row.previewHtml = sanitizeProductHtml(`<p>${row.summary.trim().replace(/[<>&]/g, "")}</p>`);
    }
  }
  await Promise.all([fr.save(), en.save()]);
  return { ok: true };
}

export async function professionalProductAction(input: {
  professionalId: string;
  slug: string;
  action: "submit" | "withdraw" | "unpublish";
  attest?: boolean;
}): Promise<{ ok: true; status: ProductModerationStatus } | ProductFailure> {
  const pair = await loadPair(input.slug, { ownerProfessionalId: input.professionalId });
  if (!pair) return fail(404, "NOT_FOUND");
  const { fr, en } = pair;
  const from = fr.moderation?.status ?? "draft";
  const to = productTransition(from, input.action, "professional");
  if (!to) return fail(409, "TRANSITION_NOT_ALLOWED", { from });
  const now = new Date();

  if (input.action === "submit") {
    if (!(await ownerIsActive(input.professionalId))) return fail(403, "ACCOUNT_NOT_ACTIVE");
    const hasFile = Boolean(fr.productFileId && (await StoredFile.exists({ _id: fr.productFileId, kind: "product-file" })));
    const missing = missingOf(fr, hasFile);
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
  await syncProductLiveStatus(input.slug);

  if (input.action === "submit") {
    const owner = await User.findById(input.professionalId).select("firstName lastName").lean();
    await settle("submission alert", () =>
      sendAdminProductSubmittedAlert({
        professionalName: `${owner?.firstName ?? ""} ${owner?.lastName ?? ""}`.trim(),
        productTitle: fr.title,
        slug: input.slug,
      }),
    );
  }
  return { ok: true, status: to };
}

/** Delete a product nobody has bought. A product with sales can only be taken down. */
export async function deleteProduct(input: { professionalId: string; slug: string }): Promise<{ ok: true } | ProductFailure> {
  const pair = await loadPair(input.slug, { ownerProfessionalId: input.professionalId });
  if (!pair) return fail(404, "NOT_FOUND");
  if (await ResourceEntitlement.exists({ slug: input.slug, status: { $in: ["paid", "refunded"] } })) {
    return fail(409, "HAS_SALES");
  }
  const files = [pair.fr.productFileId, pair.en.productFileId].filter(Boolean);
  await ContentEntry.deleteMany({ kind: "resource", slug: input.slug, ownerProfessionalId: input.professionalId });
  if (files.length > 0) await StoredFile.deleteMany({ _id: { $in: files }, kind: "product-file" });
  return { ok: true };
}

/** Store a PDF as the product's file for a locale (English falls back to the French file). */
export async function attachProductFile(input: {
  professionalId: string;
  slug: string;
  locale: "fr" | "en";
  file: { buffer: Buffer; fileName: string; fileType: string; fileSize: number; scanStatus: string };
}): Promise<{ ok: true } | ProductFailure> {
  const pair = await loadPair(input.slug, { ownerProfessionalId: input.professionalId });
  if (!pair) return fail(404, "NOT_FOUND");
  if (pair.fr.productType !== "pdf") return fail(400, "INVALID_TYPE");
  if (pair.fr.moderation?.status === "submitted") return fail(409, "UNDER_REVIEW");
  const stored = await StoredFile.create({
    fileName: input.file.fileName,
    fileType: input.file.fileType,
    fileSize: input.file.fileSize,
    data: input.file.buffer,
    kind: "product-file",
    uploadedBy: input.professionalId,
    scanStatus: input.file.scanStatus,
  });
  const row = input.locale === "fr" ? pair.fr : pair.en;
  const previous = row.productFileId;
  row.productFileId = stored._id as mongoose.Types.ObjectId;
  const targets = input.locale === "fr" && !pair.en.productFileId ? [row, pair.en] : [row];
  for (const target of targets) {
    target.productFileId = stored._id as mongoose.Types.ObjectId;
    if (target.moderation) {
      target.moderation.revision = (target.moderation.revision ?? 1) + 1;
      target.markModified("moderation");
    }
    await target.save();
  }
  // A file a buyer may still be downloading is only replaced, never deleted while referenced.
  if (previous && !(await ContentEntry.exists({ productFileId: previous }))) {
    await StoredFile.deleteOne({ _id: previous, kind: "product-file" });
  }
  return { ok: true };
}

/* ------------------------------------------------------------------------ */
/* The team's side                                                            */
/* ------------------------------------------------------------------------ */

export interface AdminProductRow {
  slug: string;
  type: ProductType;
  title: string;
  professionalId: string;
  professionalName: string;
  priceCents: number;
  status: ProductModerationStatus;
  live: boolean;
  changesPending: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  notes: string | null;
  sales: number;
  url: string;
}

export async function listProductsForAdmin(scope: "review" | "all"): Promise<AdminProductRow[]> {
  await connectToDatabase();
  const filter: Record<string, unknown> = { kind: "resource", ownerProfessionalId: { $exists: true }, locale: "fr" };
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
  const counts = await ResourceEntitlement.aggregate<{ _id: string; n: number }>([
    { $match: { slug: { $in: rows.map((row) => row.slug) }, status: "paid" } },
    { $group: { _id: "$slug", n: { $sum: 1 } } },
  ]);
  const sales = new Map(counts.map((row) => [row._id, row.n]));
  return rows.map((row) => ({
    slug: row.slug,
    type: row.productType ?? "pdf",
    title: row.title,
    professionalId: String(row.ownerProfessionalId),
    professionalName: names.get(String(row.ownerProfessionalId)) ?? "",
    priceCents: row.priceCents ?? 0,
    status: row.moderation?.status ?? "draft",
    live: row.status === "published",
    changesPending:
      row.moderation?.status === "approved" && (row.moderation.approvedRevision ?? 0) < (row.moderation.revision ?? 1),
    submittedAt: row.moderation?.submittedAt?.toISOString() ?? null,
    reviewedAt: row.moderation?.reviewedAt?.toISOString() ?? null,
    notes: row.moderation?.notes ?? null,
    sales: sales.get(row.slug) ?? 0,
    url: canonicalSiteUrl(`/book/${row.slug}`),
  }));
}

/**
 * The team's decision. Approving sanitizes the text again (a second pass over
 * whatever reached the database) and also accepts the changes of a live
 * product; rejecting needs notes; taking down is always possible.
 */
export async function adminProductAction(input: {
  adminId: string;
  slug: string;
  action: "approve" | "reject" | "unpublish";
  notes?: unknown;
}): Promise<{ ok: true; status: ProductModerationStatus } | ProductFailure> {
  const pair = await loadPair(input.slug);
  if (!pair) return fail(404, "NOT_FOUND");
  const { fr, en } = pair;
  const from = fr.moderation?.status ?? "draft";
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "";
  const approvingChanges =
    input.action === "approve" && from === "approved" && (fr.moderation?.approvedRevision ?? 0) < (fr.moderation?.revision ?? 1);
  const to = approvingChanges ? "approved" : productTransition(from, input.action, "admin");
  if (!to) return fail(409, "TRANSITION_NOT_ALLOWED", { from });
  if (input.action === "reject" && !notes) return fail(400, "NOTES_REQUIRED");
  const now = new Date();

  for (const row of [fr, en]) {
    if (input.action === "approve") {
      row.contentHtml = sanitizeProductHtml(row.contentHtml ?? "");
      row.previewHtml = sanitizeProductHtml(row.previewHtml ?? "");
    }
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
  const live = await syncProductLiveStatus(input.slug);

  const owner = await User.findById(fr.ownerProfessionalId).select("firstName lastName email language").lean();
  if (owner?.email && !approvingChanges) {
    await settle("decision email", () =>
      sendProductModerationDecisionEmail({
        professionalName: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim(),
        professionalEmail: owner.email,
        productTitle: fr.title,
        decision: input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "unpublished",
        notes: notes || null,
        productUrl: live ? canonicalSiteUrl(`/book/${input.slug}`) : null,
        locale: owner.language,
      }),
    );
  }
  return { ok: true, status: to };
}

/* ------------------------------------------------------------------------ */
/* Sales                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Bring the professional's ledger to what a purchase is worth to them, and
 * tell them about a new sale. Called by the webhook and the checkout
 * confirmation for every event a product purchase goes through; idempotent.
 * Throws on a database error so the webhook is retried.
 */
export async function settleProductPurchase(entitlementId: string): Promise<void> {
  const outcome = await syncProductLedger(entitlementId);
  if (!outcome.changed || outcome.source !== "product_sale") return;
  const ent = await ResourceEntitlement.findById(entitlementId)
    .select("slug ownerProfessionalId amountCents subtotalCents locale")
    .lean();
  if (!ent?.ownerProfessionalId) return;
  const [owner, entry] = await Promise.all([
    User.findById(ent.ownerProfessionalId).select("firstName lastName email language").lean(),
    ContentEntry.findOne({ kind: "resource", slug: ent.slug, locale: "fr" }).select("title").lean(),
  ]);
  if (!owner?.email) return;
  await settle("sale email", () =>
    sendProductSoldEmail({
      professionalName: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim(),
      professionalEmail: owner.email,
      productTitle: entry?.title ?? ent.slug,
      // The sale's price, before any TPS and TVQ the buyer paid on top.
      amountCents: typeof ent.subtotalCents === "number" ? ent.subtotalCents : ent.amountCents,
      netCents: outcome.netCents,
      locale: owner.language,
    }),
  );
}

/* ------------------------------------------------------------------------ */
/* Public                                                                     */
/* ------------------------------------------------------------------------ */

export interface ShowcaseProductCard {
  slug: string;
  type: ProductType;
  title: string;
  summary: string;
  iconUrl: string | null;
  priceCents: number;
  webinarStartsAt: string | null;
  url: string;
}

/** A professional's live products for their showcase page, newest first. */
export async function listShowcaseProducts(showcaseSlug: string, locale: "fr" | "en"): Promise<ShowcaseProductCard[]> {
  await connectToDatabase();
  const page = await ShowcasePage.findOne({ slug: showcaseSlug, status: "published" }).select("userId").lean<{ userId: unknown } | null>();
  if (!page) return [];
  const rows = await ContentEntry.find({
    kind: "resource",
    ownerProfessionalId: page.userId,
    locale,
    status: "published",
    "moderation.status": "approved",
  })
    .select("slug productType title summary iconUrl priceCents webinar")
    .sort({ publishedAt: -1 })
    .limit(12)
    .lean<Pick<IContentEntry, "slug" | "productType" | "title" | "summary" | "iconUrl" | "priceCents" | "webinar">[]>();
  return rows.map((row) => ({
    slug: row.slug,
    type: row.productType ?? "pdf",
    title: row.title,
    summary: row.summary ?? "",
    iconUrl: row.iconUrl ?? null,
    priceCents: row.priceCents ?? 0,
    webinarStartsAt: row.webinar?.startsAt ? new Date(row.webinar.startsAt).toISOString() : null,
    url: canonicalSiteUrl(`/book/${row.slug}`),
  }));
}

/** Who wrote a product, for the reader's byline: the name and their page when it is public. */
export async function productByline(ownerId: string): Promise<{ name: string; pageUrl: string | null } | null> {
  if (!mongoose.Types.ObjectId.isValid(ownerId)) return null;
  await connectToDatabase();
  const [owner, page] = await Promise.all([
    User.findOne({ _id: ownerId, role: "professional", status: "active" }).select("firstName lastName").lean(),
    ShowcasePage.findOne({ userId: ownerId, status: "published" }).select("slug cityKey published.displayName").lean<{
      slug: string;
      cityKey: string;
      published?: { displayName?: string };
    } | null>(),
  ]);
  if (!owner) return null;
  const { showcasePageUrl } = await import("@/lib/showcase-hosts");
  return {
    name: page?.published?.displayName?.trim() || `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim(),
    pageUrl: page ? showcasePageUrl(page.slug) : null,
  };
}

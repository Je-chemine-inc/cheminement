/**
 * Rules of the trainings and digital products professionals publish and sell
 * (spec 003 phase 5). A product is a `ContentEntry` of kind "resource" with an
 * `ownerProfessionalId`: the same reader, checkout, entitlement and webhook as
 * the team's premium resources — no third system. Pure and client-safe.
 */

import { slugify } from "@/lib/content-kind";

export const PRODUCT_TYPES = ["video", "audio", "pdf", "webinar", "external"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export function isProductType(value: unknown): value is ProductType {
  return typeof value === "string" && (PRODUCT_TYPES as readonly string[]).includes(value);
}

/** What a professional may charge, in cents: 5 $ to 1 000 $. */
export const PRODUCT_MIN_PRICE_CENTS = 500;
export const PRODUCT_MAX_PRICE_CENTS = 100_000;

/** The platform's share when no setting is saved (it absorbs Stripe's fees). */
export const DEFAULT_PRODUCT_COMMISSION_PERCENTAGE = 20;

/** A product body or teaser larger than this is refused, not truncated. */
export const PRODUCT_HTML_MAX_BYTES = 200 * 1024;
export const PRODUCT_TITLE_MAX = 120;
export const PRODUCT_SUMMARY_MAX = 400;
export const PRODUCT_WEBINAR_MAX_MINUTES = 480;

/**
 * Where a product stands with the team.
 *   draft        — being written, never seen by the public
 *   submitted    — sent for review
 *   approved     — live (while its professional's account is active)
 *   rejected     — sent back with notes
 *   unpublished  — taken down by its professional or the team
 */
export const PRODUCT_MODERATION_STATUSES = ["draft", "submitted", "approved", "rejected", "unpublished"] as const;
export type ProductModerationStatus = (typeof PRODUCT_MODERATION_STATUSES)[number];

export type ProductAction = "submit" | "withdraw" | "approve" | "reject" | "unpublish";
export type ProductActor = "professional" | "admin";

/**
 * The only moves allowed. A professional sends, withdraws a submission and
 * takes a live product down; the team approves, rejects and takes down. A
 * product taken down comes back only through a new submission.
 */
const TRANSITIONS: Record<ProductAction, { actor: ProductActor; from: readonly ProductModerationStatus[]; to: ProductModerationStatus }> = {
  submit: { actor: "professional", from: ["draft", "rejected", "unpublished"], to: "submitted" },
  withdraw: { actor: "professional", from: ["submitted"], to: "draft" },
  approve: { actor: "admin", from: ["submitted"], to: "approved" },
  reject: { actor: "admin", from: ["submitted"], to: "rejected" },
  unpublish: { actor: "professional", from: ["approved"], to: "unpublished" },
};

export function productTransition(
  from: ProductModerationStatus,
  action: ProductAction,
  actor: ProductActor,
): ProductModerationStatus | null {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(from)) return null;
  // Taking a product down is open to both sides; everything else to its own.
  if (action === "unpublish") return rule.to;
  return rule.actor === actor ? rule.to : null;
}

/** A product is public only when approved and its professional's account is active. */
export function productIsLive(input: { moderation: ProductModerationStatus; ownerActive: boolean }): boolean {
  return input.moderation === "approved" && input.ownerActive;
}

/** Prices stay whole cents within the bounds; an external link is never sold. */
export function validateProductPrice(type: ProductType, priceCents: unknown): number | null {
  if (type === "external") return priceCents === 0 || priceCents === undefined || priceCents === null ? 0 : null;
  if (typeof priceCents !== "number" || !Number.isInteger(priceCents)) return null;
  return priceCents >= PRODUCT_MIN_PRICE_CENTS && priceCents <= PRODUCT_MAX_PRICE_CENTS ? priceCents : null;
}

/** The commission as basis points, from a percentage setting (0–100, two decimals at most). */
export function commissionBpsOf(percentage: unknown): number {
  const value = typeof percentage === "number" && Number.isFinite(percentage) ? percentage : DEFAULT_PRODUCT_COMMISSION_PERCENTAGE;
  return Math.round(Math.min(100, Math.max(0, value)) * 100);
}

/**
 * A sale split in integer cents: the platform's fee rounded to the cent, the
 * professional gets the rest — so fee + net is always the gross.
 * 49,00 $ at 20 % → fee 980, net 3 920.
 */
export function splitProductSaleCents(grossCents: number, commissionBps: number): { platformFeeCents: number; netToProfessionalCents: number } {
  const gross = Math.max(0, Math.round(grossCents));
  const bps = Math.min(10_000, Math.max(0, Math.round(commissionBps)));
  const platformFeeCents = Math.round((gross * bps) / 10_000);
  return { platformFeeCents, netToProfessionalCents: gross - platformFeeCents };
}

/** Addresses of the site a product slug must never shadow. */
const RESERVED_SLUGS = new Set(["new", "edit", "admin", "api", "preview", "file", "resources", "products", "produits"]);
const SLUG_MAX = 80;

/**
 * A product's address from its French title: unique among all resources,
 * never a reserved word, suffixed -2, -3… when taken. Immutable once created.
 */
export function productSlugCandidates(titleFr: string, count = 20): string[] {
  let base = slugify(titleFr).slice(0, SLUG_MAX).replace(/-+$/g, "");
  if (!base) base = "produit";
  if (RESERVED_SLUGS.has(base)) base = `${base}-produit`;
  const out = [base];
  for (let i = 2; out.length < count; i++) out.push(`${base.slice(0, SLUG_MAX - 4)}-${i}`);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Delivery                                                                   */
/* ------------------------------------------------------------------------ */

/** The embedded players a video or audio product may use — nothing else is framed. */
export const PRODUCT_FRAME_HOSTS = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.dailymotion.com",
  "https://www.loom.com",
  "https://open.spotify.com",
  "https://embed.podcasts.apple.com",
  "https://w.soundcloud.com",
] as const;

function httpsUrl(value: unknown, max = 2000): URL | null {
  if (typeof value !== "string" || value.length > max) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|dai\.ly|loom\.com)$/i;
const AUDIO_HOST = /(^|\.)(spotify\.com|podcasts\.apple\.com|soundcloud\.com)$/i;

/**
 * A professional's media link: https, and from a player the page can frame.
 * Direct files are refused — the site would serve someone else's bytes, and
 * nothing would stop the link circulating.
 */
export function isAllowedProductMediaUrl(type: "video" | "audio", value: unknown): boolean {
  const url = httpsUrl(value);
  if (!url) return false;
  return (type === "video" ? VIDEO_HOST : AUDIO_HOST).test(url.hostname);
}

/** A webinar's room or replay, and an external product's page: any https link. */
export function isHttpsLink(value: unknown): value is string {
  return httpsUrl(value) !== null;
}

/* ------------------------------------------------------------------------ */
/* What a professional may write                                              */
/* ------------------------------------------------------------------------ */

export interface ProductWriteInput {
  titleFr?: string;
  titleEn?: string;
  summaryFr?: string;
  summaryEn?: string;
  contentHtmlFr?: string;
  contentHtmlEn?: string;
  previewHtmlFr?: string;
  previewHtmlEn?: string;
  iconUrl?: string | null;
  priceCents?: number;
  mediaUrlFr?: string | null;
  mediaUrlEn?: string | null;
  externalUrl?: string | null;
  webinarStartsAt?: string | null;
  webinarDurationMinutes?: number | null;
  webinarJoinUrl?: string | null;
  webinarReplayUrl?: string | null;
  listInLibrary?: boolean;
}

/** The keys a professional may send. Anything else — status, owner, slug, moderation — is dropped. */
export const PRODUCT_WRITABLE_FIELDS = [
  "titleFr",
  "titleEn",
  "summaryFr",
  "summaryEn",
  "contentHtmlFr",
  "contentHtmlEn",
  "previewHtmlFr",
  "previewHtmlEn",
  "iconUrl",
  "priceCents",
  "mediaUrlFr",
  "mediaUrlEn",
  "externalUrl",
  "webinarStartsAt",
  "webinarDurationMinutes",
  "webinarJoinUrl",
  "webinarReplayUrl",
  "listInLibrary",
] as const;

export type ProductWriteError =
  | "INVALID_TITLE"
  | "INVALID_SUMMARY"
  | "INVALID_HTML"
  | "HTML_TOO_LARGE"
  | "INVALID_PRICE"
  | "INVALID_MEDIA_URL"
  | "INVALID_LINK"
  | "INVALID_WEBINAR"
  | "INVALID_IMAGE";

const FILE_URL = /^\/api\/files\/[a-f0-9]{24}$/;

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}

function optionalHtml(value: unknown): string | undefined | "TOO_LARGE" | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return new TextEncoder().encode(value).length > PRODUCT_HTML_MAX_BYTES ? "TOO_LARGE" : value;
}

/**
 * A professional's edit, checked field by field against the product's type.
 * `null` clears a link. HTML is only size-checked here; the server sanitizes it.
 */
export function parseProductWrite(
  type: ProductType,
  body: unknown,
): { ok: true; value: ProductWriteInput; dropped: string[] } | { ok: false; code: ProductWriteError; field: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "INVALID_TITLE", field: "body" };
  const input = body as Record<string, unknown>;
  const dropped = Object.keys(input).filter((key) => !(PRODUCT_WRITABLE_FIELDS as readonly string[]).includes(key));
  const value: ProductWriteInput = {};

  for (const field of ["titleFr", "titleEn"] as const) {
    const text = optionalText(input[field], PRODUCT_TITLE_MAX);
    if (text === null || (field === "titleFr" && text === "")) return { ok: false, code: "INVALID_TITLE", field };
    if (text !== undefined) value[field] = text;
  }
  for (const field of ["summaryFr", "summaryEn"] as const) {
    const text = optionalText(input[field], PRODUCT_SUMMARY_MAX);
    if (text === null) return { ok: false, code: "INVALID_SUMMARY", field };
    if (text !== undefined) value[field] = text;
  }
  for (const field of ["contentHtmlFr", "contentHtmlEn", "previewHtmlFr", "previewHtmlEn"] as const) {
    const html = optionalHtml(input[field]);
    if (html === null) return { ok: false, code: "INVALID_HTML", field };
    if (html === "TOO_LARGE") return { ok: false, code: "HTML_TOO_LARGE", field };
    if (html !== undefined) value[field] = html;
  }

  if (input.iconUrl !== undefined) {
    if (input.iconUrl !== null && input.iconUrl !== "" && (typeof input.iconUrl !== "string" || !FILE_URL.test(input.iconUrl))) {
      return { ok: false, code: "INVALID_IMAGE", field: "iconUrl" };
    }
    value.iconUrl = input.iconUrl ? String(input.iconUrl) : null;
  }

  if (input.priceCents !== undefined) {
    const price = validateProductPrice(type, input.priceCents);
    if (price === null) return { ok: false, code: "INVALID_PRICE", field: "priceCents" };
    value.priceCents = price;
  }

  for (const field of ["mediaUrlFr", "mediaUrlEn"] as const) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (raw === null || raw === "") {
      value[field] = null;
      continue;
    }
    if ((type !== "video" && type !== "audio") || !isAllowedProductMediaUrl(type, raw)) {
      return { ok: false, code: "INVALID_MEDIA_URL", field };
    }
    value[field] = String(raw).trim();
  }

  for (const field of ["externalUrl", "webinarJoinUrl", "webinarReplayUrl"] as const) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (raw === null || raw === "") {
      value[field] = null;
      continue;
    }
    const allowed = field === "externalUrl" ? type === "external" : type === "webinar";
    if (!allowed || !isHttpsLink(raw)) return { ok: false, code: "INVALID_LINK", field };
    value[field] = String(raw).trim();
  }

  if (input.webinarStartsAt !== undefined) {
    if (input.webinarStartsAt === null || input.webinarStartsAt === "") value.webinarStartsAt = null;
    else if (type !== "webinar" || typeof input.webinarStartsAt !== "string" || Number.isNaN(Date.parse(input.webinarStartsAt))) {
      return { ok: false, code: "INVALID_WEBINAR", field: "webinarStartsAt" };
    } else value.webinarStartsAt = new Date(input.webinarStartsAt).toISOString();
  }
  if (input.webinarDurationMinutes !== undefined) {
    const minutes = input.webinarDurationMinutes;
    if (minutes === null) value.webinarDurationMinutes = null;
    else if (
      type !== "webinar" ||
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < 15 ||
      minutes > PRODUCT_WEBINAR_MAX_MINUTES
    ) {
      return { ok: false, code: "INVALID_WEBINAR", field: "webinarDurationMinutes" };
    } else value.webinarDurationMinutes = minutes;
  }

  if (input.listInLibrary !== undefined) {
    if (typeof input.listInLibrary !== "boolean") return { ok: false, code: "INVALID_LINK", field: "listInLibrary" };
    value.listInLibrary = input.listInLibrary;
  }

  return { ok: true, value, dropped };
}

/** What a product must have before it can be sent for review. */
export type ProductRequirement = "title" | "summary" | "content" | "price" | "media" | "file" | "link" | "webinar" | "attestation";

export function productMissing(product: {
  type: ProductType;
  titleFr: string;
  summaryFr: string;
  contentHtmlFr: string;
  priceCents: number;
  mediaUrlFr?: string | null;
  hasFile: boolean;
  externalUrl?: string | null;
  webinarStartsAt?: string | Date | null;
  webinarJoinUrl?: string | null;
  attested: boolean;
}): ProductRequirement[] {
  const missing: ProductRequirement[] = [];
  if (!product.titleFr.trim()) missing.push("title");
  if (!product.summaryFr.trim()) missing.push("summary");
  if (product.type !== "external") {
    if (validateProductPrice(product.type, product.priceCents) === null) missing.push("price");
  }
  if ((product.type === "video" || product.type === "audio") && !product.mediaUrlFr) missing.push("media");
  if (product.type === "pdf" && !product.hasFile) missing.push("file");
  if (product.type === "external" && !product.externalUrl) missing.push("link");
  if (product.type === "webinar" && (!product.webinarStartsAt || !product.webinarJoinUrl)) missing.push("webinar");
  if (product.type === "external" && !product.contentHtmlFr.replace(/<[^>]*>/g, "").trim() && !product.summaryFr.trim()) {
    missing.push("content");
  }
  if (!product.attested) missing.push("attestation");
  return missing;
}

/* ------------------------------------------------------------------------ */
/* Webinar reminders                                                          */
/* ------------------------------------------------------------------------ */

const HOUR_MS = 60 * 60 * 1000;

/** A webinar's buyers are reminded the day before and an hour before (lib/product-jobs.ts). */
export const WEBINAR_REMINDERS = [
  { kind: "day", hoursBefore: 24 },
  { kind: "hour", hoursBefore: 1 },
] as const;
export type WebinarReminderKind = (typeof WEBINAR_REMINDERS)[number]["kind"];

/**
 * The reminder due now, if any: the latest one whose window has opened, until
 * the webinar starts. None for a purchase made after that window opened — the
 * buyer has just had the purchase email. A purchase without a payment date
 * counts as made long before.
 */
export function webinarReminderDue(input: { startsAt: Date; paidAt?: Date | null; now: Date }): WebinarReminderKind | null {
  const start = input.startsAt.getTime();
  const now = input.now.getTime();
  if (Number.isNaN(start) || now >= start) return null;
  const open = [...WEBINAR_REMINDERS]
    .sort((a, b) => a.hoursBefore - b.hoursBefore)
    .find((reminder) => now >= start - reminder.hoursBefore * HOUR_MS);
  if (!open) return null;
  const paidAt = input.paidAt ? input.paidAt.getTime() : Number.NEGATIVE_INFINITY;
  return paidAt < start - open.hoursBefore * HOUR_MS ? open.kind : null;
}

/** How a sent reminder is recorded on its purchase: its kind and the start it announced. */
export function webinarReminderKey(kind: WebinarReminderKind, startsAt: Date): string {
  return `${kind}:${startsAt.toISOString()}`;
}

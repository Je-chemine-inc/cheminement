/**
 * Rules of the articles professionals write for their page (owner's decisions, 2026-09-15). An
 * article is a `ContentEntry` of kind "nouveaute" with an `ownerProfessionalId`: reviewed by the team
 * like a product (same moderation block and moves, lib/product-rules.ts), free, shown on the
 * professional's page and, when the team says so, in « Nouveautés » (`listInLibrary`). Pure and
 * client-safe.
 */

import { slugify } from "@/lib/content-kind";
import { PRODUCT_HTML_MAX_BYTES } from "@/lib/product-rules";

export const ARTICLE_TITLE_MAX = 120;
export const ARTICLE_SUMMARY_MAX = 400;
/** An article body larger than this is refused, not truncated. */
export const ARTICLE_HTML_MAX_BYTES = PRODUCT_HTML_MAX_BYTES;

export interface ArticleWriteInput {
  titleFr?: string;
  titleEn?: string;
  summaryFr?: string;
  summaryEn?: string;
  contentHtmlFr?: string;
  contentHtmlEn?: string;
  iconUrl?: string | null;
}

/** The keys a professional may send. Anything else — status, owner, slug, moderation, listing — is dropped. */
export const ARTICLE_WRITABLE_FIELDS = [
  "titleFr",
  "titleEn",
  "summaryFr",
  "summaryEn",
  "contentHtmlFr",
  "contentHtmlEn",
  "iconUrl",
] as const;

export type ArticleWriteError = "INVALID_TITLE" | "INVALID_SUMMARY" | "INVALID_HTML" | "HTML_TOO_LARGE" | "INVALID_IMAGE";

const FILE_URL = /^\/api\/files\/[a-f0-9]{24}$/;

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}

/** A professional's edit, checked field by field. HTML is only size-checked here; the server sanitizes it. */
export function parseArticleWrite(
  body: unknown,
): { ok: true; value: ArticleWriteInput } | { ok: false; code: ArticleWriteError; field: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "INVALID_TITLE", field: "body" };
  const input = body as Record<string, unknown>;
  const value: ArticleWriteInput = {};

  for (const field of ["titleFr", "titleEn"] as const) {
    const text = optionalText(input[field], ARTICLE_TITLE_MAX);
    if (text === null || (field === "titleFr" && text === "")) return { ok: false, code: "INVALID_TITLE", field };
    if (text !== undefined) value[field] = text;
  }
  for (const field of ["summaryFr", "summaryEn"] as const) {
    const text = optionalText(input[field], ARTICLE_SUMMARY_MAX);
    if (text === null) return { ok: false, code: "INVALID_SUMMARY", field };
    if (text !== undefined) value[field] = text;
  }
  for (const field of ["contentHtmlFr", "contentHtmlEn"] as const) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (typeof raw !== "string") return { ok: false, code: "INVALID_HTML", field };
    if (new TextEncoder().encode(raw).length > ARTICLE_HTML_MAX_BYTES) return { ok: false, code: "HTML_TOO_LARGE", field };
    value[field] = raw;
  }
  if (input.iconUrl !== undefined) {
    if (input.iconUrl !== null && input.iconUrl !== "" && (typeof input.iconUrl !== "string" || !FILE_URL.test(input.iconUrl))) {
      return { ok: false, code: "INVALID_IMAGE", field: "iconUrl" };
    }
    value.iconUrl = input.iconUrl ? String(input.iconUrl) : null;
  }
  return { ok: true, value };
}

/** What an article must have before it can be sent to the team. */
export type ArticleRequirement = "title" | "summary" | "content" | "attestation";

export function articleMissing(article: {
  titleFr: string;
  summaryFr: string;
  contentHtmlFr: string;
  /** The professional confirmed: no testimonials, no promise of results. */
  attested: boolean;
}): ArticleRequirement[] {
  const missing: ArticleRequirement[] = [];
  if (!article.titleFr.trim()) missing.push("title");
  if (!article.summaryFr.trim()) missing.push("summary");
  if (!article.contentHtmlFr.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim()) missing.push("content");
  if (!article.attested) missing.push("attestation");
  return missing;
}

/** Addresses under /nouveautes an article slug must never take. */
const RESERVED_SLUGS = new Set(["new", "edit", "admin", "api", "preview"]);
const SLUG_MAX = 80;

/** An article's address from its French title: suffixed -2, -3… when taken. Immutable once created. */
export function articleSlugCandidates(titleFr: string, count = 20): string[] {
  let base = slugify(titleFr).slice(0, SLUG_MAX).replace(/-+$/g, "");
  if (!base) base = "article";
  if (RESERVED_SLUGS.has(base)) base = `${base}-article`;
  const out = [base];
  for (let i = 2; out.length < count; i++) out.push(`${base.slice(0, SLUG_MAX - 4)}-${i}`);
  return out;
}

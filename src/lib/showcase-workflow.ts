import { slugify } from "@/lib/content-kind";
import { isShowcaseCityKey } from "@/lib/showcase-cities";
import {
  PROFESSIONAL_ORDER_CODES,
  SHOWCASE_CONSENT_VERSION,
  SHOWCASE_LIMITS as L,
  type ShowcaseActor,
  type ShowcaseReviewState,
  type ShowcaseStatus,
} from "@/lib/showcase-constants";

/**
 * The rules of a showcase page (spec 003), without I/O: slugs, what a
 * professional may write, when a page is complete, and who may do what.
 * Client-safe (the forms reuse the limits and the slug check).
 */

// ------------------------------------------------------------------- slugs

/** Path segments a professional's slug must never take on a city host. */
export const RESERVED_SHOWCASE_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "showcase",
  "specialite",
  "specialites",
  "robots-txt",
  "sitemap-xml",
  "robots",
  "sitemap",
  "favicon",
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
  "manifest",
  "appointment",
  "rendez-vous",
  "login",
  "signup",
  "admin",
  "professional",
  "client",
  "pay",
  "psy",
  "liste-attente",
  "formations",
  "produits",
  "contact",
  "faq",
  "www",
  "jechemine",
]);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidShowcaseSlug(slug: string): boolean {
  return (
    slug.length >= 2 &&
    slug.length <= 60 &&
    SLUG_RE.test(slug) &&
    !RESERVED_SHOWCASE_SLUGS.has(slug)
  );
}

function slugPart(value: string | null | undefined): string {
  return slugify(value ?? "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Slugs to try, best first: the last name ("sassi"), then the full name
 * ("amel-sassi"), then the full name numbered ("amel-sassi-2"…).
 */
export function showcaseSlugCandidates(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string[] {
  const last = slugPart(lastName);
  const full = slugPart(`${firstName ?? ""} ${lastName ?? ""}`);
  const out: string[] = [];
  const add = (candidate: string) => {
    if (isValidShowcaseSlug(candidate) && !out.includes(candidate)) out.push(candidate);
  };
  add(last);
  add(full);
  const base = (full || last || "professionnel").slice(0, 55).replace(/-+$/g, "");
  for (let i = 2; i <= 99; i++) add(`${base}-${i}`);
  return out;
}

export function pickShowcaseSlug(
  candidates: readonly string[],
  taken: ReadonlySet<string>,
): string | null {
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}

// -------------------------------------------------------------------- text

export type CleanResult = { ok: true; value: string } | { ok: false };

// Control characters, except tab, line feed and carriage return.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Text written by a person, kept as paragraphs: at most one blank line in a row. */
export function cleanParagraphs(value: unknown, max: number): CleanResult {
  if (value === undefined || value === null) return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false };
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length <= max ? { ok: true, value: text } : { ok: false };
}

/** A single line: every run of whitespace becomes one space. */
export function cleanLine(value: unknown, max: number): CleanResult {
  if (value === undefined || value === null) return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false };
  const text = value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  return text.length <= max ? { ok: true, value: text } : { ok: false };
}

/** Paragraphs of a cleaned text, for rendering. */
export function paragraphsOf(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

type Localized = { fr: string; en: string };

function cleanLocalized(
  value: unknown,
  max: number,
  kind: "line" | "paragraphs",
): { ok: true; value: Localized } | { ok: false; where: "shape" | "fr" | "en" } {
  if (value === undefined || value === null) return { ok: true, value: { fr: "", en: "" } };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, where: "shape" };
  const input = value as { fr?: unknown; en?: unknown };
  const clean = kind === "line" ? cleanLine : cleanParagraphs;
  const fr = clean(input.fr, max);
  if (!fr.ok) return { ok: false, where: "fr" };
  const en = clean(input.en, max);
  if (!en.ok) return { ok: false, where: "en" };
  return { ok: true, value: { fr: fr.value, en: en.value } };
}

// ------------------------------------------------------------------- draft

export type DraftRefusal =
  | "INVALID_FIELD"
  | "TOO_LONG"
  | "UNKNOWN_EXPERTISE"
  | "TOO_MANY_EXPERTISES"
  | "TOO_MANY_VALUES"
  | "INVALID_ORDER"
  | "INVALID_CITY";

export type DraftNormalization =
  | { ok: true; set: Record<string, unknown>; unset: string[] }
  | { ok: false; code: DraftRefusal; field: string };

const LOCALIZED_FIELDS = [
  ["headline", L.headline, "line"],
  ["intro", L.intro, "paragraphs"],
  ["bio", L.bio, "paragraphs"],
  ["approach", L.approach, "paragraphs"],
  ["insuranceNote", L.insuranceNote, "paragraphs"],
] as const;

/**
 * What a draft save may change, as mongoose `$set` / `$unset` paths under
 * `draft.`. An allowlist: anything else in the body (status, slug, photo,
 * the published copy, consent) is ignored. Each localized field is replaced
 * whole, both languages at once.
 */
export function normalizeShowcaseDraft(
  body: unknown,
  allowedExpertiseIds: ReadonlySet<string>,
): DraftNormalization {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "INVALID_FIELD", field: "body" };
  }
  const input = body as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const set: Record<string, unknown> = {};
  const unset: string[] = [];

  if (has("displayName")) {
    const name = cleanLine(input.displayName, L.displayName);
    if (!name.ok) return { ok: false, code: "TOO_LONG", field: "displayName" };
    set["draft.displayName"] = name.value;
  }

  for (const [field, max, kind] of LOCALIZED_FIELDS) {
    if (!has(field)) continue;
    const result = cleanLocalized(input[field], max, kind);
    if (!result.ok) {
      return result.where === "shape"
        ? { ok: false, code: "INVALID_FIELD", field }
        : { ok: false, code: "TOO_LONG", field: `${field}.${result.where}` };
    }
    set[`draft.${field}`] = result.value;
  }

  if (has("values")) {
    if (!Array.isArray(input.values)) return { ok: false, code: "INVALID_FIELD", field: "values" };
    const values: Localized[] = [];
    for (const [index, raw] of input.values.entries()) {
      const result = cleanLocalized(raw, L.valueLength, "line");
      if (!result.ok) {
        return {
          ok: false,
          code: result.where === "shape" ? "INVALID_FIELD" : "TOO_LONG",
          field: `values.${index}`,
        };
      }
      // A value without its French wording is dropped.
      if (result.value.fr) values.push(result.value);
    }
    if (values.length > L.values) return { ok: false, code: "TOO_MANY_VALUES", field: "values" };
    set["draft.values"] = values;
  }

  if (has("expertiseIds")) {
    if (!Array.isArray(input.expertiseIds)) {
      return { ok: false, code: "INVALID_FIELD", field: "expertiseIds" };
    }
    const ids = [...new Set(input.expertiseIds.map((id) => (typeof id === "string" ? id : "")))];
    if (ids.some((id) => !allowedExpertiseIds.has(id))) {
      return { ok: false, code: "UNKNOWN_EXPERTISE", field: "expertiseIds" };
    }
    if (ids.length > L.expertisesMax) {
      return { ok: false, code: "TOO_MANY_EXPERTISES", field: "expertiseIds" };
    }
    set["draft.expertiseIds"] = ids;
  }

  if (has("orderCode")) {
    const code = input.orderCode;
    if (code === null || code === "") {
      unset.push("draft.orderCode");
    } else if (typeof code === "string" && (PROFESSIONAL_ORDER_CODES as readonly string[]).includes(code)) {
      set["draft.orderCode"] = code;
    } else {
      return { ok: false, code: "INVALID_ORDER", field: "orderCode" };
    }
  }

  if (has("orderLabel")) {
    const label = cleanLine(input.orderLabel, L.orderLabel);
    if (!label.ok) return { ok: false, code: "TOO_LONG", field: "orderLabel" };
    set["draft.orderLabel"] = label.value;
  }

  if (has("cityKey")) {
    const key = input.cityKey;
    if (key === null || key === "") {
      unset.push("draft.cityKey");
    } else if (typeof key === "string" && isShowcaseCityKey(key)) {
      set["draft.cityKey"] = key;
    } else {
      return { ok: false, code: "INVALID_CITY", field: "cityKey" };
    }
  }

  return { ok: true, set, unset };
}

// ------------------------------------------------------------------- city

interface PageCity {
  cityKey?: string | null;
  draft?: { cityKey?: string | null } | null;
}

/** The city the draft is written for: the one it asks for, else the page's. */
export function showcaseCityKeyOf(page: PageCity): string {
  const asked = page.draft?.cityKey;
  return asked && isShowcaseCityKey(asked) ? asked : (page.cityKey ?? "");
}

/** The city a draft asks the page to move to, or null when it asks for none. */
export function requestedShowcaseCityKey(page: PageCity): string | null {
  const asked = showcaseCityKeyOf(page);
  return asked && asked !== page.cityKey ? asked : null;
}

// ------------------------------------------------------------ completeness

export const SHOWCASE_REQUIREMENTS = [
  "photo",
  "displayName",
  "headline",
  "bio",
  "expertises",
  "order",
  "title",
  "license",
  "modalities",
  "city",
] as const;
export type ShowcaseRequirement = (typeof SHOWCASE_REQUIREMENTS)[number];

export interface CompletenessInput {
  draft: {
    displayName?: string | null;
    headline?: { fr?: string | null } | null;
    bio?: { fr?: string | null } | null;
    expertiseIds?: readonly unknown[] | null;
    orderCode?: string | null;
    orderLabel?: string | null;
    photoFileId?: unknown;
  };
  profile: {
    specialty?: string | null;
    license?: string | null;
    modalities?: readonly string[] | null;
  } | null;
  cityKey?: string | null;
}

/** What still keeps a page from being submitted or published. Empty = ready. */
export function missingShowcaseRequirements(input: CompletenessInput): ShowcaseRequirement[] {
  const { draft, profile } = input;
  const missing: ShowcaseRequirement[] = [];
  if (!draft.photoFileId) missing.push("photo");
  if (!draft.displayName?.trim()) missing.push("displayName");
  if (!draft.headline?.fr?.trim()) missing.push("headline");
  if ((draft.bio?.fr?.trim().length ?? 0) < L.bioMin) missing.push("bio");
  if ((draft.expertiseIds?.length ?? 0) < L.expertisesMin) missing.push("expertises");
  if (!draft.orderCode || (draft.orderCode === "other" && !draft.orderLabel?.trim())) {
    missing.push("order");
  }
  if (!profile?.specialty?.trim()) missing.push("title");
  if (!profile?.license?.trim()) missing.push("license");
  if (!profile?.modalities?.length) missing.push("modalities");
  if (!input.cityKey || !isShowcaseCityKey(input.cityKey)) missing.push("city");
  return missing;
}

// --------------------------------------------------------------- decisions

export type ShowcaseAction =
  | "submit"
  | "approve"
  | "request_changes"
  | "unpublish"
  | "republish"
  | "remind";

export type ShowcaseRefusal =
  | "FORBIDDEN"
  | "ALREADY_SUBMITTED"
  | "NOT_SUBMITTED"
  | "NOT_PUBLISHED"
  | "NOT_UNPUBLISHED"
  | "WITHDRAWN_BY_PROFESSIONAL"
  | "CONSENT_REQUIRED"
  | "NOTHING_TO_PUBLISH"
  | "NOT_REMINDABLE"
  | "REMINDED_RECENTLY";

export interface ShowcaseWorkflowState {
  status: ShowcaseStatus;
  reviewState: ShowcaseReviewState;
  draftRevision: number;
  publishedRevision?: number | null;
  hasPublishedSnapshot: boolean;
  unpublishedBy?: ShowcaseActor | null;
  consentVersion?: string | null;
  remindedAt?: Date | null;
}

export const SHOWCASE_REMINDER_GAP_MS = 24 * 60 * 60 * 1000;

type Decision = { ok: true } | { ok: false; code: ShowcaseRefusal };
const allow: Decision = { ok: true };
const refuse = (code: ShowcaseRefusal): Decision => ({ ok: false, code });

/**
 * Who may do what, from the page's state alone. Completeness and the draft
 * revision an admin looked at are checked by the service, which has the data.
 *
 * - An admin publishes: the review is a signal, not a gate, so corrections an
 *   admin makes can go live — but only with the professional's current consent.
 * - A page the professional took down stays down until they put it back or
 *   submit again; an admin cannot republish it over their decision.
 * - A page an admin took down cannot be put back by the professional alone.
 */
export function decideShowcaseAction(
  state: ShowcaseWorkflowState,
  action: ShowcaseAction,
  actor: ShowcaseActor,
  now: Date = new Date(),
): Decision {
  const consentCurrent = state.consentVersion === SHOWCASE_CONSENT_VERSION;
  switch (action) {
    case "submit":
      if (actor !== "professional") return refuse("FORBIDDEN");
      if (state.reviewState === "pending") return refuse("ALREADY_SUBMITTED");
      return allow;

    case "approve":
      if (actor !== "admin") return refuse("FORBIDDEN");
      if (state.status === "invited") return refuse("NOTHING_TO_PUBLISH");
      if (state.status === "published" && state.draftRevision === state.publishedRevision) {
        return refuse("NOTHING_TO_PUBLISH");
      }
      if (
        state.status === "unpublished" &&
        state.unpublishedBy === "professional" &&
        state.reviewState !== "pending"
      ) {
        return refuse("WITHDRAWN_BY_PROFESSIONAL");
      }
      if (!consentCurrent) return refuse("CONSENT_REQUIRED");
      return allow;

    case "request_changes":
      if (actor !== "admin") return refuse("FORBIDDEN");
      if (state.reviewState !== "pending") return refuse("NOT_SUBMITTED");
      return allow;

    case "unpublish":
      if (state.status !== "published") return refuse("NOT_PUBLISHED");
      return allow;

    case "republish":
      if (state.status !== "unpublished") return refuse("NOT_UNPUBLISHED");
      if (!state.hasPublishedSnapshot) return refuse("NOTHING_TO_PUBLISH");
      if (actor === "admin" && state.unpublishedBy === "professional") {
        return refuse("WITHDRAWN_BY_PROFESSIONAL");
      }
      if (actor === "professional" && state.unpublishedBy !== "professional") {
        return refuse("FORBIDDEN");
      }
      if (!consentCurrent) return refuse("CONSENT_REQUIRED");
      return allow;

    case "remind":
      if (actor !== "admin") return refuse("FORBIDDEN");
      if (state.status !== "invited" && state.status !== "draft") return refuse("NOT_REMINDABLE");
      if (state.reviewState === "pending") return refuse("ALREADY_SUBMITTED");
      if (state.remindedAt && now.getTime() - state.remindedAt.getTime() < SHOWCASE_REMINDER_GAP_MS) {
        return refuse("REMINDED_RECENTLY");
      }
      return allow;
  }
}

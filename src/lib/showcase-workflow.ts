import { slugify } from "@/lib/content-kind";
import { isShowcaseCityKey } from "@/lib/showcase-cities";
import { isValidShowcaseSlug } from "@/lib/showcase-slug";
import {
  DEFAULT_SHOWCASE_ACCENT,
  REQUIRED_SHOWCASE_SECTIONS,
  SHOWCASE_AMBIENCE_SLOTS,
  SHOWCASE_SECTION_KEYS,
  SHOWCASE_TEXT_KEYS,
  SHOWCASE_TEXT_LIMITS,
  isAmbienceChoice,
  isShowcaseAccentKey,
  isShowcaseSectionKey,
  resolveSectionOrder,
  type ShowcaseAmbienceSlot,
  type ShowcaseTextKey,
} from "@/lib/showcase-customization";
import {
  PROFESSIONAL_ORDER_CODES,
  SHOWCASE_CONSENT_VERSION,
  SHOWCASE_LIMITS as L,
  type ShowcaseActor,
  type ShowcaseStatus,
} from "@/lib/showcase-constants";

/**
 * The rules of a showcase page (spec 003), without I/O: slugs, what a
 * professional may write, when a page is complete, and who may do what.
 * Client-safe (the forms reuse the limits and the slug check).
 */

// ------------------------------------------------------------------- slugs

export { isValidShowcaseSlug };

function slugPart(value: string | null | undefined): string {
  return slugify(value ?? "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Slugs to try, best first: the full name ("amel-sassi"), then the full name
 * numbered ("amel-sassi-2"…). The page lives at www.jechemine.ca/<slug>.
 */
export function showcaseSlugCandidates(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string[] {
  const full = slugPart(`${firstName ?? ""} ${lastName ?? ""}`);
  const out: string[] = [];
  const add = (candidate: string) => {
    if (isValidShowcaseSlug(candidate) && !out.includes(candidate)) out.push(candidate);
  };
  add(full);
  const base = (full || "professionnel").slice(0, 55).replace(/-+$/g, "");
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
  | "TOO_MANY_ITEMS"
  | "INVALID_ORDER";

export type DraftNormalization =
  | { ok: true; set: Record<string, unknown>; unset: string[] }
  | { ok: false; code: DraftRefusal; field: string };

const LOCALIZED_FIELDS = [
  ["headline", L.headline, "line"],
  ["intro", L.intro, "paragraphs"],
  ["bio", L.bio, "paragraphs"],
  ["approach", L.approach, "paragraphs"],
  ["insuranceNote", L.insuranceNote, "paragraphs"],
  ["quote", L.quote, "line"],
] as const;

type Refusal = { ok: false; code: DraftRefusal; field: string };

/** A list of short localized lines. An item without its French wording is dropped. */
function cleanLineList(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
): { ok: true; value: Localized[] } | Refusal {
  if (!Array.isArray(value)) return { ok: false, code: "INVALID_FIELD", field };
  const items: Localized[] = [];
  for (const [index, raw] of value.entries()) {
    const result = cleanLocalized(raw, maxLength, "line");
    if (!result.ok) {
      return { ok: false, code: result.where === "shape" ? "INVALID_FIELD" : "TOO_LONG", field: `${field}.${index}` };
    }
    if (result.value.fr) items.push(result.value);
  }
  if (items.length > maxItems) return { ok: false, code: "TOO_MANY_ITEMS", field };
  return { ok: true, value: items };
}

type CardPart = readonly [key: string, max: number, kind: "line" | "paragraphs"];

/** A list of cards made of localized parts. A card whose first part has no French wording is dropped. */
function cleanCardList(
  value: unknown,
  field: string,
  maxItems: number,
  parts: readonly CardPart[],
): { ok: true; value: Record<string, Localized>[] } | Refusal {
  if (!Array.isArray(value)) return { ok: false, code: "INVALID_FIELD", field };
  const cards: Record<string, Localized>[] = [];
  for (const [index, raw] of value.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, code: "INVALID_FIELD", field: `${field}.${index}` };
    }
    const card: Record<string, Localized> = {};
    for (const [key, max, kind] of parts) {
      const result = cleanLocalized((raw as Record<string, unknown>)[key], max, kind);
      if (!result.ok) {
        return result.where === "shape"
          ? { ok: false, code: "INVALID_FIELD", field: `${field}.${index}.${key}` }
          : { ok: false, code: "TOO_LONG", field: `${field}.${index}.${key}.${result.where}` };
      }
      card[key] = result.value;
    }
    if (card[parts[0][0]].fr) cards.push(card);
  }
  if (cards.length > maxItems) return { ok: false, code: "TOO_MANY_ITEMS", field };
  return { ok: true, value: cards };
}

const LINE_LISTS = [
  ["highlights", L.highlights, L.highlightLength],
  ["credentials", L.credentials, L.credentialLength],
] as const;

const CARD_LISTS: readonly (readonly [field: string, maxItems: number, parts: readonly CardPart[]])[] = [
  ["focusAreas", L.focusAreas, [["title", L.focusTitle, "line"], ["body", L.focusBody, "paragraphs"]]],
  ["methods", L.methods, [["name", L.methodName, "line"], ["title", L.methodTitle, "line"], ["body", L.methodBody, "paragraphs"]]],
];

/** Fields only an admin sets: the page's legal identity. (The city follows the profile's office address.) */
export const SHOWCASE_ADMIN_ONLY_FIELDS = ["orderCode", "orderLabel"] as const;

/**
 * What a draft save may change, as mongoose `$set` / `$unset` paths under
 * `draft.`. An allowlist: anything else in the body (status, slug, photo,
 * the published copy, consent) is ignored, and so are the admin-only fields
 * when the professional saves. Each localized field is replaced whole, both
 * languages at once.
 */
export function normalizeShowcaseDraft(
  body: unknown,
  allowedExpertiseIds: ReadonlySet<string>,
  actor: ShowcaseActor = "admin",
): DraftNormalization {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "INVALID_FIELD", field: "body" };
  }
  const input = body as Record<string, unknown>;
  const adminOnly: ReadonlySet<string> = new Set(actor === "admin" ? [] : SHOWCASE_ADMIN_ONLY_FIELDS);
  const has = (key: string) => !adminOnly.has(key) && Object.prototype.hasOwnProperty.call(input, key);
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
    const values: (Localized & { details?: Localized })[] = [];
    for (const [index, raw] of input.values.entries()) {
      const result = cleanLocalized(raw, L.valueLength, "line");
      if (!result.ok) {
        return {
          ok: false,
          code: result.where === "shape" ? "INVALID_FIELD" : "TOO_LONG",
          field: `values.${index}`,
        };
      }
      const details = cleanLocalized((raw as { details?: unknown }).details, L.valueDescription, "line");
      if (!details.ok) {
        return {
          ok: false,
          code: details.where === "shape" ? "INVALID_FIELD" : "TOO_LONG",
          field: `values.${index}.details`,
        };
      }
      // A value without its French wording is dropped; an empty description is not stored.
      if (result.value.fr) {
        values.push({ ...result.value, ...(details.value.fr || details.value.en ? { details: details.value } : {}) });
      }
    }
    if (values.length > L.values) return { ok: false, code: "TOO_MANY_VALUES", field: "values" };
    set["draft.values"] = values;
  }

  for (const [field, maxItems, maxLength] of LINE_LISTS) {
    if (!has(field)) continue;
    const result = cleanLineList(input[field], field, maxItems, maxLength);
    if (!result.ok) return result;
    set[`draft.${field}`] = result.value;
  }

  for (const [field, maxItems, parts] of CARD_LISTS) {
    if (!has(field)) continue;
    const result = cleanCardList(input[field], field, maxItems, parts);
    if (!result.ok) return result;
    set[`draft.${field}`] = result.value;
  }

  // The page's customization (showcase-customization): texts, sections, colour, photos.
  if (has("texts")) {
    const raw = input.texts;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, code: "INVALID_FIELD", field: "texts" };
    }
    const texts: Partial<Record<ShowcaseTextKey, Localized>> = {};
    for (const key of SHOWCASE_TEXT_KEYS) {
      const result = cleanLocalized((raw as Record<string, unknown>)[key], SHOWCASE_TEXT_LIMITS[key], "line");
      if (!result.ok) {
        return result.where === "shape"
          ? { ok: false, code: "INVALID_FIELD", field: `texts.${key}` }
          : { ok: false, code: "TOO_LONG", field: `texts.${key}.${result.where}` };
      }
      // Without its French wording a text keeps the page's own: nothing is stored.
      if (result.value.fr) texts[key] = result.value;
    }
    set["draft.texts"] = texts;
  }

  if (has("sectionOrder")) {
    const order = input.sectionOrder;
    if (!Array.isArray(order) || !order.every(isShowcaseSectionKey) || new Set(order).size !== order.length) {
      return { ok: false, code: "INVALID_FIELD", field: "sectionOrder" };
    }
    const resolved = resolveSectionOrder(order);
    // The default order is stored as none, so a page that never moved a section reports no change.
    set["draft.sectionOrder"] = resolved.every((key, index) => key === SHOWCASE_SECTION_KEYS[index]) ? [] : resolved;
  }

  if (has("hiddenSections")) {
    const hidden = input.hiddenSections;
    if (!Array.isArray(hidden) || !hidden.every((key) => isShowcaseSectionKey(key) && !REQUIRED_SHOWCASE_SECTIONS.has(key))) {
      return { ok: false, code: "INVALID_FIELD", field: "hiddenSections" };
    }
    set["draft.hiddenSections"] = SHOWCASE_SECTION_KEYS.filter((key) => hidden.includes(key));
  }

  if (has("accent")) {
    const accent = input.accent;
    if (accent !== "" && !isShowcaseAccentKey(accent)) return { ok: false, code: "INVALID_FIELD", field: "accent" };
    set["draft.accent"] = accent === DEFAULT_SHOWCASE_ACCENT ? "" : accent;
  }

  if (has("ambience")) {
    const raw = input.ambience;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, code: "INVALID_FIELD", field: "ambience" };
    }
    const ambience: Partial<Record<ShowcaseAmbienceSlot, string>> = {};
    for (const slot of SHOWCASE_AMBIENCE_SLOTS) {
      const value = (raw as Record<string, unknown>)[slot];
      if (value === undefined || value === null || value === "") continue;
      if (!isAmbienceChoice(slot, value)) return { ok: false, code: "INVALID_FIELD", field: `ambience.${slot}` };
      ambience[slot] = value;
    }
    set["draft.ambience"] = ambience;
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


  return { ok: true, set, unset };
}

// ------------------------------------------------------------------- city


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

// ------------------------------------------------------------- live edits

/** What the professional edits on their live page, as the admin alert names it. */
export const SHOWCASE_EDITABLE_FIELDS = [
  "displayName",
  "headline",
  "intro",
  "bio",
  "approach",
  "values",
  "expertiseIds",
  "insuranceNote",
  "quote",
  "highlights",
  "credentials",
  "focusAreas",
  "methods",
  "photo",
  "officePhotos",
  "texts",
  "sectionOrder",
  "hiddenSections",
  "accent",
  "ambience",
] as const;
export type ShowcaseEditableField = (typeof SHOWCASE_EDITABLE_FIELDS)[number];

/** At most one « page changed » alert per page in this window; the history keeps every edit. */
export const SHOWCASE_CHANGE_ALERT_GAP_MS = 60 * 60 * 1000;

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const text = value as { fr?: unknown; en?: unknown };
    // A text with neither language, or a choice object with nothing chosen (texts, ambience).
    return "fr" in text ? !text.fr && !text.en : Object.keys(value).length === 0;
  }
  return false;
}

/**
 * A value in one shape whatever copy it comes from: ids as strings (their
 * toJSON runs first), texts as `{ fr, en }`, and every other object with its
 * keys sorted, so a card saved with its parts in another order is the same card.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    if ("fr" in node) {
      const text = node as { fr?: unknown; en?: unknown };
      return { fr: text.fr ?? "", en: text.en ?? "" };
    }
    const record = node as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

/**
 * The fields a save really changes, compared with the copy the public sees.
 * `fields` are the saved values by field name (`draft.` taken off).
 */
export function changedShowcaseFields(
  before: Record<string, unknown> | null | undefined,
  fields: Record<string, unknown>,
): ShowcaseEditableField[] {
  const editable: ReadonlySet<string> = new Set(SHOWCASE_EDITABLE_FIELDS);
  return Object.entries(fields)
    .filter(([field]) => editable.has(field))
    .filter(([field, value]) => {
      const previous = before?.[field];
      if (isBlank(previous) && isBlank(value)) return false;
      return canonical(previous) !== canonical(value);
    })
    .map(([field]) => field as ShowcaseEditableField);
}

// --------------------------------------------------------------- decisions

export type ShowcaseAction = "publish" | "edit" | "unpublish" | "republish";

export type ShowcaseRefusal =
  | "FORBIDDEN"
  | "IN_PREPARATION"
  | "NOT_PUBLISHED"
  | "NOT_UNPUBLISHED"
  | "WITHDRAWN_BY_PROFESSIONAL"
  | "CONSENT_REQUIRED"
  | "NOTHING_TO_PUBLISH";

export interface ShowcaseWorkflowState {
  status: ShowcaseStatus;
  draftRevision: number;
  publishedRevision?: number | null;
  hasPublishedSnapshot: boolean;
  unpublishedBy?: ShowcaseActor | null;
  consentVersion?: string | null;
}

type Decision = { ok: true } | { ok: false; code: ShowcaseRefusal };
const allow: Decision = { ok: true };
const refuse = (code: ShowcaseRefusal): Decision => ({ ok: false, code });

/**
 * Who may do what, from the page's state alone. Completeness and the draft
 * revision an admin looked at are checked by the service, which has the data.
 *
 * - An admin activates, prepares and publishes the page. Publishing needs the
 *   professional's agreement: already on record, or confirmed by the admin
 *   now (`consentAttested`).
 * - Once the page has been published, the professional edits it live.
 * - A page the professional took down stays down until they put it back; an
 *   admin cannot publish or republish it over their decision.
 * - A page an admin took down cannot be put back by the professional alone.
 */
export function decideShowcaseAction(
  state: ShowcaseWorkflowState,
  action: ShowcaseAction,
  actor: ShowcaseActor,
  options: { consentAttested?: boolean } = {},
): Decision {
  const consentCurrent = state.consentVersion === SHOWCASE_CONSENT_VERSION;
  switch (action) {
    case "publish":
      if (actor !== "admin") return refuse("FORBIDDEN");
      if (state.status === "published" && state.draftRevision === state.publishedRevision) {
        return refuse("NOTHING_TO_PUBLISH");
      }
      if (state.status === "unpublished" && state.unpublishedBy === "professional") {
        return refuse("WITHDRAWN_BY_PROFESSIONAL");
      }
      if (!consentCurrent && options.consentAttested !== true) return refuse("CONSENT_REQUIRED");
      return allow;

    case "edit":
      if (actor !== "professional") return refuse("FORBIDDEN");
      if (!state.hasPublishedSnapshot) return refuse("IN_PREPARATION");
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
  }
}

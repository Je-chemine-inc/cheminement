import type { ProfessionalOrderCode, ShowcaseActor, ShowcaseStatus } from "@/lib/showcase-constants";
import type { ShowcaseLanguageKey, ShowcaseModalityKey } from "@/lib/showcase-public";
import type { ShowcaseRequirement } from "@/lib/showcase-workflow";

/**
 * The showcase editor's data as the browser receives it (dates are strings).
 * Mirrors loadShowcaseEditor / loadShowcaseAdminView in showcase-service.ts.
 */
export interface LocalizedTextJson {
  fr: string;
  en: string;
}

export interface ShowcaseContentJson {
  displayName: string;
  headline: LocalizedTextJson;
  intro: LocalizedTextJson;
  bio: LocalizedTextJson;
  approach: LocalizedTextJson;
  insuranceNote: LocalizedTextJson;
  values: LocalizedTextJson[];
  expertiseIds: string[];
  orderCode: ProfessionalOrderCode | null;
  orderLabel: string;
  photoUrl: string | null;
  /** The city this copy asks for; null on pages saved before the choice existed. */
  cityKey: string | null;
}

export interface ShowcaseEditorJson {
  page: {
    slug: string;
    cityKey: string;
    cityName: string;
    publicUrl: string;
    /** A published page's move the draft asks for, applied when an admin publishes. */
    requestedCity: { key: string; name: string; publicUrl: string } | null;
    status: ShowcaseStatus;
    draft: ShowcaseContentJson;
    draftRevision: number;
    draftUpdatedAt: string | null;
    draftUpdatedBy: ShowcaseActor | null;
    published: { publishedAt: string | null; revision: number | null } | null;
    hasUnpublishedChanges: boolean;
    unpublishedBy: ShowcaseActor | null;
    services: { standard: boolean; quick: boolean };
    consent: {
      version: string | null;
      acceptedAt: string | null;
      /** Who recorded it: the professional (retired flow) or an admin confirming their agreement. */
      source: ShowcaseActor | null;
      current: boolean;
    };
  };
  missing: ShowcaseRequirement[];
  profileFacts: {
    title: string | null;
    license: string | null;
    modalities: ShowcaseModalityKey[];
    languages: ShowcaseLanguageKey[];
    officeCity: string | null;
    acceptingNewClients: boolean;
    acceptingEmergencyConsultations: boolean;
  };
  expertiseOptions: { id: string; labelFr: string; labelEn: string }[];
  consentVersion: string;
  showcaseEnabled: boolean;
  /** Anonymous counts over the last `days` days. */
  stats: { days: number; views: number; ctaClicks: number };
}

export interface ShowcaseAdminJson extends ShowcaseEditorJson {
  admin: {
    user: { id: string; name: string; email: string; status: string } | null;
    published: ShowcaseContentJson | null;
    history: { at: string; actor: string; action: string; note: string }[];
    previousSlugs: string[];
    invitedAt: string | null;
  };
}

/**
 * Editor texts that speak to the professional (« vous », « votre page »). On
 * the admin review screen each one reads from ShowcaseAdmin.editor.<key>
 * instead, worded about the professional; every other text is shared.
 */
export const SHOWCASE_ADMIN_WORDED_KEYS = [
  "city.hint",
  "city.officeCity",
  "city.afterApproval",
  "fields.introPlaceholder",
  "fields.bioPlaceholder",
  "fields.approachPlaceholder",
  "expertises.hint",
] as const;
export type ShowcaseAdminWordedKey = (typeof SHOWCASE_ADMIN_WORDED_KEYS)[number];

/** Error codes the showcase routes answer with, each with its message (ShowcasePro.errors). */
export const SHOWCASE_ERROR_CODES = [
  "TOO_LONG",
  "INVALID_FIELD",
  "UNKNOWN_EXPERTISE",
  "TOO_MANY_EXPERTISES",
  "TOO_MANY_VALUES",
  "INVALID_ORDER",
  "NOTHING_TO_SAVE",
  "NOT_FOUND",
  "NO_FILE",
  "PHOTO_TOO_LARGE",
  "PHOTO_INVALID",
  "PHOTO_TOO_SMALL",
  "PHOTO_INFECTED",
  "SCAN_UNAVAILABLE",
  "RATE_LIMITED",
  "CONSENT_REQUIRED",
  "INCOMPLETE",
  "IN_PREPARATION",
  "NOT_PUBLISHED",
  "NOT_UNPUBLISHED",
  "FORBIDDEN",
  "PROFESSIONAL_NOT_ACTIVE",
  "WITHDRAWN_BY_PROFESSIONAL",
  "NOTHING_TO_PUBLISH",
  "REVISION_CHANGED",
  "SLUG_TAKEN",
  "INVALID_SLUG",
  "INVALID_CITY",
  "ALREADY_INVITED",
  "CONFLICT",
  "INVALID_ACTION",
  "ACCOUNT_NOT_ACTIVE",
  "PROFESSIONAL_NOT_FOUND",
] as const;

const KNOWN_ERRORS: ReadonlySet<string> = new Set(SHOWCASE_ERROR_CODES);

/** The message key for an error code (`errors.<key>`), "generic" when unknown. */
export function showcaseErrorKey(code: unknown): string {
  return typeof code === "string" && KNOWN_ERRORS.has(code) ? code : "generic";
}

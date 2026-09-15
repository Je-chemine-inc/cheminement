/**
 * Shared vocabulary of the showcase pages (spec 003). No imports: the model,
 * the server routes and the client forms all read the same lists.
 */

/** Where a page stands for the public. Only `published` is ever shown. */
export const SHOWCASE_STATUSES = ["invited", "draft", "published", "unpublished"] as const;
export type ShowcaseStatus = (typeof SHOWCASE_STATUSES)[number];

/** Where the admin review stands, separately from what is live. */
export const SHOWCASE_REVIEW_STATES = ["none", "pending", "changes_requested"] as const;
export type ShowcaseReviewState = (typeof SHOWCASE_REVIEW_STATES)[number];

export type ShowcaseActor = "professional" | "admin";

/**
 * What a page's history records (ShowcaseAdmin.detail.history). `invite`,
 * `submit`, `request_changes` and `remind` belong to the review flow retired
 * on 2026-09-14; they stay so older entries keep their wording.
 */
export const SHOWCASE_HISTORY_ACTIONS = [
  "activate",
  "approve",
  "edit",
  "unpublish",
  "republish",
  "move",
  "invite",
  "submit",
  "request_changes",
  "remind",
] as const;
export type ShowcaseHistoryAction = (typeof SHOWCASE_HISTORY_ACTIONS)[number];

/**
 * Quebec professional orders a mental-health professional may belong to:
 * psychologues (OPQ, which also issues the psychotherapy permit),
 * psychoéducateurs (OPPQ), travailleurs sociaux et thérapeutes conjugaux et
 * familiaux (OTSTCFQ), conseillers d'orientation (OCCOQ), ergothérapeutes
 * (OEQ), médecins (CMQ), infirmières (OIIQ), sexologues (OPSQ).
 */
export const PROFESSIONAL_ORDER_CODES = [
  "OPQ",
  "OPPQ",
  "OTSTCFQ",
  "OCCOQ",
  "OEQ",
  "CMQ",
  "OIIQ",
  "OPSQ",
  "other",
] as const;
export type ProfessionalOrderCode = (typeof PROFESSIONAL_ORDER_CODES)[number];

/**
 * The order a professional title usually belongs to, to prefill an invited
 * page. Only a suggestion: the professional confirms it.
 */
export const ORDER_CODE_BY_TITLE: Readonly<Record<string, ProfessionalOrderCode>> = {
  psychologist: "OPQ",
  neuropsychologist: "OPQ",
  psychotherapist: "OPQ",
  psychoeducator: "OPPQ",
  occupationalTherapistMentalHealth: "OEQ",
  psychiatrist: "CMQ",
};

/**
 * Version of what the professional agrees to before their page goes live, as
 * an admin confirms it when publishing (`ShowcaseAdmin.detail.consentAttest`).
 * Change it whenever that text changes: pages already published stay up, but
 * the next publication needs the admin to confirm the new agreement.
 */
export const SHOWCASE_CONSENT_VERSION = "showcase-2026-09";

export const SHOWCASE_LIMITS = {
  displayName: 80,
  headline: 120,
  intro: 600,
  bio: 3000,
  /** A presentation shorter than this is not ready to publish. */
  bioMin: 200,
  approach: 600,
  valueLength: 40,
  values: 5,
  expertisesMin: 3,
  expertisesMax: 12,
  insuranceNote: 300,
  orderLabel: 80,
  /** A short description under each value. */
  valueDescription: 120,
  /** Photos of the office, shown in the page's large image slots before any ambience photo. */
  officePhotos: 6,
  /** One sentence the page quotes, signed with the professional's name. */
  quote: 240,
  /** Short mentions under the introduction (« Reçus pour assurances »). */
  highlights: 4,
  highlightLength: 60,
  /** « Parcours »: degrees, trainings, experience, one line each. */
  credentials: 6,
  credentialLength: 120,
  /** « Ce que j'accompagne » cards. */
  focusAreas: 4,
  focusTitle: 60,
  focusBody: 320,
  /** Method cards in « Approche » (« TCC — Thérapie cognitive et comportementale »). */
  methods: 4,
  methodName: 30,
  methodTitle: 60,
  methodBody: 320,
  /** The reason an admin gives when taking a page down. */
  reviewNotes: 2000,
} as const;

export const SHOWCASE_PHOTO = {
  maxBytes: 5 * 1024 * 1024,
  /** The shortest side, in pixels. Smaller photos look blurry on the page. */
  minSide: 400,
  types: ["image/jpeg", "image/png", "image/webp"],
} as const;

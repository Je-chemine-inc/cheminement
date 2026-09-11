/**
 * Admin input for organizations and coverages (spec 002) — allow-lists, never
 * a spread of the request body. Pure: no DB, so every rule is unit-tested.
 *
 * Money arrives in DOLLARS from the admin forms and is stored in integer CENTS.
 * Dates arrive as "YYYY-MM-DD" and become whole UTC days: a coverage "valid
 * until 30 June" must still cover a session on 30 June, whose date is anchored
 * at UTC noon (parseAppointmentDate).
 */
import {
  MAX_ORGANIZATION_BILLING_EMAILS,
  ORGANIZATION_BILLING_CYCLES,
  ORGANIZATION_GAP_POLICIES,
  ORGANIZATION_KINDS,
} from "@/models/Organization";
import { CONSENT_METHODS, COVERAGE_MODES } from "@/models/OrganizationCoverage";
import { toCents } from "@/lib/money-cents";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Sanity ceiling on any per-session amount typed by an admin. */
const MAX_AMOUNT_DOLLARS = 10_000;

function text(v: unknown, max: number): string | undefined | null {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return null;
  return v.trim().slice(0, max);
}

/** Dollars → cents; `null`/"" clears; anything else invalid → NaN. */
export function parseDollarsToCents(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT_DOLLARS) return NaN;
  return toCents(n);
}

/** "YYYY-MM-DD" → the start (or end) of that UTC day; null/"" clears. */
export function parseDay(v: unknown, edge: "start" | "end"): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const m = typeof v === "string" ? DAY_RE.exec(v) : null;
  if (!m) return new Date(NaN);
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date =
    edge === "start"
      ? new Date(Date.UTC(y, mo, d, 0, 0, 0, 0))
      : new Date(Date.UTC(y, mo, d, 23, 59, 59, 999));
  // Reject rollovers such as 2026-02-31.
  if (date.getUTCMonth() !== mo || date.getUTCDate() !== d) return new Date(NaN);
  return date;
}

export function parseBillingEmails(v: unknown): string[] | null {
  const list = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(/[\s,;]+/)
      : null;
  if (!list) return null;
  const emails = [
    ...new Set(
      list
        .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  ];
  if (emails.length > MAX_ORGANIZATION_BILLING_EMAILS) return null;
  if (!emails.every((e) => EMAIL_RE.test(e))) return null;
  return emails;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined | null {
  if (v === undefined) return undefined;
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** Fields an admin may set on an organization. `active` changes only via archive. */
export type OrganizationInput = {
  name?: string;
  kind?: (typeof ORGANIZATION_KINDS)[number];
  billingEmails?: string[];
  contactName?: string | null;
  phone?: string | null;
  address?: {
    street?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  } | null;
  language?: "fr" | "en";
  paymentTermsDays?: number;
  billingCycle?: (typeof ORGANIZATION_BILLING_CYCLES)[number];
  negotiatedRateCents?: number | null;
  gapPolicy?: (typeof ORGANIZATION_GAP_POLICIES)[number];
  autoSendPerSession?: boolean;
  requiresOwnForm?: boolean;
  formNotes?: string | null;
  internalNotes?: string | null;
};

/**
 * `partial` (PATCH): only the fields present are validated and returned.
 * Create requires a name.
 */
export function parseOrganizationInput(
  body: unknown,
  { partial }: { partial: boolean },
): ParseResult<OrganizationInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid body");
  const b = body as Record<string, unknown>;
  const out: OrganizationInput = {};

  const name = text(b.name, 160);
  if (name === null || (name !== undefined && !name)) return fail("name is required");
  if (name !== undefined) out.name = name;
  else if (!partial) return fail("name is required");

  const kind = oneOf(b.kind, ORGANIZATION_KINDS);
  if (kind === null) return fail("Invalid kind");
  if (kind) out.kind = kind;

  if (b.billingEmails !== undefined) {
    const emails = parseBillingEmails(b.billingEmails);
    if (!emails) {
      return fail(`billingEmails: up to ${MAX_ORGANIZATION_BILLING_EMAILS} valid addresses`);
    }
    out.billingEmails = emails;
  }

  for (const [key, max] of [
    ["contactName", 160],
    ["phone", 40],
    ["formNotes", 2000],
    ["internalNotes", 4000],
  ] as const) {
    if (b[key] === undefined) continue;
    if (b[key] !== null && typeof b[key] !== "string") return fail(`Invalid ${key}`);
    out[key] = (text(b[key], max) || null) as string | null;
  }

  if (b.address !== undefined) {
    if (b.address === null) {
      out.address = null;
    } else if (typeof b.address === "object" && !Array.isArray(b.address)) {
      const a = b.address as Record<string, unknown>;
      const address: NonNullable<OrganizationInput["address"]> = {};
      for (const key of ["street", "city", "province", "postalCode", "country"] as const) {
        const v = text(a[key], 160);
        if (v === null) return fail(`Invalid address.${key}`);
        if (v) address[key] = v;
      }
      out.address = address;
    } else {
      return fail("Invalid address");
    }
  }

  const language = oneOf(b.language, ["fr", "en"] as const);
  if (language === null) return fail("Invalid language");
  if (language) out.language = language;

  if (b.paymentTermsDays !== undefined) {
    const n = Number(b.paymentTermsDays);
    if (!Number.isInteger(n) || n < 0 || n > 180) return fail("paymentTermsDays: 0 to 180");
    out.paymentTermsDays = n;
  }

  const cycle = oneOf(b.billingCycle, ORGANIZATION_BILLING_CYCLES);
  if (cycle === null) return fail("Invalid billingCycle");
  if (cycle) out.billingCycle = cycle;

  const rate = parseDollarsToCents(b.negotiatedRate);
  if (Number.isNaN(rate)) return fail("negotiatedRate: an amount in dollars, or empty");
  if (rate !== undefined) out.negotiatedRateCents = rate;

  const gap = oneOf(b.gapPolicy, ORGANIZATION_GAP_POLICIES);
  if (gap === null) return fail("Invalid gapPolicy");
  if (gap) out.gapPolicy = gap;

  for (const key of ["autoSendPerSession", "requiresOwnForm"] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "boolean") return fail(`Invalid ${key}`);
    out[key] = b[key] as boolean;
  }

  return { ok: true, value: out };
}

/** Coverage terms an admin may set. Client, beneficiary and organization are fixed at creation. */
export type CoverageTermsInput = {
  caseNumber?: string | null;
  mode?: (typeof COVERAGE_MODES)[number];
  split?: { type: "fixed" | "percent"; value: number } | null;
  maxSessions?: number | null;
  rateCentsOverride?: number | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
};

export function parseCoverageTerms(
  body: unknown,
  { partial }: { partial: boolean },
): ParseResult<CoverageTermsInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid body");
  const b = body as Record<string, unknown>;
  const out: CoverageTermsInput = {};

  if (b.caseNumber !== undefined) {
    if (b.caseNumber !== null && typeof b.caseNumber !== "string") return fail("Invalid caseNumber");
    out.caseNumber = text(b.caseNumber, 60) || null;
  }

  const mode = oneOf(b.mode, COVERAGE_MODES);
  if (mode === null) return fail("Invalid mode");
  if (mode) out.mode = mode;
  else if (!partial) out.mode = "full";

  if (b.split !== undefined && b.split !== null) {
    const s = b.split as Record<string, unknown>;
    if (s.type === "percent") {
      const v = Number(s.value);
      if (!Number.isInteger(v) || v < 1 || v > 100) return fail("split: a whole percent from 1 to 100");
      out.split = { type: "percent", value: v };
    } else if (s.type === "fixed") {
      const cents = parseDollarsToCents(s.value);
      if (cents === null || cents === undefined || Number.isNaN(cents) || cents === 0) {
        return fail("split: the organization's amount in dollars");
      }
      out.split = { type: "fixed", value: cents };
    } else {
      return fail("split.type must be fixed or percent");
    }
  } else if (b.split === null) {
    out.split = null;
  }
  // A split coverage needs its terms. On an edit the route re-checks this
  // against the merged coverage (the split may already be stored).
  if (!partial && out.mode === "split" && !out.split) {
    return fail("A split coverage needs the organization's share");
  }

  if (b.maxSessions !== undefined) {
    if (b.maxSessions === null || b.maxSessions === "") {
      out.maxSessions = null;
    } else {
      const n = Number(b.maxSessions);
      if (!Number.isInteger(n) || n < 1 || n > 500) return fail("maxSessions: a whole number from 1");
      out.maxSessions = n;
    }
  }

  const rate = parseDollarsToCents(b.rateOverride);
  if (Number.isNaN(rate)) return fail("rateOverride: an amount in dollars, or empty");
  if (rate !== undefined) out.rateCentsOverride = rate;

  const from = parseDay(b.validFrom, "start");
  const until = parseDay(b.validUntil, "end");
  if (from && Number.isNaN(from.getTime())) return fail("validFrom: YYYY-MM-DD");
  if (until && Number.isNaN(until.getTime())) return fail("validUntil: YYYY-MM-DD");
  if (from && until && until < from) return fail("validUntil is before validFrom");
  if (from !== undefined) out.validFrom = from;
  if (until !== undefined) out.validUntil = until;

  return { ok: true, value: out };
}

export type ConsentAction =
  | {
      action: "give";
      method: (typeof CONSENT_METHODS)[number];
      note: string;
    }
  | { action: "withdraw"; note: string };

/** Recording or withdrawing consent always needs a note: who, when, how. */
export function parseConsentAction(body: unknown): ParseResult<ConsentAction> {
  if (!body || typeof body !== "object") return fail("Invalid body");
  const b = body as Record<string, unknown>;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 2000) : "";
  if (!note) return fail("A note is required (how and when the client said so)");
  if (b.action === "withdraw") return { ok: true, value: { action: "withdraw", note } };
  if (b.action !== "give") return fail("action must be give or withdraw");
  const method = oneOf(b.method, CONSENT_METHODS);
  if (!method) return fail(`method must be one of ${CONSENT_METHODS.join(", ")}`);
  return { ok: true, value: { action: "give", method, note } };
}

/** "self", or the loved one's name as the booking funnel records it. */
export function parseBeneficiary(v: unknown): ParseResult<{ firstName?: string; lastName?: string } | "self"> {
  if (v === undefined || v === null || v === "self") return { ok: true, value: "self" };
  if (typeof v !== "object" || Array.isArray(v)) return fail("Invalid beneficiary");
  const b = v as Record<string, unknown>;
  const firstName = typeof b.firstName === "string" ? b.firstName.trim().slice(0, 80) : "";
  const lastName = typeof b.lastName === "string" ? b.lastName.trim().slice(0, 80) : "";
  if (!firstName && !lastName) return fail("The beneficiary needs a name");
  return { ok: true, value: { firstName, lastName } };
}

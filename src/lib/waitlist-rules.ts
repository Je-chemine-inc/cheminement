/**
 * Rules of a professional's waitlist (spec 003 phase 4): a visitor who finds no
 * suitable time on a showcase page leaves their name, and when a time frees up
 * the first person it suits is offered it for 15 minutes. Pure and client-safe.
 *
 * The general waitlist is Je chemine's ordinary matching: the page links to the
 * booking funnel, and nothing here is involved.
 */

import { isDirectRequestService, type DirectRequestService } from "@/lib/direct-request-rules";

/** The waitlist section's id on a professional's page. */
export const SHOWCASE_WAITLIST_ANCHOR = "liste-attente";

/** The consent text the visitor accepted. Change it together with the words in messages/*.json. */
export const WAITLIST_CONSENT_VERSION = "2026-09-13";

/** How long an offered time stays held for the person it was offered to. */
export const WAITLIST_OFFER_MINUTES = 15;
/** An entry leaves the list after this many offers left unanswered. */
export const WAITLIST_MAX_MISSED_OFFERS = 3;
/** An entry leaves the list this long after joining. */
export const WAITLIST_ENTRY_DAYS = 90;
/** At most this many people wait for one professional at a time. */
export const WAITLIST_MAX_OPEN_PER_PROFESSIONAL = 50;
/** A closed entry — converted, expired, left or removed — is deleted this long after closing. */
export const WAITLIST_CLOSED_RETENTION_DAYS = 90;

/** No offer goes out between these Montréal hours: offers wait until morning (owner, 2026-09-15). */
export const WAITLIST_QUIET_FROM_HOUR = 21;
export const WAITLIST_QUIET_UNTIL_HOUR = 8;

/** Whether it is quiet hours in Montréal (21 h to 8 h), whatever the server's time zone. */
export function isWaitlistQuietHours(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  return hour >= WAITLIST_QUIET_FROM_HOUR || hour < WAITLIST_QUIET_UNTIL_HOUR;
}

export const WAITLIST_STATUSES = ["active", "offered", "converted", "expired", "left", "removed"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];
/** Still waiting: counted in the queue and in the per-professional cap. */
export const WAITLIST_OPEN_STATUSES = ["active", "offered"] as const;

/**
 * pending: sent, not answered. claiming: the person pressed the button and the
 * request is being made. claimed: it became a request. expired: 15 minutes
 * passed. slot_lost: the time could no longer be requested when claimed.
 * withdrawn: the entry left the list while the offer was out.
 */
export const WAITLIST_OFFER_OUTCOMES = ["pending", "claiming", "claimed", "expired", "slot_lost", "withdrawn"] as const;
export type WaitlistOfferOutcome = (typeof WAITLIST_OFFER_OUTCOMES)[number];

export const WAITLIST_REMOVAL_REASONS = ["missed", "expired", "professional", "admin"] as const;
export type WaitlistRemovalReason = (typeof WAITLIST_REMOVAL_REASONS)[number];

export const WAITLIST_PERIODS = ["morning", "afternoon", "evening"] as const;
export type WaitlistPeriod = (typeof WAITLIST_PERIODS)[number];

export const WAITLIST_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type WaitlistWeekday = (typeof WAITLIST_WEEKDAYS)[number];

export const WAITLIST_MODALITIES = ["video", "in-person", "phone", "both"] as const;
export type WaitlistModality = (typeof WAITLIST_MODALITIES)[number];

export function waitlistStatusFields(status: WaitlistStatus): { status: WaitlistStatus; isOpen: boolean } {
  return { status, isOpen: (WAITLIST_OPEN_STATUSES as readonly string[]).includes(status) };
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Morning before noon, afternoon before 17:00, evening after. */
export function slotPeriod(time: string): WaitlistPeriod {
  const minutes = minutesOf(time);
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  return "evening";
}

/** The weekday of a Montréal calendar day. */
export function weekdayOfDayKey(dayKey: string): WaitlistWeekday {
  const sundayFirst = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  return WAITLIST_WEEKDAYS[(sundayFirst + 6) % 7];
}

export interface WaitlistPreferences {
  service: DirectRequestService;
  /** Empty: any time of day. */
  periods: readonly WaitlistPeriod[];
  /** Empty: any day. */
  days: readonly WaitlistWeekday[];
}

export interface WaitlistSlot {
  service: DirectRequestService;
  /** Montréal calendar day, "YYYY-MM-DD". */
  dayKey: string;
  /** Montréal wall-clock start, "HH:mm". */
  time: string;
  durationMinutes: number;
}

export function entryFitsSlot(entry: WaitlistPreferences, slot: Pick<WaitlistSlot, "service" | "dayKey" | "time">): boolean {
  if (entry.service !== slot.service) return false;
  if (entry.periods.length > 0 && !entry.periods.includes(slotPeriod(slot.time))) return false;
  if (entry.days.length > 0 && !entry.days.includes(weekdayOfDayKey(slot.dayKey))) return false;
  return true;
}

export function waitlistSlotKey(slot: Pick<WaitlistSlot, "dayKey" | "time">): string {
  return `${slot.dayKey} ${slot.time}`;
}

export interface WaitlistQueueEntry extends WaitlistPreferences {
  id: string;
  /** Times already offered to this person: never offered twice. */
  offeredSlotKeys: readonly string[];
}

function overlaps(a: WaitlistSlot, b: WaitlistSlot): boolean {
  if (a.dayKey !== b.dayKey) return false;
  const aStart = minutesOf(a.time);
  const bStart = minutesOf(b.time);
  return aStart < bStart + b.durationMinutes && bStart < aStart + a.durationMinutes;
}

/**
 * Who is offered which time, in queue order: each person gets the earliest
 * free time that suits them and was never offered to them, at most one; a time
 * goes to one person, and two offers never overlap (a standard and a quick
 * consultation can start inside each other).
 */
export function pickOffers(
  entries: readonly WaitlistQueueEntry[],
  slots: readonly WaitlistSlot[],
): { entryId: string; slot: WaitlistSlot }[] {
  const ordered = [...slots].sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.time.localeCompare(b.time));
  const taken: WaitlistSlot[] = [];
  const picks: { entryId: string; slot: WaitlistSlot }[] = [];
  for (const entry of entries) {
    const slot = ordered.find(
      (candidate) =>
        entryFitsSlot(entry, candidate) &&
        !entry.offeredSlotKeys.includes(waitlistSlotKey(candidate)) &&
        !taken.some((other) => overlaps(other, candidate)),
    );
    if (!slot) continue;
    taken.push(slot);
    picks.push({ entryId: entry.id, slot });
  }
  return picks;
}

/* ------------------------------------------------------------------------ */
/* Text message                                                               */
/* ------------------------------------------------------------------------ */

/** The GSM 03.38 basic alphabet: a message in it costs one segment up to 160 characters. */
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);

export const SMS_SEGMENT_LENGTH = 160;

export function isGsm7(text: string): boolean {
  return [...text].every((char) => GSM7_BASIC.has(char));
}

/** A name in the GSM alphabet: "Hélène Côté" keeps its é and becomes "Hélène Coté". */
function toGsm7(text: string): string {
  let out = "";
  for (const char of text) {
    if (GSM7_BASIC.has(char)) {
      out += char;
      continue;
    }
    const base = char.normalize("NFD")[0];
    if (base && GSM7_BASIC.has(base)) out += base;
  }
  return out.replace(/\s+/g, " ").trim();
}

const SMS_WEEKDAYS = {
  fr: ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
} as const;
const SMS_MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "mer. 16/09 à 10 h 00" / "Wed Sep 16 at 10:00" — short and in the GSM alphabet. */
export function smsSlotLabel(dayKey: string, time: string, lang: "fr" | "en"): string {
  const [, month, day] = dayKey.split("-").map(Number);
  const weekday = SMS_WEEKDAYS[lang][new Date(`${dayKey}T12:00:00Z`).getUTCDay()];
  const [hours, minutes] = time.split(":");
  if (lang === "en") return `${weekday} ${SMS_MONTHS_EN[month - 1]} ${day} at ${hours}:${minutes}`;
  return `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")} à ${Number(hours)} h ${minutes}`;
}

/**
 * The offer as a text message: one segment, whatever the professional's name.
 * The name is shortened to fit; the link is never cut.
 */
export function waitlistOfferSms(input: {
  lang: "fr" | "en";
  professionalName: string;
  dayKey: string;
  time: string;
  url: string;
}): string {
  const slot = smsSlotLabel(input.dayKey, input.time, input.lang);
  const build = (name: string) =>
    input.lang === "en"
      ? `Je chemine: a time opened with ${name}, ${slot}. Held for you 15 min: ${input.url}`
      : `Je chemine : créneau libéré avec ${name}, ${slot}. Réservé 15 min : ${input.url}`;
  const name = toGsm7(input.professionalName);
  const room = SMS_SEGMENT_LENGTH - build("").length;
  return build(room >= name.length ? name : name.slice(0, Math.max(room, 0)).trimEnd());
}

/* ------------------------------------------------------------------------ */
/* Joining                                                                    */
/* ------------------------------------------------------------------------ */

/** The link in an offer: 16 random bytes, base64url. */
const OFFER_TOKEN = /^[A-Za-z0-9_-]{22}$/;
/** The link to leave the list: 32 random bytes, hex. */
const LEAVE_TOKEN = /^[a-f0-9]{64}$/;

export function isWaitlistOfferToken(value: unknown): value is string {
  return typeof value === "string" && OFFER_TOKEN.test(value);
}

export function isWaitlistLeaveToken(value: unknown): value is string {
  return typeof value === "string" && LEAVE_TOKEN.test(value);
}

export interface WaitlistJoinInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  locale: "fr" | "en";
  service: DirectRequestService;
  modality: WaitlistModality;
  motifs: string[];
  periods: WaitlistPeriod[];
  days: WaitlistWeekday[];
  smsConsent: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^[+()\-.\s\d]{7,25}$/;
const NAME_MAX = 60;
const MOTIF_MAX = 120;
export const WAITLIST_MAX_MOTIFS = 3;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function subsetOf<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > allowed.length) return null;
  const out: T[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(allowed as readonly string[]).includes(item)) return null;
    if (!out.includes(item as T)) out.push(item as T);
  }
  return out;
}

/** A phone number with 10 to 15 digits, as the visitor typed it; null when absent. */
export function parseWaitlistPhone(value: unknown): { ok: true; phone: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, phone: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, phone: null };
  const digits = trimmed.replace(/\D/g, "").length;
  return PHONE_CHARS.test(trimmed) && digits >= 10 && digits <= 15 ? { ok: true, phone: trimmed } : { ok: false };
}

/**
 * The join form, checked field by field. The consent must be the current text;
 * a text message needs its own consent and a phone number. Which motifs exist
 * is the route's check.
 */
export function parseWaitlistJoin(body: unknown): { ok: true; value: WaitlistJoinInput } | { ok: false; field: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, field: "body" };
  const input = body as Record<string, unknown>;

  const firstName = text(input.firstName, NAME_MAX);
  if (!firstName) return { ok: false, field: "firstName" };
  const lastName = text(input.lastName, NAME_MAX);
  if (!lastName) return { ok: false, field: "lastName" };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, field: "email" };
  const phone = parseWaitlistPhone(input.phone);
  if (!phone.ok) return { ok: false, field: "phone" };
  if (!isDirectRequestService(input.service)) return { ok: false, field: "service" };
  if (typeof input.modality !== "string" || !(WAITLIST_MODALITIES as readonly string[]).includes(input.modality)) {
    return { ok: false, field: "modality" };
  }

  let motifs: string[] = [];
  if (input.motifs !== undefined && input.motifs !== null) {
    if (!Array.isArray(input.motifs) || input.motifs.length > WAITLIST_MAX_MOTIFS) return { ok: false, field: "motifs" };
    for (const motif of input.motifs) {
      const label = text(motif, MOTIF_MAX);
      if (!label) return { ok: false, field: "motifs" };
      if (!motifs.includes(label)) motifs.push(label);
    }
  }
  motifs = motifs.slice(0, WAITLIST_MAX_MOTIFS);

  const periods = subsetOf(input.periods, WAITLIST_PERIODS);
  if (!periods) return { ok: false, field: "periods" };
  const days = subsetOf(input.days, WAITLIST_WEEKDAYS);
  if (!days) return { ok: false, field: "days" };

  if (input.consent !== true || input.consentVersion !== WAITLIST_CONSENT_VERSION) return { ok: false, field: "consent" };
  if (input.smsConsent !== undefined && typeof input.smsConsent !== "boolean") return { ok: false, field: "smsConsent" };
  const smsConsent = input.smsConsent === true;
  if (smsConsent && !phone.phone) return { ok: false, field: "smsConsent" };

  return {
    ok: true,
    value: {
      firstName,
      lastName,
      email,
      phone: phone.phone,
      locale: input.locale === "en" ? "en" : "fr",
      service: input.service,
      modality: input.modality as WaitlistModality,
      motifs,
      periods,
      days,
      smsConsent,
    },
  };
}

export const WAITLIST_ERROR_MESSAGES = {
  INVALID_WAITLIST_REQUEST: "Invalid waitlist request",
  INVALID_MOTIFS: "Choose the reasons from the list",
  WAITLIST_FULL: "This waitlist is full",
  SHOWCASE_NOT_FOUND: "This professional's page is not available",
  OFFER_INVALID: "This link is not valid",
  OFFER_EXPIRED: "This offer has expired",
  OFFER_CLAIMED: "This offer was already used",
  OFFER_UNAVAILABLE: "This time can no longer be requested",
  LINK_INVALID: "This link is no longer valid",
} as const;
export type WaitlistErrorCode = keyof typeof WAITLIST_ERROR_MESSAGES;

/** "Amel S." — how a professional's screen names the people waiting. */
export function waitlistShortName(firstName: string, lastName: string): string {
  const initial = lastName.trim()[0]?.toUpperCase();
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}

import { PROFESSIONAL_TITLES } from "@/data/professionalTitles";
import { slotGridOf } from "@/lib/available-slots";
import { FREE_CANCELLATION_HOURS } from "@/lib/cancellation-policy";
import { quickConsultationMinutes } from "@/lib/professional-pricing";
import { findShowcaseCity } from "@/lib/showcase-cities";
import {
  PROFESSIONAL_ORDER_CODES,
  type ProfessionalOrderCode,
} from "@/lib/showcase-constants";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import { paragraphsOf } from "@/lib/showcase-workflow";

/**
 * What the public may see of a professional (spec 003), built KEY BY KEY.
 *
 * This is the boundary between the database and every public page, preview
 * and structured data. Nothing is spread from a document: a field reaches the
 * public only when it is named below, so a field added to User or Profile
 * later can never leak through a page. Never an email, a phone, the home
 * city (`User.location`), an office street address, payout details, the
 * professional's rate or the platform's margin. Pure.
 */

export type ShowcaseLocale = "fr" | "en";

export const SHOWCASE_LANGUAGE_KEYS = ["french", "english", "arabic", "spanish", "mandarin"] as const;
export type ShowcaseLanguageKey = (typeof SHOWCASE_LANGUAGE_KEYS)[number];

export const SHOWCASE_MODALITY_KEYS = ["inPerson", "video", "phone", "chat"] as const;
export type ShowcaseModalityKey = (typeof SHOWCASE_MODALITY_KEYS)[number];

export const SHOWCASE_THERAPY_TYPES = ["solo", "couple", "group"] as const;
export type ShowcaseTherapyType = (typeof SHOWCASE_THERAPY_TYPES)[number];

export type ShowcaseTitleKey = Exclude<(typeof PROFESSIONAL_TITLES)[number]["value"], "otherProfessionals">;

type LocalizedSource = { fr?: string | null; en?: string | null } | null | undefined;

export interface ShowcaseContentSource {
  /** The city the copy asks for; the public page always uses the page's own city. */
  cityKey?: string | null;
  displayName?: string | null;
  headline?: LocalizedSource;
  intro?: LocalizedSource;
  bio?: LocalizedSource;
  approach?: LocalizedSource;
  insuranceNote?: LocalizedSource;
  values?: readonly ({ fr?: string | null; en?: string | null; details?: LocalizedSource } | null | undefined)[] | null;
  quote?: LocalizedSource;
  highlights?: readonly LocalizedSource[] | null;
  credentials?: readonly LocalizedSource[] | null;
  focusAreas?: readonly ({ title?: LocalizedSource; body?: LocalizedSource } | null | undefined)[] | null;
  methods?: readonly ({ name?: LocalizedSource; title?: LocalizedSource; body?: LocalizedSource } | null | undefined)[] | null;
  expertiseIds?: readonly unknown[] | null;
  orderCode?: string | null;
  orderLabel?: string | null;
  photoFileId?: unknown;
  officePhotoFileIds?: readonly unknown[] | null;
}

export interface ShowcaseProfileSource {
  specialty?: string | null;
  license?: string | null;
  languages?: readonly string[] | null;
  modalities?: readonly string[] | null;
  sessionTypes?: readonly string[] | null;
  officeAddress?: { city?: string | null } | null;
  yearsOfExperience?: number | null;
  acceptingNewClients?: boolean | null;
  acceptingEmergencyConsultations?: boolean | null;
  availability?: { sessionDurationMinutes?: number | null } | null;
  quickConsultation?: { durationMinutes?: number | null } | null;
}

export interface ShowcaseExpertiseSource {
  id: string;
  slug?: string | null;
  labelFr: string;
  labelEn?: string | null;
}

export type ShowcaseServiceSwitches = { standard?: boolean | null; quick?: boolean | null } | null | undefined;

export interface BuildShowcaseInput {
  locale: ShowcaseLocale;
  page: {
    slug: string;
    cityKey: string;
    services?: ShowcaseServiceSwitches;
  };
  content: ShowcaseContentSource;
  user: { firstName?: string | null; lastName?: string | null };
  profile: ShowcaseProfileSource | null;
  /** Catalog expertises still offered on pages, in any order. */
  expertises: readonly ShowcaseExpertiseSource[];
  /** What a client pays per therapy type (from the pricing rules). */
  prices: Partial<Record<ShowcaseTherapyType, number>>;
  /** What a client pays for a quick one-time consultation (from the pricing rules). */
  quickPrice?: number | null;
}

export interface ShowcasePrice {
  therapyType: ShowcaseTherapyType;
  price: number;
}

export interface ShowcasePublicProfile {
  slug: string;
  url: string;
  city: { key: string; name: string; region: string; regionKey: string };
  displayName: string;
  title: { key: ShowcaseTitleKey | null; label: string | null };
  order: { code: ProfessionalOrderCode; label: string | null } | null;
  licenseNumber: string | null;
  photoUrl: string | null;
  /** Office photos in display order; unusable ids are dropped. */
  officePhotoUrls: string[];
  headline: string;
  intro: string[];
  bio: string[];
  approach: string[];
  values: string[];
  /** The values again, each with its description ("" when none). */
  valueCards: { label: string; description: string }[];
  quote: string;
  highlights: string[];
  credentials: string[];
  focusAreas: { title: string; body: string[] }[];
  methods: { name: string; title: string; body: string[] }[];
  expertises: { slug: string | null; label: string }[];
  languages: ShowcaseLanguageKey[];
  modalities: ShowcaseModalityKey[];
  officeCity: string | null;
  yearsOfExperience: number | null;
  services: {
    standard: { offered: boolean; durationMinutes: number; prices: ShowcasePrice[] };
    quick: { offered: boolean; durationMinutes: number; price: number | null };
  };
  insuranceNote: string[];
  freeCancellationHours: number;
}

/** The keys of a public profile — the spec pins that nothing else appears. */
export const SHOWCASE_PUBLIC_KEYS = [
  "approach",
  "bio",
  "city",
  "credentials",
  "displayName",
  "expertises",
  "focusAreas",
  "freeCancellationHours",
  "headline",
  "highlights",
  "insuranceNote",
  "intro",
  "languages",
  "licenseNumber",
  "methods",
  "modalities",
  "officeCity",
  "officePhotoUrls",
  "order",
  "photoUrl",
  "quote",
  "services",
  "slug",
  "title",
  "url",
  "valueCards",
  "values",
  "yearsOfExperience",
] as const;

/**
 * Whether a page offers a consultation right now: the page's own switch and
 * the professional's. Standard is on unless switched off, quick only when
 * switched on; a professional who takes no new clients (or no quick requests)
 * closes it. The booking routes apply the same rule.
 */
export function showcaseServiceOffered(
  service: "standard" | "quick",
  switches: ShowcaseServiceSwitches,
  profile: Pick<ShowcaseProfileSource, "acceptingNewClients" | "acceptingEmergencyConsultations"> | null | undefined,
): boolean {
  return service === "standard"
    ? switches?.standard !== false && profile?.acceptingNewClients !== false
    : switches?.quick === true && profile?.acceptingEmergencyConsultations !== false;
}

function hasFrench(text: LocalizedSource): boolean {
  return Boolean(text?.fr?.trim());
}

function pick(text: LocalizedSource, locale: ShowcaseLocale): string {
  const fr = text?.fr?.trim() ?? "";
  const en = text?.en?.trim() ?? "";
  return locale === "en" && en ? en : fr;
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const LANGUAGE_ALIASES: Record<string, ShowcaseLanguageKey> = {
  french: "french",
  francais: "french",
  fr: "french",
  english: "english",
  anglais: "english",
  en: "english",
  arabic: "arabic",
  arabe: "arabic",
  ar: "arabic",
  spanish: "spanish",
  espagnol: "spanish",
  es: "spanish",
  mandarin: "mandarin",
  chinese: "mandarin",
  chinois: "mandarin",
  zh: "mandarin",
};

/** Profiles store languages several ways ("french", "Français", "English"). */
export function showcaseLanguageKey(raw: string): ShowcaseLanguageKey | null {
  return LANGUAGE_ALIASES[stripAccents(raw).trim().toLowerCase()] ?? null;
}

/** Profiles store modalities several ways ("Video Call", "Vidéo", "In-Person (Office)"). */
export function showcaseModalityKey(raw: string): ShowcaseModalityKey | null {
  const value = stripAccents(raw).toLowerCase();
  if (/in-person|in person|en personne|office|bureau|presentiel/.test(value)) return "inPerson";
  if (/phone|telephone/.test(value)) return "phone";
  if (/video|visio|en ligne|online|teleconsultation/.test(value)) return "video";
  if (/chat|messag|clavardage/.test(value)) return "chat";
  return null;
}

function therapyTypeOf(raw: string): ShowcaseTherapyType | null {
  const value = stripAccents(raw).trim().toLowerCase();
  if (value === "individual" || value === "solo" || value === "individuel") return "solo";
  if (value === "couple") return "couple";
  if (value === "group" || value === "groupe") return "group";
  return null;
}

function uniqueKeys<K extends string>(values: readonly string[] | null | undefined, keyOf: (raw: string) => K | null, order: readonly K[]): K[] {
  const found = new Set<K>();
  for (const raw of values ?? []) {
    if (typeof raw !== "string") continue;
    const key = keyOf(raw);
    if (key) found.add(key);
  }
  return order.filter((key) => found.has(key));
}

const TITLE_KEYS = new Set<string>(PROFESSIONAL_TITLES.map((title) => title.value));

function titleOf(specialty: string | null | undefined): ShowcasePublicProfile["title"] {
  const raw = specialty?.trim() ?? "";
  if (!raw || raw === "otherProfessionals") return { key: null, label: null };
  if (TITLE_KEYS.has(raw)) return { key: raw as ShowcaseTitleKey, label: null };
  return { key: null, label: raw.slice(0, 80) };
}

function orderOf(code: string | null | undefined, label: string | null | undefined): ShowcasePublicProfile["order"] {
  if (!code || !(PROFESSIONAL_ORDER_CODES as readonly string[]).includes(code)) return null;
  const orderCode = code as ProfessionalOrderCode;
  if (orderCode !== "other") return { code: orderCode, label: null };
  const name = label?.trim() ?? "";
  return name ? { code: orderCode, label: name.slice(0, 80) } : null;
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/;

function photoUrlOf(photoFileId: unknown): string | null {
  const id = photoFileId == null ? "" : String(photoFileId);
  return OBJECT_ID_RE.test(id) ? `/api/files/${id}` : null;
}

function priceOf(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildShowcasePublicProfile(input: BuildShowcaseInput): ShowcasePublicProfile | null {
  const city = findShowcaseCity(input.page.cityKey);
  if (!city) return null;
  const { content, profile, locale } = input;

  const byId = new Map(input.expertises.map((expertise) => [expertise.id, expertise]));
  const expertises: ShowcasePublicProfile["expertises"] = [];
  for (const id of content.expertiseIds ?? []) {
    const expertise = byId.get(String(id));
    if (!expertise) continue;
    const label = locale === "en" && expertise.labelEn?.trim() ? expertise.labelEn.trim() : expertise.labelFr.trim();
    expertises.push({ slug: expertise.slug?.trim() || null, label });
  }

  const offeredTypes = uniqueKeys(profile?.sessionTypes, therapyTypeOf, SHOWCASE_THERAPY_TYPES);
  const prices: ShowcasePrice[] = [];
  for (const therapyType of offeredTypes.length > 0 ? offeredTypes : (["solo"] as const)) {
    const price = priceOf(input.prices[therapyType]);
    if (price !== null) prices.push({ therapyType, price });
  }

  const years = profile?.yearsOfExperience;
  const displayName =
    content.displayName?.trim() || `${input.user.firstName ?? ""} ${input.user.lastName ?? ""}`.trim();

  return {
    slug: input.page.slug,
    url: absoluteShowcaseUrl(city.key, `/${input.page.slug}`),
    city: { key: city.key, name: city.name, region: city.region, regionKey: city.regionKey },
    displayName,
    title: titleOf(profile?.specialty),
    order: orderOf(content.orderCode, content.orderLabel),
    licenseNumber: profile?.license?.trim().slice(0, 40) || null,
    photoUrl: photoUrlOf(content.photoFileId),
    officePhotoUrls: (content.officePhotoFileIds ?? [])
      .map(photoUrlOf)
      .filter((url): url is string => url !== null),
    headline: pick(content.headline, locale),
    intro: paragraphsOf(pick(content.intro, locale)),
    bio: paragraphsOf(pick(content.bio, locale)),
    approach: paragraphsOf(pick(content.approach, locale)),
    values: (content.values ?? []).map((value) => pick(value, locale)).filter(Boolean),
    // Like the draft rules, an item or a card exists only with its French wording.
    valueCards: (content.values ?? [])
      .filter(hasFrench)
      .map((value) => ({ label: pick(value, locale), description: pick(value?.details, locale) })),
    quote: pick(content.quote, locale),
    highlights: (content.highlights ?? []).filter(hasFrench).map((line) => pick(line, locale)),
    credentials: (content.credentials ?? []).filter(hasFrench).map((line) => pick(line, locale)),
    focusAreas: (content.focusAreas ?? [])
      .filter((card) => hasFrench(card?.title))
      .map((card) => ({ title: pick(card?.title, locale), body: paragraphsOf(pick(card?.body, locale)) })),
    methods: (content.methods ?? [])
      .filter((card) => hasFrench(card?.name))
      .map((card) => ({
        name: pick(card?.name, locale),
        title: pick(card?.title, locale),
        body: paragraphsOf(pick(card?.body, locale)),
      })),
    expertises,
    languages: uniqueKeys(profile?.languages, showcaseLanguageKey, SHOWCASE_LANGUAGE_KEYS),
    modalities: uniqueKeys(profile?.modalities, showcaseModalityKey, SHOWCASE_MODALITY_KEYS),
    officeCity: profile?.officeAddress?.city?.trim().slice(0, 80) || null,
    yearsOfExperience:
      typeof years === "number" && Number.isInteger(years) && years >= 0 && years <= 70 ? years : null,
    services: {
      standard: {
        offered: showcaseServiceOffered("standard", input.page.services, profile),
        durationMinutes: slotGridOf(profile?.availability).sessionMinutes,
        prices,
      },
      quick: {
        offered: showcaseServiceOffered("quick", input.page.services, profile),
        durationMinutes: quickConsultationMinutes(profile?.quickConsultation?.durationMinutes),
        price: priceOf(input.quickPrice),
      },
    },
    insuranceNote: paragraphsOf(pick(content.insuranceNote, locale)),
    freeCancellationHours: FREE_CANCELLATION_HOURS,
  };
}

/** The subset a city, expertise or region page lists. */
export interface ShowcaseCard {
  slug: string;
  url: string;
  city: { key: string; name: string };
  displayName: string;
  title: ShowcasePublicProfile["title"];
  photoUrl: string | null;
  headline: string;
  modalities: ShowcaseModalityKey[];
  /** The first three, for display. */
  expertises: string[];
  /** Every expertise's URL segment, for the expertise pages. */
  expertiseSlugs: string[];
  officeCity: string | null;
  yearsOfExperience: number | null;
  /** Whether the quick one-time consultation is open (the directory's « rapide » filter). */
  offersQuick: boolean;
}

export function toShowcaseCard(profile: ShowcasePublicProfile): ShowcaseCard {
  return {
    slug: profile.slug,
    url: profile.url,
    city: { key: profile.city.key, name: profile.city.name },
    displayName: profile.displayName,
    title: profile.title,
    photoUrl: profile.photoUrl,
    headline: profile.headline,
    modalities: profile.modalities,
    expertises: profile.expertises.slice(0, 3).map((expertise) => expertise.label),
    expertiseSlugs: profile.expertises
      .map((expertise) => expertise.slug)
      .filter((slug): slug is string => Boolean(slug)),
    officeCity: profile.officeCity,
    yearsOfExperience: profile.yearsOfExperience,
    offersQuick: profile.services.quick.offered,
  };
}

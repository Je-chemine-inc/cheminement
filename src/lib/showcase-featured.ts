import { isValidShowcaseSlug } from "@/lib/showcase-slug";
import { showcaseTitleOf, type ShowcaseTitleKey } from "@/lib/showcase-title";
import {
  SHOWCASE_LANGUAGE_KEYS,
  SHOWCASE_MODALITY_KEYS,
  SHOWCASE_SHOWN_MODALITIES,
  showcaseLanguageKey,
  showcaseModalityKey,
  type ShowcaseLanguageKey,
  type ShowcaseModalityKey,
} from "@/lib/showcase-public";

/**
 * « Quelques-uns de nos professionnels » on « Qui sommes-nous » and « Je suis
 * un professionnel »: which professionals the section shows, and what it takes
 * from each. Pure: the documents are loaded in showcase-featured-queries.ts and
 * leave only through here, field by field. The rules are those of the former
 * « Nos professionnels » page (removed 2026-09-16), without its admin curation.
 *
 *  - Every active professional, except one who unticked « Profil visible aux
 *    clients » (Profile.profileVisible), and one whose profile was never
 *    completed and who has no page (nothing to show but a name).
 *  - With a published page (and the pages switched on): the page's name,
 *    portrait and text, reviewed by the team, and « Découvrir sa page ».
 *  - Without one: the profile's title and bio, no photo (a profile has none
 *    that may be public), and no link.
 *  - Professionals with a page come first, then by last name.
 *
 * The network is small, so the section never counts anyone (no « 5
 * professionnels », no filters by profession) and shows at most a few.
 */

export type FeaturedLocale = "fr" | "en";

type LocalizedSource = { fr?: string | null; en?: string | null } | null | undefined;

export interface FeaturedUserSource {
  _id: unknown;
  firstName?: string | null;
  lastName?: string | null;
}

export interface FeaturedProfileSource {
  userId: unknown;
  specialty?: string | null;
  bio?: string | null;
  education?: readonly ({ degree?: string | null } | null | undefined)[] | null;
  profileVisible?: boolean | null;
  profileCompleted?: boolean | null;
  languages?: readonly unknown[] | null;
  modalities?: readonly unknown[] | null;
  yearsOfExperience?: unknown;
}

export interface FeaturedPageSource {
  userId: unknown;
  slug: string;
  published?: {
    displayName?: string | null;
    photoFileId?: unknown;
    headline?: LocalizedSource;
    intro?: LocalizedSource;
    bio?: LocalizedSource;
  } | null;
}

export interface FeaturedProfessional {
  id: string;
  displayName: string;
  title: { key: ShowcaseTitleKey | null; label: string | null };
  /** A short degree (« Ph.D. », « M.A. ») from the profile, shown before the title. */
  degree: string | null;
  summary: string;
  photoUrl: string | null;
  /** `/<slug>` when the professional has a published page; null shows no link. */
  pagePath: string | null;
  languages: ShowcaseLanguageKey[];
  modalities: ShowcaseModalityKey[];
  /** Whole years, 0 to 70, as the profile says. */
  yearsOfExperience: number | null;
}

/** Every key a featured professional carries; nothing else reaches the page. */
export const FEATURED_PROFESSIONAL_KEYS = [
  "degree",
  "displayName",
  "id",
  "languages",
  "modalities",
  "pagePath",
  "photoUrl",
  "summary",
  "title",
  "yearsOfExperience",
] as const;

export const FEATURED_LIMIT = 6;
export const FEATURED_SUMMARY_MAX = 260;
const DEGREE_MAX = 16;
const NAME_MAX = 80;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function pick(text: LocalizedSource, locale: FeaturedLocale): string {
  const fr = clean(text?.fr);
  const en = clean(text?.en);
  return locale === "en" && en ? en : fr;
}

/** Cut at a word, with an ellipsis. */
export function shortenSummary(text: string, max = FEATURED_SUMMARY_MAX): string {
  const value = clean(text);
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

function photoUrlOf(fileId: unknown): string | null {
  const id = fileId == null ? "" : String(fileId);
  return OBJECT_ID_RE.test(id) ? `/api/files/${id}` : null;
}

/** « Ph.D. », « M.A. », « Ph. D. », « B.Sc. » */
const DOTTED_DEGREE_RE = /^[A-Za-zÀ-ÿ]{1,4}\.(\s?[A-Za-zÀ-ÿ]{1,4}\.?)*$/;
/** « PhD », « MSc », « MBA »: at least two capitals, no spaces. */
const ACRONYM_DEGREE_RE = /^(?=(?:[^A-Z]*[A-Z]){2})[A-Za-z]{2,5}$/;

/**
 * The degree shown before the title: an abbreviation only. Profiles hold free
 * text (« Master », « Maîtrise en travail social »), which reads badly as
 * « Master · Psychologue », so a word or a sentence is not shown.
 */
export function degreeOf(profile: Pick<FeaturedProfileSource, "education">): string | null {
  for (const item of profile.education ?? []) {
    const degree = clean(item?.degree);
    if (degree && degree.length <= DEGREE_MAX && (DOTTED_DEGREE_RE.test(degree) || ACRONYM_DEGREE_RE.test(degree))) {
      return degree;
    }
  }
  return null;
}

/** Words of professional titles, without accents: a text made of these only says nothing the title does not. */
const TITLE_WORDS = new Set([
  "psychologue", "psychologist", "psychotherapeute", "psychotherapist", "neuropsychologue", "neuropsychologist",
  "psychoeducateur", "psychoeducatrice", "psychoeducator", "ergotherapeute", "occupational", "therapist",
  "psychiatre", "psychiatrist", "sexologue", "sexologist", "conseiller", "conseillere", "orientation", "counsellor",
  "counselor", "travailleur", "travailleuse", "social", "sociale", "worker", "clinicien", "clinicienne", "clinical",
  "scolaire", "school", "autorise", "autorisee", "licensed", "sante", "mentale", "mental", "health",
  "en", "et", "de", "du", "la", "le", "and", "in", "of",
]);

/** A summary that only repeats titles (« Psychologue Psychologue scolaire »): shown as none. */
export function isTitlesOnly(text: string): boolean {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  return words.length > 0 && words.every((word) => TITLE_WORDS.has(word));
}

function keysOf<K extends string>(
  values: readonly unknown[] | null | undefined,
  toKey: (raw: string) => K | null,
  order: readonly K[],
): K[] {
  const found = new Set<K>();
  for (const raw of values ?? []) {
    const key = typeof raw === "string" ? toKey(raw) : null;
    if (key) found.add(key);
  }
  return order.filter((key) => found.has(key));
}

function yearsOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 70 ? value : null;
}

export interface FeaturedInput {
  locale: FeaturedLocale;
  users: readonly FeaturedUserSource[];
  profiles: readonly FeaturedProfileSource[];
  pages: readonly FeaturedPageSource[];
  showcaseOn: boolean;
  limit?: number;
}

export function buildFeaturedProfessionals(input: FeaturedInput): FeaturedProfessional[] {
  const { locale } = input;
  const profiles = new Map(input.profiles.map((profile) => [String(profile.userId), profile]));
  const pages = new Map(
    input.showcaseOn
      ? input.pages
          .filter((page) => page.published && isValidShowcaseSlug(page.slug))
          .map((page) => [String(page.userId), page] as const)
      : [],
  );

  const rows: { sortKey: string; entry: FeaturedProfessional }[] = [];
  for (const user of input.users) {
    const id = String(user._id);
    const profile = profiles.get(id);
    const page = pages.get(id);
    const content = page?.published ?? null;

    // The professional's own choice first; then nothing to show without a page or a completed profile.
    if (!profile || profile.profileVisible === false) continue;
    if (!content && profile.profileCompleted !== true) continue;

    const ownName = `${clean(user.firstName)} ${clean(user.lastName)}`.trim();
    const displayName = (clean(content?.displayName) || ownName).slice(0, NAME_MAX);
    if (!displayName) continue;

    const text = shortenSummary(
      (content && (pick(content.intro, locale) || pick(content.bio, locale) || pick(content.headline, locale))) ||
        clean(profile.bio),
    );
    rows.push({
      sortKey: `${clean(user.lastName)} ${clean(user.firstName)}`.trim() || displayName,
      entry: {
        id,
        displayName,
        title: showcaseTitleOf(profile.specialty),
        degree: degreeOf(profile),
        summary: isTitlesOnly(text) ? "" : text,
        photoUrl: content ? photoUrlOf(content.photoFileId) : null,
        pagePath: page ? `/${page.slug}` : null,
        languages: keysOf(profile.languages, showcaseLanguageKey, SHOWCASE_LANGUAGE_KEYS),
        // Only what a professional's page names too: where they receive, and whether remotely.
        modalities: keysOf(profile.modalities, showcaseModalityKey, SHOWCASE_MODALITY_KEYS).filter((key) =>
          SHOWCASE_SHOWN_MODALITIES.includes(key),
        ),
        yearsOfExperience: yearsOf(profile.yearsOfExperience),
      },
    });
  }

  const collator = new Intl.Collator(locale === "en" ? "en-CA" : "fr-CA", { sensitivity: "base" });
  return rows
    .sort(
      (a, b) =>
        Number(Boolean(b.entry.pagePath)) - Number(Boolean(a.entry.pagePath)) ||
        collator.compare(a.sortKey, b.sortKey) ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, input.limit ?? FEATURED_LIMIT)
    .map((row) => row.entry);
}

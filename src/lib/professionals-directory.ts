import { isValidShowcaseSlug } from "@/lib/showcase-slug";
import { showcaseTitleOf, type ShowcaseTitleKey } from "@/lib/showcase-title";
import {
  SHOWCASE_LANGUAGE_KEYS,
  SHOWCASE_MODALITY_KEYS,
  showcaseLanguageKey,
  showcaseModalityKey,
  type ShowcaseLanguageKey,
  type ShowcaseModalityKey,
} from "@/lib/showcase-public";

/**
 * « Nos professionnels » (www /professionnels): every active professional who has not hidden their
 * profile, with a short text and a « Lire plus » link to their page when they have a published one.
 * Pure: the documents are loaded in professionals-directory-queries.ts and leave only through here,
 * field by field.
 *
 *  - A professional who unticked « Profil visible aux clients » (Profile.profileVisible) is never listed.
 *  - The team can hide anyone and set the order (PlatformSettings.professionalsDirectory, Admin →
 *    « Nos professionnels (site) »). Placed professionals come first, in the team's order; everyone
 *    else follows by last name, so a new professional shows without the team doing anything.
 *  - With a published page (and the pages switched on): the page's name, portrait and text, reviewed
 *    by the team, and the link.
 *  - Without one: the profile's title and bio, no photo (a profile has none that may be public), no
 *    link. A profile never completed is left out, so no empty row shows.
 */

export type DirectoryLocale = "fr" | "en";

type LocalizedSource = { fr?: string | null; en?: string | null } | null | undefined;

export interface DirectoryUserSource {
  _id: unknown;
  firstName?: string | null;
  lastName?: string | null;
}

export interface DirectoryProfileSource {
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

export interface DirectoryPageSource {
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

/** The team's choices, as stored. Absent: nobody hidden, everyone by last name. */
export interface DirectoryCurationSource {
  order?: readonly unknown[] | null;
  hidden?: readonly unknown[] | null;
}

export interface DirectoryProfessional {
  id: string;
  displayName: string;
  title: { key: ShowcaseTitleKey | null; label: string | null };
  /** A short degree (« Ph.D. », « M.A. ») from the profile, shown before the title. */
  degree: string | null;
  summary: string;
  photoUrl: string | null;
  /** `/<slug>` when the professional has a published page. */
  showcasePath: string | null;
  /** From the profile, whichever words it uses, in a fixed order. */
  languages: ShowcaseLanguageKey[];
  modalities: ShowcaseModalityKey[];
  /** Whole years, 0 to 70, as the profile says. */
  yearsOfExperience: number | null;
}

/** Every key a listed professional carries; nothing else reaches the page. */
export const DIRECTORY_PROFESSIONAL_KEYS = [
  "degree",
  "displayName",
  "id",
  "languages",
  "modalities",
  "photoUrl",
  "showcasePath",
  "summary",
  "title",
  "yearsOfExperience",
] as const;

/** Why a professional is not on the public list. The professional's own choice wins over the team's. */
export type DirectoryExclusion = "hiddenByProfessional" | "hiddenByTeam" | "incomplete";

/** One row of the team's screen: every active professional, in the public order. */
export interface DirectoryAdminRow {
  id: string;
  displayName: string;
  title: { key: ShowcaseTitleKey | null; label: string | null };
  showcasePath: string | null;
  excludedBy: DirectoryExclusion | null;
  hiddenByTeam: boolean;
  /** In the team's order (otherwise placed after, by last name). */
  placed: boolean;
}

export const DIRECTORY_SUMMARY_MAX = 420;
/** More than the platform will have; bounds what one save may carry. */
export const DIRECTORY_CURATION_MAX_IDS = 2000;
const DEGREE_MAX = 16;
const NAME_MAX = 80;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function pick(text: LocalizedSource, locale: DirectoryLocale): string {
  const fr = clean(text?.fr);
  const en = clean(text?.en);
  return locale === "en" && en ? en : fr;
}

/** Cut at a word, with an ellipsis. */
export function shortenSummary(text: string, max = DIRECTORY_SUMMARY_MAX): string {
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
 * The degree shown before the title: an abbreviation only. Profiles hold free text (« Master »,
 * « Maîtrise en travail social »), which reads badly as « Master, Psychologue », so a word or a
 * sentence is not shown.
 */
export function degreeOf(profile: Pick<DirectoryProfileSource, "education">): string | null {
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

/** A summary that only repeats titles (« Psychothérapeute », « Psychologue Psychologue scolaire »): shown as none. */
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

interface DirectoryInput {
  locale: DirectoryLocale;
  users: readonly DirectoryUserSource[];
  profiles: readonly DirectoryProfileSource[];
  pages: readonly DirectoryPageSource[];
  showcaseOn: boolean;
  curation?: DirectoryCurationSource | null;
}

interface Candidate {
  entry: DirectoryProfessional;
  excludedBy: DirectoryExclusion | null;
  hiddenByTeam: boolean;
  position: number | null;
}

/** Every active professional with a name, in the public order, and why each one is or is not listed. */
function candidatesOf(input: DirectoryInput): Candidate[] {
  const { locale } = input;
  const profiles = new Map(input.profiles.map((profile) => [String(profile.userId), profile]));
  const pages = new Map(
    input.showcaseOn
      ? input.pages
          .filter((page) => page.published && isValidShowcaseSlug(page.slug))
          .map((page) => [String(page.userId), page] as const)
      : [],
  );
  const positions = new Map<string, number>();
  for (const id of input.curation?.order ?? []) {
    const key = String(id);
    if (!positions.has(key)) positions.set(key, positions.size);
  }
  const hidden = new Set((input.curation?.hidden ?? []).map(String));

  const rows: (Candidate & { sortKey: string })[] = [];
  for (const user of input.users) {
    const id = String(user._id);
    const profile = profiles.get(id);
    const page = pages.get(id);
    const content = page?.published ?? null;

    const ownName = `${clean(user.firstName)} ${clean(user.lastName)}`.trim();
    const displayName = (clean(content?.displayName) || ownName).slice(0, NAME_MAX);
    if (!displayName) continue;

    const hiddenByTeam = hidden.has(id);
    const excludedBy: DirectoryExclusion | null =
      profile?.profileVisible === false
        ? "hiddenByProfessional"
        : hiddenByTeam
          ? "hiddenByTeam"
          : !profile || (!content && profile.profileCompleted !== true)
            ? "incomplete"
            : null;

    const text = shortenSummary(
      (content && (pick(content.intro, locale) || pick(content.bio, locale) || pick(content.headline, locale))) ||
        clean(profile?.bio),
    );
    const summary = isTitlesOnly(text) ? "" : text;
    rows.push({
      sortKey: `${clean(user.lastName)} ${clean(user.firstName)}`.trim() || displayName,
      excludedBy,
      hiddenByTeam,
      position: positions.get(id) ?? null,
      entry: {
        id,
        displayName,
        title: showcaseTitleOf(profile?.specialty),
        degree: profile ? degreeOf(profile) : null,
        summary,
        photoUrl: content ? photoUrlOf(content.photoFileId) : null,
        showcasePath: page ? `/${page.slug}` : null,
        languages: keysOf(profile?.languages, showcaseLanguageKey, SHOWCASE_LANGUAGE_KEYS),
        modalities: keysOf(profile?.modalities, showcaseModalityKey, SHOWCASE_MODALITY_KEYS),
        yearsOfExperience: yearsOf(profile?.yearsOfExperience),
      },
    });
  }

  const collator = new Intl.Collator(locale === "en" ? "en-CA" : "fr-CA", { sensitivity: "base" });
  return rows.sort((a, b) => {
    if (a.position !== null || b.position !== null) {
      if (a.position === null) return 1;
      if (b.position === null) return -1;
      return a.position - b.position;
    }
    return collator.compare(a.sortKey, b.sortKey) || a.entry.id.localeCompare(b.entry.id);
  });
}

export function buildProfessionalsDirectory(input: DirectoryInput): DirectoryProfessional[] {
  return candidatesOf(input)
    .filter((candidate) => candidate.excludedBy === null)
    .map((candidate) => candidate.entry);
}

export function buildProfessionalsDirectoryAdminRows(input: DirectoryInput): DirectoryAdminRow[] {
  return candidatesOf(input).map(({ entry, excludedBy, hiddenByTeam, position }) => ({
    id: entry.id,
    displayName: entry.displayName,
    title: entry.title,
    showcasePath: entry.showcasePath,
    excludedBy,
    hiddenByTeam,
    placed: position !== null,
  }));
}

export interface DirectoryCurationInput {
  order: string[];
  hidden: string[];
  /** The `updatedAt` the screen loaded (null when the team never saved): a save over someone else's is refused. */
  expectedUpdatedAt: string | null;
}

function idListOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > DIRECTORY_CURATION_MAX_IDS) return null;
  if (!value.every((id) => typeof id === "string" && OBJECT_ID_RE.test(id))) return null;
  const ids = (value as string[]).map((id) => id.toLowerCase());
  return new Set(ids).size === ids.length ? ids : null;
}

/** What a save may carry: two lists of distinct ids and the version it was made on. Anything else is refused whole. */
export function parseDirectoryCuration(body: unknown): DirectoryCurationInput | null {
  if (!body || typeof body !== "object") return null;
  const { order, hidden, expectedUpdatedAt } = body as Record<string, unknown>;
  const orderIds = idListOf(order);
  const hiddenIds = idListOf(hidden);
  if (!orderIds || !hiddenIds) return null;
  if (expectedUpdatedAt !== null && (typeof expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(expectedUpdatedAt)))) {
    return null;
  }
  return { order: orderIds, hidden: hiddenIds, expectedUpdatedAt };
}

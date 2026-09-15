import { isValidShowcaseSlug } from "@/lib/showcase-slug";
import { showcaseTitleOf, type ShowcaseTitleKey } from "@/lib/showcase-title";

/**
 * « Nos professionnels » (www /professionnels): every active professional who has not hidden their
 * profile, with a short text and a « Lire plus » link to their page when they have a published one.
 * Pure: the documents are loaded in professionals-directory-queries.ts and leave only through here,
 * field by field.
 *
 *  - A professional who unticked « Profil visible aux clients » (Profile.profileVisible) is never listed.
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
}

/** Every key a listed professional carries; nothing else reaches the page. */
export const DIRECTORY_PROFESSIONAL_KEYS = [
  "degree",
  "displayName",
  "id",
  "photoUrl",
  "showcasePath",
  "summary",
  "title",
] as const;

export const DIRECTORY_SUMMARY_MAX = 420;
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

function degreeOf(profile: DirectoryProfileSource): string | null {
  const degree = clean(profile.education?.find((item) => clean(item?.degree))?.degree);
  return degree && degree.length <= DEGREE_MAX ? degree : null;
}

export function buildProfessionalsDirectory(input: {
  locale: DirectoryLocale;
  users: readonly DirectoryUserSource[];
  profiles: readonly DirectoryProfileSource[];
  pages: readonly DirectoryPageSource[];
  showcaseOn: boolean;
}): DirectoryProfessional[] {
  const { locale } = input;
  const profiles = new Map(input.profiles.map((profile) => [String(profile.userId), profile]));
  const pages = new Map(
    input.showcaseOn
      ? input.pages
          .filter((page) => page.published && isValidShowcaseSlug(page.slug))
          .map((page) => [String(page.userId), page] as const)
      : [],
  );

  const rows: { sortKey: string; entry: DirectoryProfessional }[] = [];
  for (const user of input.users) {
    const id = String(user._id);
    const profile = profiles.get(id);
    if (!profile || profile.profileVisible === false) continue;
    const page = pages.get(id);
    const content = page?.published ?? null;
    if (!content && profile.profileCompleted !== true) continue;

    const ownName = `${clean(user.firstName)} ${clean(user.lastName)}`.trim();
    const displayName = (clean(content?.displayName) || ownName).slice(0, NAME_MAX);
    if (!displayName) continue;

    const summary = shortenSummary(
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
        summary,
        photoUrl: content ? photoUrlOf(content.photoFileId) : null,
        showcasePath: page ? `/${page.slug}` : null,
      },
    });
  }

  const collator = new Intl.Collator(locale === "en" ? "en-CA" : "fr-CA", { sensitivity: "base" });
  return rows
    .sort((a, b) => collator.compare(a.sortKey, b.sortKey) || a.entry.id.localeCompare(b.entry.id))
    .map((row) => row.entry);
}

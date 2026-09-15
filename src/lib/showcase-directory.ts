import type { ShowcaseModalityKey } from "@/lib/showcase-public";

/**
 * The directory of a city page (spec 003, the « Ville » design): which listed
 * professionals a visitor's search and filters keep, what a card shows, and
 * how a free time reads on it. Pure and client-safe.
 */

export interface DirectoryFilters {
  query: string;
  inPerson: boolean;
  video: boolean;
  quick: boolean;
}

export const NO_DIRECTORY_FILTERS: DirectoryFilters = { query: "", inPerson: false, video: false, quick: false };

/** What the search and the filters look at. */
export interface DirectoryEntry {
  displayName: string;
  title: string | null;
  expertises: readonly string[];
  modalities: readonly ShowcaseModalityKey[];
  offersQuick: boolean;
}

/** A card, ready to render: every string already in the page's language. */
export interface DirectoryCardProps {
  href: string;
  /** On www a card leads to another host: a plain link, not a client navigation. */
  external: boolean;
  displayName: string;
  subtitle: string | null;
  cityLine: string | null;
  photoUrl: string | null;
  initials: string;
  expertises: string[];
  modes: { icon: "inPerson" | "video" | "phone"; label: string }[];
  nextSlotsTitle: string;
  nextSlots: string[];
  viewProfile: string;
}

export interface DirectoryItem {
  key: string;
  card: DirectoryCardProps;
  filter: DirectoryEntry;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Every word typed must appear in the name, the title or an expertise; each chip narrows further. */
export function matchesDirectoryFilters(entry: DirectoryEntry, filters: DirectoryFilters): boolean {
  if (filters.inPerson && !entry.modalities.includes("inPerson")) return false;
  if (filters.video && !entry.modalities.includes("video")) return false;
  if (filters.quick && !entry.offersQuick) return false;
  const words = fold(filters.query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold([entry.displayName, entry.title ?? "", ...entry.expertises].join(" "));
  return words.every((word) => haystack.includes(word));
}

/**
 * The free times a card shows, the first of each day: « Lun. 10 h »,
 * « Mar. 13 h 30 » in French, « Mon. 10:00 a.m. » in English. Days are
 * Montréal calendar days ("YYYY-MM-DD"), times Montréal wall clock ("HH:mm").
 */
export function nextSlotLabels(
  days: readonly { day: string; slots: readonly string[] }[],
  locale: "fr" | "en",
  count = 2,
): string[] {
  const tag = locale === "en" ? "en-CA" : "fr-CA";
  const weekday = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  const clock = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const labels: string[] = [];
  for (const { day, slots } of days) {
    if (labels.length >= count) break;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    const first = slots.find((time) => /^\d{2}:\d{2}$/.test(time));
    if (!match || !first) continue;
    const name = weekday.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
    const dayLabel = name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
    const hours = Number(first.slice(0, 2));
    const minutes = Number(first.slice(3, 5));
    const time =
      locale === "en"
        ? clock.format(new Date(Date.UTC(2000, 0, 1, hours, minutes)))
        : minutes === 0
          ? `${hours} h`
          : `${hours} h ${String(minutes).padStart(2, "0")}`;
    labels.push(`${dayLabel} ${time}`);
  }
  return labels;
}

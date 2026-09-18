import type { ShowcasePrice } from "@/lib/showcase-public";
import { SHOWCASE_SLOTS_ANCHOR } from "@/lib/showcase-booking-types";

/**
 * The rules of a professional's page layout (the « vitrine » design, spec 003):
 * which sections appear, in which order, and the small choices the page makes
 * from the public data. Pure and client-safe.
 */

/**
 * A price as the page shows it: whole dollars without decimals (« 120 $ »), otherwise always two
 * (« 24,50 $ », never « 24,5 $ »).
 */
export function formatShowcasePrice(amount: number, localeTag: string): string {
  const whole = Number.isInteger(Math.round(amount * 100) / 100);
  return new Intl.NumberFormat(localeTag, {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Section anchors, also the targets of the header's links. */
export const VITRINE_ANCHORS = {
  top: "haut",
  about: "a-propos",
  brief: "en-bref",
  credentials: "parcours",
  availability: SHOWCASE_SLOTS_ANCHOR,
  approach: "approche",
  focus: "accompagnement",
  products: "formations",
  articles: "articles",
} as const;

export type VitrineSection = "about" | "brief" | "credentials" | "availability" | "approach" | "focus" | "products" | "articles";

/** Days shown at a time in the booking panel. */
export const VITRINE_DAYS_PER_VIEW = 5;

/**
 * The sections a page shows, in order. The approach section always appears:
 * it carries how a request unfolds even when the professional wrote nothing
 * about their approach. Free times only when a consultation is open and the
 * page is not a preview.
 */
export function vitrineSections(input: {
  hasAbout: boolean;
  /** « En bref »: the chips under the presentation. */
  hasBrief?: boolean;
  /** « Parcours »: the professional's diplomas and roles. */
  hasCredentials?: boolean;
  /** « Ce que j'accompagne »: the professional's own cards. */
  hasFocusAreas?: boolean;
  hasProducts: boolean;
  /** The professional's live articles. */
  hasArticles?: boolean;
  /** « Disponibilités »: real hours the professional published, with a free time in the horizon (phase 3b). */
  hasAvailability?: boolean;
  /** The sections the page draws, in the professional's order: the links follow it and skip what is not drawn. */
  order?: readonly string[];
}): VitrineSection[] {
  const sections: VitrineSection[] = [
    ...(input.hasAbout ? (["about"] as const) : []),
    ...(input.hasBrief ? (["brief"] as const) : []),
    ...(input.hasCredentials ? (["credentials"] as const) : []),
    "approach",
    ...(input.hasFocusAreas ? (["focus"] as const) : []),
    ...(input.hasProducts ? (["products"] as const) : []),
    ...(input.hasArticles ? (["articles"] as const) : []),
  ];
  const order = input.order;
  const ordered = order ? inOrder(sections, order) : sections;
  if (!input.hasAvailability) return ordered;
  // « Disponibilités » is not a section a professional orders or hides: it exists only while they
  // publish real hours, and it follows « À propos » (with « En bref » and « Parcours ») wherever
  // they put it, or opens the page when there is none (owner, 2026-09-18).
  const ABOUT = new Set<VitrineSection>(["about", "brief", "credentials"]);
  let at = 0;
  ordered.forEach((section, index) => {
    if (ABOUT.has(section)) at = index + 1;
  });
  return [...ordered.slice(0, at), "availability", ...ordered.slice(at)];
}

function inOrder(sections: VitrineSection[], order: readonly string[]): VitrineSection[] {
  // Some headings are blocks inside a section rather than sections of their own: « En bref » and
  // « Parcours » sit in « À propos », « Ce que j’accompagne » comes from « expertises ». Each follows
  // the place the professional gave the section it belongs to.
  const INSIDE: Partial<Record<VitrineSection, string>> = { brief: "about", credentials: "about", focus: "expertises" };
  const keyOf = (section: VitrineSection) => INSIDE[section] ?? section;
  return sections
    .filter((section) => order.includes(keyOf(section)))
    .sort((a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b)));
}

/** The price a standard consultation is shown at: the individual session's, else the lowest. */
export function headlinePrice(prices: readonly ShowcasePrice[]): number | null {
  if (prices.length === 0) return null;
  const solo = prices.find((price) => price.therapyType === "solo");
  return solo ? solo.price : Math.min(...prices.map((price) => price.price));
}

/** Up to two initials, for a page without a photo. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** The days on screen, from the first shown. */
export function daysInView<T>(days: readonly T[], start: number, size = VITRINE_DAYS_PER_VIEW): T[] {
  return days.slice(Math.max(0, start), Math.max(0, start) + size);
}

export type SlotPeriod = "morning" | "afternoon" | "evening";

/** When a free time falls in the day (Montréal wall-clock "HH:MM"): before noon, before 17 h, or later. */
export function slotPeriod(time: string): SlotPeriod {
  const hour = Number.parseInt(time.slice(0, 2), 10);
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/** A day's free times grouped by period, in the day's order, leaving out empty periods. */
export function groupSlotsByPeriod(times: readonly string[]): { period: SlotPeriod; times: string[] }[] {
  const order: SlotPeriod[] = ["morning", "afternoon", "evening"];
  return order
    .map((period) => ({ period, times: times.filter((time) => slotPeriod(time) === period) }))
    .filter((group) => group.times.length > 0);
}

/** Whether "next days" can move: more days already loaded, or more to fetch. */
export function canShowNextDays(start: number, loaded: number, hasMore: boolean, size = VITRINE_DAYS_PER_VIEW): boolean {
  return start + size < loaded || hasMore;
}

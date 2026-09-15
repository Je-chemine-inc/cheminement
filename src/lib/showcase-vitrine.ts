import { SHOWCASE_SLOTS_ANCHOR } from "@/lib/showcase-booking-types";
import type { ShowcasePrice } from "@/lib/showcase-public";
import { SHOWCASE_WAITLIST_ANCHOR } from "@/lib/waitlist-rules";

/**
 * The rules of a professional's page layout (the « vitrine » design, spec 003):
 * which sections appear, in which order, and the small choices the page makes
 * from the public data. Pure and client-safe.
 */

/** Section anchors, also the targets of the header's links. */
export const VITRINE_ANCHORS = {
  top: "haut",
  about: "a-propos",
  approach: "approche",
  services: "tarifs",
  slots: SHOWCASE_SLOTS_ANCHOR,
  waitlist: SHOWCASE_WAITLIST_ANCHOR,
  products: "formations",
} as const;

export type VitrineSection = "about" | "approach" | "services" | "slots" | "products";

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
  showSlots: boolean;
  hasProducts: boolean;
}): VitrineSection[] {
  return [
    ...(input.hasAbout ? (["about"] as const) : []),
    "approach",
    "services",
    ...(input.showSlots ? (["slots"] as const) : []),
    ...(input.hasProducts ? (["products"] as const) : []),
  ];
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

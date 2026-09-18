import type { ShowcaseBookingOption } from "@/lib/showcase-booking-types";

/**
 * « Disponibilités sur ma page » (spec 003 phase 3b), as the card that switches it on tells it:
 * where the section stands and what it will show. Pure and client-safe — the editor view carries
 * the facts, these name them.
 */

/**
 * Where a page's « Disponibilités » stands, the first that applies:
 * - `off`: not switched on — the page's button goes to the general list, as on every page;
 * - `pageHidden`: switched on, but the page itself is not online;
 * - `needsHours`: switched on, but the professional has not saved their hours from their own
 *   account, and only such hours make times appear;
 * - `noFreeTime`: on, with hours, but nothing free in the six weeks ahead — the section waits;
 * - `live`: the page shows times now.
 */
export type ShowcaseAvailabilityState = "off" | "pageHidden" | "needsHours" | "noFreeTime" | "live";

export function showcaseAvailabilityState(input: {
  services: { standard: boolean; quick: boolean };
  pageLive: boolean;
  hoursConfirmed: boolean;
  options: readonly ShowcaseBookingOption[];
}): ShowcaseAvailabilityState {
  if (!input.services.standard && !input.services.quick) return "off";
  if (!input.pageLive) return "pageHidden";
  if (!input.hoursConfirmed) return "needsHours";
  return input.options.length > 0 ? "live" : "noFreeTime";
}

/** The earliest free time among the consultations a page shows, or null when it shows none. */
export function firstFreeTime(options: readonly ShowcaseBookingOption[]): { day: string; time: string } | null {
  let first: { day: string; time: string } | null = null;
  for (const option of options) {
    const at = option.first;
    if (!first || at.day < first.day || (at.day === first.day && at.time < first.time)) first = at;
  }
  return first;
}

export const SHOWCASE_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type ShowcaseWeekday = (typeof SHOWCASE_WEEK)[number];

/** A day the professional works, as their weekly schedule says: Montréal wall-clock "HH:mm". */
export interface ShowcaseWorkDay {
  day: ShowcaseWeekday;
  start: string;
  end: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The working days of a weekly schedule, Monday first, for the card's one-line summary. A day off,
 * a day named twice (the first counts) and a day whose hours don't make a span are left out.
 */
export function showcaseWorkDays(
  days: readonly ({ day?: string | null; isWorkDay?: boolean | null; startTime?: string | null; endTime?: string | null } | null)[] | null | undefined,
): ShowcaseWorkDay[] {
  const found = new Map<ShowcaseWeekday, ShowcaseWorkDay | null>();
  for (const entry of days ?? []) {
    const day = SHOWCASE_WEEK.find((name) => name === entry?.day);
    if (!day || found.has(day)) continue;
    const start = entry?.startTime ?? "";
    const end = entry?.endTime ?? "";
    found.set(day, entry?.isWorkDay === true && TIME.test(start) && TIME.test(end) && start < end ? { day, start, end } : null);
  }
  return SHOWCASE_WEEK.flatMap((day) => {
    const work = found.get(day);
    return work ? [work] : [];
  });
}

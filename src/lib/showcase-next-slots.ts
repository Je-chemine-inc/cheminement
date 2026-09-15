import "server-only";
import { listShowcaseSlots, loadBookableShowcase } from "@/lib/showcase-booking";
import type { ShowcaseSlotDay } from "@/lib/showcase-booking-types";

/**
 * The first free days of each professional listed on a city or expertise page
 * (spec 003): the standard consultation's, else the quick one's — the same
 * times their own page offers. A professional without an open consultation,
 * or whose times cannot be read, simply shows none: a listing never fails
 * because of one calendar. At most `limit` professionals are read.
 */
export async function loadNextShowcaseSlots(
  slugs: readonly string[],
  limit = 24,
): Promise<Record<string, ShowcaseSlotDay[]>> {
  const entries = await Promise.all(
    slugs.slice(0, limit).map(async (slug): Promise<[string, ShowcaseSlotDay[]]> => {
      try {
        const bookable = await loadBookableShowcase(slug);
        if (!bookable) return [slug, []];
        for (const service of ["standard", "quick"] as const) {
          if (!bookable.services[service].offered) continue;
          const response = await listShowcaseSlots(bookable, service, null);
          if (response.available && response.days.length > 0) return [slug, response.days.slice(0, 3)];
        }
        return [slug, []];
      } catch (error) {
        console.error("[showcase] next free times could not be read:", error);
        return [slug, []];
      }
    }),
  );
  return Object.fromEntries(entries);
}

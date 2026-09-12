import "server-only";
import connectToDatabase from "@/lib/mongodb";
import ShowcaseDailyStat, { type ShowcaseStatScope } from "@/models/ShowcaseDailyStat";

/**
 * Light statistics of the showcase pages (spec 003): views and clicks on
 * « Demander un rendez-vous », per day, per page or city. Anonymous counts
 * only — no cookie, no IP address, no visitor identifier is stored.
 */

export type ShowcaseStatEvent = "view" | "cta";

/** The window the dashboards show. */
export const SHOWCASE_STATS_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day in Montréal, "YYYY-MM-DD". */
export function showcaseStatDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function recordShowcaseEvent(input: {
  scope: ShowcaseStatScope;
  key: string;
  event: ShowcaseStatEvent;
  now?: Date;
}): Promise<void> {
  await connectToDatabase();
  const field = input.event === "view" ? "views" : "ctaClicks";
  // The filter is exactly the unique index, so MongoDB retries a concurrent
  // first insert of the day instead of failing it.
  await ShowcaseDailyStat.updateOne(
    { scope: input.scope, key: input.key, day: showcaseStatDay(input.now) },
    { $inc: { [field]: 1 } },
    { upsert: true },
  );
}

export interface ShowcaseStatTotals {
  views: number;
  ctaClicks: number;
}

/** Totals over the last `days` days, today included, per key. */
export async function loadShowcaseStats(
  scope: ShowcaseStatScope,
  keys: readonly string[],
  days: number = SHOWCASE_STATS_DAYS,
  now: Date = new Date(),
): Promise<Map<string, ShowcaseStatTotals>> {
  const totals = new Map<string, ShowcaseStatTotals>();
  if (keys.length === 0) return totals;
  await connectToDatabase();
  const since = showcaseStatDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  const rows = await ShowcaseDailyStat.find({ scope, key: { $in: [...keys] }, day: { $gte: since } })
    .select("key views ctaClicks")
    .lean();
  for (const row of rows) {
    const current = totals.get(row.key) ?? { views: 0, ctaClicks: 0 };
    current.views += row.views ?? 0;
    current.ctaClicks += row.ctaClicks ?? 0;
    totals.set(row.key, current);
  }
  return totals;
}

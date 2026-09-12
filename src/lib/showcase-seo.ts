import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";

/**
 * robots.txt and sitemap.xml for a city host. Next's own robots.ts and
 * sitemap.ts only serve the root of one host, so each city answers through a
 * route handler (src/app/showcase/[cityKey]/{robots-txt,sitemap-xml}) built on
 * these. Pure.
 */

export interface SitemapEntry {
  /** Absolute URL, on the host whose sitemap lists it. */
  url: string;
  lastModified?: Date | string | null;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const parts = [`    <loc>${escapeXml(entry.url)}</loc>`];
    const lastmod = isoDate(entry.lastModified);
    if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
    if (entry.changeFrequency) parts.push(`    <changefreq>${entry.changeFrequency}</changefreq>`);
    if (typeof entry.priority === "number") {
      parts.push(`    <priority>${Math.min(1, Math.max(0, entry.priority)).toFixed(1)}</priority>`);
    }
    return ["  <url>", ...parts, "  </url>"].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * While the module is off the whole host is closed to crawlers, so nothing is
 * indexed before the owner turns it on; the pages themselves redirect to www.
 */
export function buildCityRobotsTxt(cityKey: string, enabled: boolean): string {
  if (!enabled) return ["User-agent: *", "Disallow: /", ""].join("\n");
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /showcase/",
    "",
    `Sitemap: ${absoluteShowcaseUrl(cityKey, "/sitemap.xml")}`,
    "",
  ].join("\n");
}

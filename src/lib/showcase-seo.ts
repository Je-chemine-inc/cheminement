import { PROFESSIONAL_TITLES } from "@/data/professionalTitles";
import {
  SHOWCASE_CITIES,
  SHOWCASE_REGIONS,
  type ShowcaseCity,
  type ShowcaseRegion,
} from "@/lib/showcase-cities";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";

/**
 * The search side of the showcase pages (spec 003): robots.txt and sitemap.xml
 * per city host, which pages deserve to be indexed, headings built from who is
 * actually presented, and structured data. Pure: pages and route handlers load
 * the data and call these.
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

// ---------------------------------------------------------------- directory

/** One published page of an active professional, as the search pages need it. */
export interface DirectoryEntry {
  cityKey: string;
  slug: string;
  /** Catalog expertise ids on the approved copy. */
  expertiseIds: readonly string[];
  lastModified: Date | null;
}

/** An expertise offered on pages, with its URL segment. */
export interface CatalogExpertise {
  id: string;
  slug: string;
  labelFr: string;
  labelEn: string | null;
}

export interface CityCount {
  city: ShowcaseCity;
  count: number;
}

export interface RegionSummary {
  region: ShowcaseRegion;
  total: number;
  /** Cities of the region with at least one professional, most first. */
  cities: CityCount[];
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}

const byCountThenName = (a: CityCount, b: CityCount) =>
  b.count - a.count || a.city.name.localeCompare(b.city.name, "fr");

export function countByCity(entries: readonly DirectoryEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.cityKey, (counts.get(entry.cityKey) ?? 0) + 1);
  return counts;
}

/** Every region, in the official order, with the cities where professionals are presented. */
export function summarizeRegions(counts: ReadonlyMap<string, number>): RegionSummary[] {
  return SHOWCASE_REGIONS.map((region) => {
    const cities = region.cities
      .map((city) => ({ city, count: counts.get(city.key) ?? 0 }))
      .filter((entry) => entry.count > 0)
      .sort(byCountThenName);
    return { region, total: cities.reduce((sum, entry) => sum + entry.count, 0), cities };
  });
}

/** The other cities of a city's region where professionals are presented. */
export function nearbyCities(city: ShowcaseCity, counts: ReadonlyMap<string, number>): CityCount[] {
  return SHOWCASE_CITIES.filter((other) => other.region === city.region && other.key !== city.key)
    .map((other) => ({ city: other, count: counts.get(other.key) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort(byCountThenName);
}

export interface ExpertiseInCity {
  expertise: CatalogExpertise;
  count: number;
  lastModified: Date | null;
}

/** The expertises professionals of a city carry, by label. */
export function expertisesInCity(
  entries: readonly DirectoryEntry[],
  catalog: readonly CatalogExpertise[],
  cityKey: string,
): ExpertiseInCity[] {
  const byId = new Map(catalog.map((expertise) => [expertise.id, expertise]));
  const found = new Map<string, ExpertiseInCity>();
  for (const entry of entries) {
    if (entry.cityKey !== cityKey) continue;
    for (const id of new Set(entry.expertiseIds)) {
      const expertise = byId.get(id);
      if (!expertise) continue;
      const current = found.get(id) ?? { expertise, count: 0, lastModified: null };
      current.count += 1;
      current.lastModified = laterOf(current.lastModified, entry.lastModified);
      found.set(id, current);
    }
  }
  return [...found.values()].sort((a, b) => a.expertise.labelFr.localeCompare(b.expertise.labelFr, "fr"));
}

// -------------------------------------------------------------- page rules

export type CityPageDecision = "index" | "noindex" | "redirect-region";

/**
 * A city page is worth indexing only with a professional presented there. A
 * city without one is still served while its region has some (visitors from
 * a link get the nearby cities), but kept out of search results; with nobody
 * in the whole region, the visitor goes to the region's page on www.
 */
export function decideCityPage(inCity: number, elsewhereInRegion: number): CityPageDecision {
  if (inCity > 0) return "index";
  return elsewhereInRegion > 0 ? "noindex" : "redirect-region";
}

export const MAX_HEADING_TITLES = 3;

export type HeadingTitleKey = Exclude<(typeof PROFESSIONAL_TITLES)[number]["value"], "otherProfessionals">;

/**
 * The professional titles a heading may name (« Psychologues et
 * psychothérapeutes à Mascouche »): those of everyone presented, in the usual
 * order. Null — use the generic heading — when someone has no recognised
 * title, when there are too many titles, or nobody.
 */
export function headingTitleKeys(titles: readonly { key: string | null }[]): HeadingTitleKey[] | null {
  if (titles.length === 0) return null;
  const keys = new Set<string>();
  for (const title of titles) {
    if (!title.key || title.key === "otherProfessionals") return null;
    keys.add(title.key);
  }
  const ordered = PROFESSIONAL_TITLES.map((title) => title.value).filter((value) =>
    keys.has(value),
  ) as HeadingTitleKey[];
  return ordered.length > 0 && ordered.length <= MAX_HEADING_TITLES ? ordered : null;
}

/** « psychologues, psychothérapeutes et psychiatres », as each language joins a list. */
export function titlesPhrase(
  keys: readonly HeadingTitleKey[],
  pluralLabel: (key: HeadingTitleKey) => string,
  locale: "fr" | "en",
): string {
  return new Intl.ListFormat(locale === "en" ? "en-CA" : "fr-CA", { type: "conjunction" }).format(
    keys.map(pluralLabel),
  );
}

export function capitalizeFirst(text: string, locale: "fr" | "en"): string {
  return text.charAt(0).toLocaleUpperCase(locale === "en" ? "en-CA" : "fr-CA") + text.slice(1);
}

// ----------------------------------------------------------------- sitemaps

/**
 * A city host's sitemap: the city page, each professional's page and each
 * expertise page with a professional — nothing at all for a city where nobody
 * is presented (its page is not indexed).
 */
export function citySitemapEntries(
  cityKey: string,
  entries: readonly DirectoryEntry[],
  catalog: readonly CatalogExpertise[],
): SitemapEntry[] {
  const inCity = entries
    .filter((entry) => entry.cityKey === cityKey)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (inCity.length === 0) return [];
  const latest = inCity.reduce<Date | null>((max, entry) => laterOf(max, entry.lastModified), null);
  return [
    { url: absoluteShowcaseUrl(cityKey, "/"), lastModified: latest, changeFrequency: "weekly", priority: 1 },
    ...inCity.map((entry) => ({
      url: absoluteShowcaseUrl(cityKey, `/${entry.slug}`),
      lastModified: entry.lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...expertisesInCity(entries, catalog, cityKey).map((found) => ({
      url: absoluteShowcaseUrl(cityKey, `/specialite/${found.expertise.slug}`),
      lastModified: found.lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}

/** www paths of the directory: /psy and each region with a professional (nothing when none). */
export function hubSitemapPaths(summaries: readonly RegionSummary[]): string[] {
  const live = summaries.filter((summary) => summary.total > 0);
  return live.length === 0 ? [] : ["/psy", ...live.map((summary) => `/psy/${summary.region.key}`)];
}

// ---------------------------------------------------------- structured data

export function faqJsonLd(items: readonly { question: string; answer: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; url: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function itemListJsonLd(
  name: string,
  items: readonly { name: string; url: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

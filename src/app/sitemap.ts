import type { MetadataRoute } from "next";
import { listPublishedContent } from "@/lib/content-entry";
import { CONTENT_KINDS, CONTENT_KIND_PUBLIC_BASE } from "@/lib/content-kind";
import { SITE_URL } from "@/lib/site-url";

/**
 * Served at /sitemap.xml.
 *
 * This is not a nicety here, it is how the content gets discovered at all. The
 * listings on /book are fetched by the browser after the page loads, so the
 * server HTML contains no links to the detail pages — a crawler following
 * links alone would never reach them. The sitemap is the only reliable path.
 *
 * Regenerated per request rather than frozen at build time, so a resource
 * published this afternoon is listed without waiting for a deploy.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Pages worth surfacing in search. Private and transactional routes are excluded. */
const STATIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/book", priority: 0.9, changeFrequency: "weekly" },
  { path: "/approaches", priority: 0.8, changeFrequency: "monthly" },
  { path: "/services", priority: 0.8, changeFrequency: "monthly" },
  { path: "/why-us", priority: 0.7, changeFrequency: "monthly" },
  { path: "/who-we-are", priority: 0.7, changeFrequency: "monthly" },
  { path: "/nouveautes", priority: 0.7, changeFrequency: "weekly" },
  { path: "/medias", priority: 0.6, changeFrequency: "weekly" },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" },
  { path: "/professional", priority: 0.6, changeFrequency: "monthly" },
  { path: "/school-manager", priority: 0.5, changeFrequency: "monthly" },
  { path: "/emergency", priority: 0.5, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/cookies", priority: 0.2, changeFrequency: "yearly" },
  { path: "/professional-terms", priority: 0.2, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // French is the canonical locale (no URL prefix, and the cookie defaults to
  // fr), so one entry per logical page rather than one per locale row.
  for (const kind of CONTENT_KINDS) {
    const base = CONTENT_KIND_PUBLIC_BASE[kind];
    if (!base) continue;
    try {
      const items = await listPublishedContent(kind, "fr");
      for (const item of items) {
        entries.push({
          url: `${SITE_URL}${base}/${item.slug}`,
          lastModified: item.updatedAt ? new Date(item.updatedAt) : now,
          changeFrequency: "monthly",
          priority: kind === "resource" ? 0.8 : 0.7,
        });
      }
    } catch (error) {
      // One unreadable kind must not produce an empty sitemap for all of them.
      console.error(`[sitemap] failed to list ${kind}:`, error);
    }
  }

  // Spec 003: a professional's page (www.jechemine.ca/<slug>) is reachable by its link but is not
  // listed here while the pages are being reviewed with the professionals — it would put a page under
  // review in front of searchers. Restore this together with the `index: false` in
  // src/app/[proSlug]/page.tsx.

  return entries;
}

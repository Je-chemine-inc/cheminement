import { SITE_URL } from "@/lib/site-url";

/**
 * How the site names itself.
 *
 * Google shows a site's name above its results and takes it from, in order of preference: `WebSite`
 * structured data on the home page, then `og:site_name`, then the home page's `<title>`. With none
 * of them it falls back to the domain — which is why the results read « jechemine.ca » rather than
 * « Je chemine » (seen 2026-09-17).
 *
 * The site had `og:site_name` in the root layout, but **Next replaces a nested metadata object
 * rather than merging it**: a route that writes its own `openGraph` drops the layout's entirely. Ten
 * pages did, the home page among them — so the one page Google reads the site name from was the one
 * page that did not declare it. Spread `SITE_OPEN_GRAPH` first, then the page's own title and
 * description, and that cannot happen again.
 *
 * `SITE_OPEN_GRAPH` deliberately carries no `url`: that is the page's own address, never the site's.
 */
export const SITE_NAME = "Je chemine";

export const SITE_OPEN_GRAPH = {
  type: "website" as const,
  siteName: SITE_NAME,
  locale: "fr_CA",
};

/**
 * The site as an entity, for the **home page only** — Google reads `WebSite` nowhere else, and one
 * on an inner page is ignored at best. `name` is what appears above the address in the results, and
 * `url` must be the root of the domain.
 *
 * This is the site's brand, which is not the same thing as the legal entity in the `Organization`
 * data (that one follows the company name an admin sets, and may carry « inc. » or a longer form).
 */
export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${SITE_URL}/`,
  };
}

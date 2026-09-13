/**
 * The public addresses of the site, in one place.
 *
 * Four files used to carry their own copy of "https://www.jechemine.ca" (the
 * root layout, sitemap.ts, robots.ts and the Organization JSON-LD). The city
 * pages of the showcase module live on their own hosts
 * (psy<city>.jechemine.ca), so which host is canonical now matters in more
 * than one place — one constant keeps them from drifting.
 *
 * Pure constants: safe to import from the middleware (edge runtime).
 */

/** The registered domain. Every host the platform answers on ends with it. */
export const APEX_HOST = "jechemine.ca";

/** The canonical host: auth, dashboards, the booking funnel, the hubs. */
export const CANONICAL_HOST = "www.jechemine.ca";

/** The canonical origin, for absolute URLs (metadata, sitemaps, emails). */
export const SITE_URL = `https://${CANONICAL_HOST}`;

/**
 * The address of a professional's page (spec 003): www.jechemine.ca/<slug>,
 * beside the site's own routes. Pure and dependency-free: the middleware reads
 * it on every request.
 */

/**
 * Names a slug never takes. Every top-level route and public folder of the
 * site is here, so no professional's address can hide a page of the site —
 * showcase-slug.spec.ts reads src/app and public/ and fails when one is
 * missing — plus the names of metadata files and names kept for later pages.
 */
export const RESERVED_SHOWCASE_SLUGS: ReadonlySet<string> = new Set([
  // Routes (src/app, route groups included)
  "actions",
  "admin",
  "api",
  "appointment",
  "approaches",
  "book",
  "client",
  "contact",
  "cookies",
  "demande-directe",
  "emergency",
  "explore",
  "forgot-password",
  "la",
  "liste-attente",
  "login",
  "medias",
  "nouveautes",
  "org-pay",
  "pay",
  "privacy",
  "professional",
  "professional-terms",
  "professionnels",
  "reset-password",
  "school-manager",
  "services",
  "signup",
  "terms",
  "verify-account",
  "who-we-are",
  "why-us",
  // Public folders
  "showcase",
  "uploads",
  // Metadata files
  "robots",
  "sitemap",
  "favicon",
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
  "manifest",
  // Kept: retired pages (city hosts, /psy directory) and pages to come
  "psy",
  "specialite",
  "specialites",
  "robots-txt",
  "sitemap-xml",
  "rendez-vous",
  "formations",
  "produits",
  "faq",
  "aide",
  "help",
  "a-propos",
  "about",
  "blog",
  "ville",
  "villes",
  "professionals",
  "compte",
  "account",
  "dashboard",
  "settings",
  "images",
  "static",
  "public",
  "not-found",
  "error",
  "www",
  "jechemine",
]);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidShowcaseSlug(slug: string): boolean {
  return (
    slug.length >= 2 &&
    slug.length <= 60 &&
    SLUG_RE.test(slug) &&
    !RESERVED_SHOWCASE_SLUGS.has(slug)
  );
}

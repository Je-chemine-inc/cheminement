import type { MetadataRoute } from "next";

const SITE_URL = "https://www.jechemine.ca";

/**
 * Served at /robots.txt.
 *
 * The private areas are already behind authentication, so this is not a
 * security control — it stops crawlers wasting budget on pages that will only
 * redirect them to a login screen, and keeps sign-in and payment URLs out of
 * search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/client/",
          "/professional/",
          // Personal payment and access links. They carry a token in the query
          // string and are only ever sent by email.
          "/pay",
          "/verify-account",
          "/reset-password",
          "/login",
          "/signup",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

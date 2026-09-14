import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";

/**
 * The typefaces of a professional's page (the « vitrine » design, spec 003),
 * self-hosted by Next at build time: no request leaves for Google, and the
 * CSP's font-src 'self' holds. Exposed as CSS variables on the page's root only,
 * so the rest of the site keeps its own type.
 *
 * Fraunces is variable: the page turns its SOFT axis all the way up (rounded
 * terminals) in ShowcaseProfileView's stylesheet.
 */
export const vitrineSerif = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
  style: ["normal", "italic"],
  variable: "--font-vitrine-serif",
  display: "swap",
});

export const vitrineSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-vitrine-sans",
  display: "swap",
});

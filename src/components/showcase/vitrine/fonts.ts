import { Figtree, Newsreader } from "next/font/google";

/**
 * The typefaces of a professional's page (the « vitrine » design, spec 003),
 * self-hosted by Next at build time: no request leaves for Google, and the
 * CSP's font-src 'self' holds. Exposed as CSS variables on the page's root only,
 * so the rest of the site keeps its own type.
 */
export const vitrineSerif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-vitrine-serif",
  display: "swap",
});

export const vitrineSans = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-vitrine-sans",
  display: "swap",
});

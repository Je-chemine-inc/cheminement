import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SITE_NAME, SITE_OPEN_GRAPH, websiteJsonLd } from "@/lib/site-metadata";
import { SITE_URL } from "@/lib/site-url";

/**
 * Google showed the site as « jechemine.ca » because nothing said otherwise: the home page wrote its
 * own `openGraph`, which in Next replaces the layout's rather than merging with it, so the one page
 * the site name is read from was the one page with no `og:site_name` — and there was no `WebSite`
 * structured data anywhere. These pin the two halves of the fix.
 */
describe("SITE_OPEN_GRAPH", () => {
  it("carries what every page shares, so spreading it is enough", () => {
    expect(SITE_OPEN_GRAPH.siteName).toBe(SITE_NAME);
    expect(SITE_OPEN_GRAPH.type).toBe("website");
    expect(SITE_OPEN_GRAPH.locale).toBe("fr_CA");
  });

  it("carries no url: that belongs to the page, not to the site", () => {
    // A page spreading this must not end up claiming the home page's address as its own.
    expect(Object.keys(SITE_OPEN_GRAPH)).not.toContain("url");
  });
});

describe("websiteJsonLd", () => {
  it("names the site, at the root of the domain", () => {
    expect(websiteJsonLd()).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Je chemine",
      url: `${SITE_URL}/`,
    });
  });

  it("is the domain root, never a page inside it", () => {
    const url = String(websiteJsonLd().url);
    expect(url).toBe(`${SITE_URL}/`);
    expect(new URL(url).pathname).toBe("/");
  });
});

/**
 * Google once built the home page's result snippet out of the navigation bar (« Je chemine.
 * Accueil À propos. Services… »): for a search on the brand it prefers text containing the words
 * searched, and the logo's alt text at the top of the header was the only place the name appeared.
 */
describe("what Google may quote from a page", () => {
  const read = (file: string) => readFileSync(join(__dirname, "..", "..", file), "utf8");

  it("never quotes the header or the footer", () => {
    // Honoured on div, span and section only — so on the element inside <header>/<footer>.
    expect(read("src/components/layout/Header.tsx")).toMatch(/<header[^>]*>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<div[^>]*data-nosnippet/);
    expect(read("src/components/layout/Footer.tsx")).toMatch(/<footer[^>]*>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<div[^>]*data-nosnippet/);
  });

  it("names the site in the home page's description, in both languages", () => {
    for (const file of ["messages/fr.json", "messages/en.json"]) {
      const description = JSON.parse(read(file)).Seo.home.description as string;
      expect(description.startsWith(SITE_NAME), `${file}: Seo.home.description`).toBe(true);
      expect(description.length, `${file}: Seo.home.description`).toBeLessThanOrEqual(160);
    }
  });
});

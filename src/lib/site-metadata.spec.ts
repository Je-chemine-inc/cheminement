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

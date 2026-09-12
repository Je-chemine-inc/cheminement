import { describe, it, expect } from "vitest";
import { buildCityRobotsTxt, buildSitemapXml } from "@/lib/showcase-seo";

describe("buildCityRobotsTxt", () => {
  it("closes the whole host while the module is off", () => {
    expect(buildCityRobotsTxt("mascouche", false)).toBe("User-agent: *\nDisallow: /\n");
  });

  it("opens the pages, not the APIs or the internal path, and names its own sitemap", () => {
    const txt = buildCityRobotsTxt("mascouche", true);
    expect(txt).toContain("Allow: /\n");
    expect(txt).toContain("Disallow: /api/\n");
    expect(txt).toContain("Disallow: /showcase/\n");
    expect(txt).toContain("Sitemap: https://psymascouche.jechemine.ca/sitemap.xml");
    expect(txt).not.toContain("www.jechemine.ca");
  });
});

describe("buildSitemapXml", () => {
  it("writes a valid urlset, escaped", () => {
    const xml = buildSitemapXml([
      {
        url: "https://psymascouche.jechemine.ca/",
        lastModified: new Date("2026-09-12T10:00:00Z"),
        changeFrequency: "weekly",
        priority: 1,
      },
      { url: "https://psymascouche.jechemine.ca/a?b=1&c=2" },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
    expect(xml).toContain("<loc>https://psymascouche.jechemine.ca/</loc>");
    expect(xml).toContain("<lastmod>2026-09-12T10:00:00.000Z</lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>1.0</priority>");
    expect(xml).toContain("<loc>https://psymascouche.jechemine.ca/a?b=1&amp;c=2</loc>");
    expect(xml.trim().endsWith("</urlset>")).toBe(true);
  });

  it("skips an unreadable date and clamps the priority", () => {
    const xml = buildSitemapXml([{ url: "https://x.jechemine.ca/", lastModified: "not a date", priority: 7 }]);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).toContain("<priority>1.0</priority>");
  });

  it("writes an empty urlset when there is nothing to list", () => {
    expect(buildSitemapXml([])).toContain("<urlset");
    expect(buildSitemapXml([])).not.toContain("<url>");
  });
});

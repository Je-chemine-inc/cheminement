import { describe, it, expect } from "vitest";
import { findShowcaseCity } from "@/lib/showcase-cities";
import {
  breadcrumbJsonLd,
  buildCityRobotsTxt,
  buildSitemapXml,
  capitalizeFirst,
  citySitemapEntries,
  countByCity,
  decideCityPage,
  expertisesInCity,
  faqJsonLd,
  headingTitleKeys,
  hubSitemapPaths,
  itemListJsonLd,
  nearbyCities,
  summarizeRegions,
  titlesPhrase,
  type CatalogExpertise,
  type DirectoryEntry,
  type HeadingTitleKey,
} from "@/lib/showcase-seo";

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

const catalog: CatalogExpertise[] = [
  { id: "d", slug: "deuil", labelFr: "Deuil", labelEn: "Grief" },
  { id: "a", slug: "anxiete", labelFr: "Anxiété", labelEn: "Anxiety" },
];

const entries: DirectoryEntry[] = [
  { cityKey: "mascouche", slug: "zoe", expertiseIds: ["a"], lastModified: new Date("2026-09-11T00:00:00Z") },
  { cityKey: "mascouche", slug: "sassi", expertiseIds: ["a", "d", "a", "unknown"], lastModified: new Date("2026-09-10T00:00:00Z") },
  { cityKey: "terrebonne", slug: "tremblay", expertiseIds: ["d"], lastModified: null },
  { cityKey: "laval", slug: "roy", expertiseIds: [], lastModified: null },
];

describe("the directory", () => {
  const counts = countByCity(entries);

  it("counts the professionals presented per city", () => {
    expect(Object.fromEntries(counts)).toEqual({ mascouche: 2, terrebonne: 1, laval: 1 });
  });

  it("sums them per region, every region in the official order", () => {
    const regions = summarizeRegions(counts);
    expect(regions).toHaveLength(17);
    expect(regions[0].region.name).toBe("Bas-Saint-Laurent");
    const lanaudiere = regions.find((summary) => summary.region.key === "lanaudiere")!;
    expect(lanaudiere.total).toBe(3);
    expect(lanaudiere.cities.map((entry) => [entry.city.key, entry.count])).toEqual([
      ["mascouche", 2],
      ["terrebonne", 1],
    ]);
    expect(regions.find((summary) => summary.region.key === "montreal")!).toMatchObject({ total: 0, cities: [] });
  });

  it("offers the other cities of the region where someone is presented", () => {
    expect(nearbyCities(findShowcaseCity("mascouche")!, counts).map((entry) => entry.city.key)).toEqual(["terrebonne"]);
    expect(nearbyCities(findShowcaseCity("laval")!, counts)).toEqual([]);
  });

  it("lists the expertises carried in a city once per professional, with their latest change", () => {
    const found = expertisesInCity(entries, catalog, "mascouche");
    expect(found.map((entry) => [entry.expertise.slug, entry.count, entry.lastModified?.toISOString()])).toEqual([
      ["anxiete", 2, "2026-09-11T00:00:00.000Z"],
      ["deuil", 1, "2026-09-10T00:00:00.000Z"],
    ]);
    expect(expertisesInCity(entries, catalog, "montreal")).toEqual([]);
  });
});

describe("decideCityPage", () => {
  it("indexes a city with a professional presented", () => {
    expect(decideCityPage(1, 0)).toBe("index");
    expect(decideCityPage(3, 8)).toBe("index");
  });

  it("serves an empty city out of search results while its region has professionals", () => {
    expect(decideCityPage(0, 1)).toBe("noindex");
  });

  it("sends an empty city of an empty region to the region's page", () => {
    expect(decideCityPage(0, 0)).toBe("redirect-region");
  });
});

describe("headingTitleKeys", () => {
  it("names the titles of everyone presented, once each, in the usual order", () => {
    expect(headingTitleKeys([{ key: "psychotherapist" }, { key: "psychologist" }, { key: "psychologist" }])).toEqual([
      "psychologist",
      "psychotherapist",
    ]);
  });

  it("falls back to the generic heading for an unrecognised title, too many titles, or nobody", () => {
    expect(headingTitleKeys([{ key: "psychologist" }, { key: null }])).toBeNull();
    expect(headingTitleKeys([{ key: "otherProfessionals" }])).toBeNull();
    expect(headingTitleKeys([])).toBeNull();
    expect(
      headingTitleKeys([
        { key: "psychologist" },
        { key: "psychotherapist" },
        { key: "neuropsychologist" },
        { key: "psychiatrist" },
      ]),
    ).toBeNull();
  });

  it("joins the plural titles as French does, capitalized for a heading", () => {
    const plural: Partial<Record<HeadingTitleKey, string>> = {
      psychologist: "psychologues",
      psychotherapist: "psychothérapeutes",
      psychiatrist: "psychiatres",
    };
    const label = (key: HeadingTitleKey) => plural[key] ?? key;
    expect(titlesPhrase(["psychologist", "psychotherapist"], label, "fr")).toBe("psychologues et psychothérapeutes");
    expect(titlesPhrase(["psychologist", "psychotherapist", "psychiatrist"], label, "fr")).toBe(
      "psychologues, psychothérapeutes et psychiatres",
    );
    expect(capitalizeFirst("psychologues et psychothérapeutes", "fr")).toBe("Psychologues et psychothérapeutes");
    expect(capitalizeFirst("évaluation", "fr")).toBe("Évaluation");
  });
});

describe("sitemaps", () => {
  it("lists a city's page, its professionals and its expertise pages, on its own host", () => {
    const listed = citySitemapEntries("mascouche", entries, catalog);
    expect(listed.map((entry) => entry.url)).toEqual([
      "https://psymascouche.jechemine.ca/",
      "https://psymascouche.jechemine.ca/sassi",
      "https://psymascouche.jechemine.ca/zoe",
      "https://psymascouche.jechemine.ca/specialite/anxiete",
      "https://psymascouche.jechemine.ca/specialite/deuil",
    ]);
    expect((listed[0].lastModified as Date).toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("lists nothing for a city where nobody is presented", () => {
    expect(citySitemapEntries("montreal", entries, catalog)).toEqual([]);
  });

  it("lists the directory on www: /psy and each region with a professional, in the official order", () => {
    expect(hubSitemapPaths(summarizeRegions(countByCity(entries)))).toEqual(["/psy", "/psy/laval", "/psy/lanaudiere"]);
    expect(hubSitemapPaths(summarizeRegions(new Map()))).toEqual([]);
  });
});

describe("structured data", () => {
  it("builds an FAQ page", () => {
    expect(faqJsonLd([{ question: "Q ?", answer: "R." }])).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Q ?", acceptedAnswer: { "@type": "Answer", text: "R." } }],
    });
  });

  it("builds a breadcrumb and an item list, numbered from 1", () => {
    const items = [
      { name: "Québec", url: "https://www.jechemine.ca/psy" },
      { name: "Lanaudière", url: "https://www.jechemine.ca/psy/lanaudiere" },
    ];
    expect(breadcrumbJsonLd(items)).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Québec", item: "https://www.jechemine.ca/psy" },
        { "@type": "ListItem", position: 2, name: "Lanaudière", item: "https://www.jechemine.ca/psy/lanaudiere" },
      ],
    });
    expect(itemListJsonLd("Villes", items)).toMatchObject({
      "@type": "ItemList",
      name: "Villes",
      itemListElement: [
        { "@type": "ListItem", position: 1, url: "https://www.jechemine.ca/psy" },
        { "@type": "ListItem", position: 2, url: "https://www.jechemine.ca/psy/lanaudiere" },
      ],
    });
  });
});

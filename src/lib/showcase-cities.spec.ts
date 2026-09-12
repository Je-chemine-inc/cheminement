import { describe, it, expect } from "vitest";
import {
  QC_ADMIN_REGIONS,
  SHOWCASE_CITIES,
  SHOWCASE_REGIONS,
  cityHostKey,
  findShowcaseCity,
  findShowcaseRegion,
  matchShowcaseCity,
  regionPathKey,
} from "@/lib/showcase-cities";
import { CANADA_CITIES } from "@/data/canadaCities";

/**
 * The city registry decides which psy<city>.jechemine.ca hosts exist. Its keys
 * are public URLs, so they are pinned here: renaming a city in the data file
 * must fail this spec rather than silently move a live page.
 */
describe("showcase city registry", () => {
  it("has one host per Quebec city, and only Quebec", () => {
    const quebec = CANADA_CITIES.filter((c) => c.province === "QC");
    expect(SHOWCASE_CITIES).toHaveLength(quebec.length);
    expect(SHOWCASE_CITIES.map((c) => c.name)).toEqual(quebec.map((c) => c.city));
    expect(SHOWCASE_CITIES.some((c) => c.name === "Toronto")).toBe(false);
  });

  it("gives every city a unique host label made of lowercase letters and digits", () => {
    const keys = SHOWCASE_CITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const city of SHOWCASE_CITIES) {
      expect(city.key).toMatch(/^[a-z0-9]+$/);
      expect(city.host).toBe(`psy${city.key}.jechemine.ca`);
    }
  });

  it("keeps the public host labels stable", () => {
    const pinned: Record<string, string> = {
      Mascouche: "mascouche",
      Montréal: "montreal",
      "Trois-Rivières": "troisrivieres",
      Québec: "quebec",
      "Saint-Jérôme": "saintjerome",
      "Val-d'Or": "valdor",
      "L'Assomption": "lassomption",
      "Les Îles-de-la-Madeleine": "lesilesdelamadeleine",
      "Sept-Îles": "septiles",
      Chibougamau: "chibougamau",
    };
    for (const [name, key] of Object.entries(pinned)) {
      expect(cityHostKey(name)).toBe(key);
      expect(findShowcaseCity(key)?.name).toBe(name);
    }
  });

  it("files every city under one of the 17 administrative regions, each with a city", () => {
    expect(QC_ADMIN_REGIONS).toHaveLength(17);
    for (const city of SHOWCASE_CITIES) {
      expect(QC_ADMIN_REGIONS).toContain(city.region);
    }
    for (const region of SHOWCASE_REGIONS) {
      expect(region.cities.length, region.name).toBeGreaterThan(0);
    }
    expect(SHOWCASE_REGIONS.map((r) => r.number)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 1),
    );
  });

  it("turns region names into readable URL segments", () => {
    expect(regionPathKey("Saguenay–Lac-Saint-Jean")).toBe("saguenay-lac-saint-jean");
    expect(regionPathKey("Gaspésie–Îles-de-la-Madeleine")).toBe("gaspesie-iles-de-la-madeleine");
    expect(regionPathKey("Montréal")).toBe("montreal");
    expect(regionPathKey("Nord-du-Québec")).toBe("nord-du-quebec");
    expect(findShowcaseRegion("lanaudiere")?.cities.map((c) => c.key)).toContain("mascouche");
    expect(findShowcaseRegion("nowhere")).toBeNull();
  });

  it("recognises a free-typed city, never a city outside Quebec", () => {
    expect(matchShowcaseCity("Montreal, QC")?.key).toBe("montreal");
    expect(matchShowcaseCity("  trois rivières ")?.key).toBe("troisrivieres");
    expect(matchShowcaseCity("MASCOUCHE, Québec")?.key).toBe("mascouche");
    expect(matchShowcaseCity("Toronto")).toBeNull();
    expect(matchShowcaseCity("")).toBeNull();
    expect(matchShowcaseCity(null)).toBeNull();
  });
});

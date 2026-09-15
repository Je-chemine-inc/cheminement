import { CANADA_CITIES } from "@/data/canadaCities";
import { APEX_HOST } from "@/lib/site-url";

/**
 * The cities a showcase page can name (spec 003), each with the host label it
 * would get (psy<city>.jechemine.ca).
 *
 * Derived from the Quebec entries of src/data/canadaCities.ts, the list the
 * booking funnel's city search and the matcher already use, so a city exists
 * once. Boroughs and former cities (entries with `partOf`) stay in the city
 * search but are not offered here.
 *
 * The city hosts served the pages until 2026-09-15; a page now lives at
 * www.jechemine.ca/<slug> and names its city in its text. The hosts are kept
 * for a later use (wildcard DNS + certificate), so the keys stay pinned by
 * showcase-cities.spec.ts: they are stored on every page (`cityKey`).
 *
 * Pure: safe to import from the middleware (edge runtime).
 */

export interface ShowcaseCity {
  /** Host label after "psy": "mascouche", "troisrivieres", "valdor". */
  key: string;
  /** Full host: "psymascouche.jechemine.ca". */
  host: string;
  /** Display name as written in the data: "Trois-Rivières". */
  name: string;
  /** Quebec administrative region as written in the data. */
  region: string;
  /** URL segment of the region hub on www: "saguenay-lac-saint-jean". */
  regionKey: string;
}

export interface ShowcaseRegion {
  key: string;
  name: string;
  /** Official order, 1–17 (01 Bas-Saint-Laurent … 17 Centre-du-Québec). */
  number: number;
  cities: readonly ShowcaseCity[];
}

/** Every city host starts with it. */
export const SHOWCASE_HOST_PREFIX = "psy";

/** The 17 administrative regions, in their official order. */
export const QC_ADMIN_REGIONS = [
  "Bas-Saint-Laurent",
  "Saguenay–Lac-Saint-Jean",
  "Capitale-Nationale",
  "Mauricie",
  "Estrie",
  "Montréal",
  "Outaouais",
  "Abitibi-Témiscamingue",
  "Côte-Nord",
  "Nord-du-Québec",
  "Gaspésie–Îles-de-la-Madeleine",
  "Chaudière-Appalaches",
  "Laval",
  "Lanaudière",
  "Laurentides",
  "Montérégie",
  "Centre-du-Québec",
] as const;

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * A city name as a host label: no accents, no spaces, no punctuation.
 * "Trois-Rivières" → "troisrivieres", "Val-d'Or" → "valdor",
 * "Les Îles-de-la-Madeleine" → "lesilesdelamadeleine".
 */
export function cityHostKey(name: string): string {
  return stripAccents(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A region name as a URL segment, words kept apart:
 * "Saguenay–Lac-Saint-Jean" → "saguenay-lac-saint-jean".
 */
export function regionPathKey(region: string): string {
  return stripAccents(region)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SHOWCASE_CITIES: readonly ShowcaseCity[] = CANADA_CITIES.filter(
  (c) => c.province === "QC" && !c.partOf,
).map((c) => {
  const key = cityHostKey(c.city);
  return {
    key,
    host: `${SHOWCASE_HOST_PREFIX}${key}.${APEX_HOST}`,
    name: c.city,
    region: c.region,
    regionKey: regionPathKey(c.region),
  };
});

const CITY_BY_KEY = new Map(SHOWCASE_CITIES.map((c) => [c.key, c]));

export function findShowcaseCity(key: string | null | undefined): ShowcaseCity | null {
  if (!key) return null;
  return CITY_BY_KEY.get(key) ?? null;
}

export function isShowcaseCityKey(key: string): boolean {
  return CITY_BY_KEY.has(key);
}

/**
 * The registry city a free-typed city name refers to, if any: "Montreal",
 * "montréal" and "Montréal, QC" all find Montréal. For suggesting a
 * professional's city from their profile — never to route a request.
 */
export function matchShowcaseCity(input: string | null | undefined): ShowcaseCity | null {
  if (!input) return null;
  const withoutProvince = input.replace(/,\s*(qc|québec|quebec)\s*$/i, "");
  return findShowcaseCity(cityHostKey(withoutProvince));
}

export const SHOWCASE_REGIONS: readonly ShowcaseRegion[] = QC_ADMIN_REGIONS.map(
  (name, index) => ({
    key: regionPathKey(name),
    name,
    number: index + 1,
    cities: SHOWCASE_CITIES.filter((c) => c.region === name),
  }),
);

const REGION_BY_KEY = new Map(SHOWCASE_REGIONS.map((r) => [r.key, r]));

export function findShowcaseRegion(key: string | null | undefined): ShowcaseRegion | null {
  if (!key) return null;
  return REGION_BY_KEY.get(key) ?? null;
}

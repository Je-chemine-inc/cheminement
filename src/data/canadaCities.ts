/**
 * Quebec municipalities (with their administrative region, for proximity-based
 * jumelage) + major Canadian cities. Drives the city autocomplete and the
 * matcher's location proximity bonus.
 *
 * NOT exhaustive (Quebec alone has ~1100 municipalities) — it covers the major
 * population centres across every Quebec region plus the largest Canadian cities.
 * The autocomplete allows a free-typed value for anything not listed, so a small
 * town is never blocked; it simply won't earn the location bonus until matched.
 *
 * `region` is the Quebec administrative region (used for the "same region" bonus
 * when two people aren't in the exact same city). Non-Quebec cities use the
 * province name as their region (so same-province still groups them loosely).
 */
export interface CityEntry {
  city: string;
  /** Two-letter province/territory code. */
  province: string;
  /** Grouping for proximity (QC administrative region, else province name). */
  region: string;
}

// Quebec administrative regions (labels reused as the `region` value).
const BSL = "Bas-Saint-Laurent";
const SLSJ = "Saguenay–Lac-Saint-Jean";
const CN = "Capitale-Nationale";
const MAU = "Mauricie";
const EST = "Estrie";
const MTL = "Montréal";
const OUT = "Outaouais";
const AT = "Abitibi-Témiscamingue";
const COTE_NORD = "Côte-Nord";
const GIM = "Gaspésie–Îles-de-la-Madeleine";
const CA = "Chaudière-Appalaches";
const LAV = "Laval";
const LAN = "Lanaudière";
const LAU = "Laurentides";
const MON = "Montérégie";
const CDQ = "Centre-du-Québec";

const qc = (city: string, region: string): CityEntry => ({
  city,
  province: "QC",
  region,
});

export const CANADA_CITIES: CityEntry[] = [
  // --- Montréal ---
  qc("Montréal", MTL),
  qc("Montréal-Nord", MTL),
  qc("Montréal-Ouest", MTL),
  qc("Westmount", MTL),
  qc("Outremont", MTL),
  qc("Verdun", MTL),
  qc("LaSalle", MTL),
  qc("Lachine", MTL),
  qc("Saint-Laurent", MTL),
  qc("Anjou", MTL),
  qc("Pierrefonds", MTL),
  qc("Dollard-des-Ormeaux", MTL),
  qc("Pointe-Claire", MTL),
  qc("Kirkland", MTL),
  qc("Beaconsfield", MTL),
  qc("Dorval", MTL),
  qc("Côte-Saint-Luc", MTL),
  qc("Hampstead", MTL),
  qc("Mont-Royal", MTL),
  // --- Laval ---
  qc("Laval", LAV),
  // --- Montérégie ---
  qc("Longueuil", MON),
  qc("Brossard", MON),
  qc("Saint-Hubert", MON),
  qc("Boucherville", MON),
  qc("Saint-Lambert", MON),
  qc("Saint-Bruno-de-Montarville", MON),
  qc("Saint-Jean-sur-Richelieu", MON),
  qc("Châteauguay", MON),
  qc("Saint-Hyacinthe", MON),
  qc("Vaudreuil-Dorion", MON),
  qc("Granby", MON),
  qc("Sorel-Tracy", MON),
  qc("Beloeil", MON),
  qc("Chambly", MON),
  qc("Candiac", MON),
  qc("La Prairie", MON),
  qc("Sainte-Julie", MON),
  qc("Varennes", MON),
  qc("Saint-Constant", MON),
  qc("Salaberry-de-Valleyfield", MON),
  qc("Cowansville", MON),
  qc("Mont-Saint-Hilaire", MON),
  qc("Saint-Basile-le-Grand", MON),
  // --- Lanaudière ---
  qc("Terrebonne", LAN),
  qc("Repentigny", LAN),
  qc("Mascouche", LAN),
  qc("Joliette", LAN),
  qc("L'Assomption", LAN),
  qc("Lavaltrie", LAN),
  qc("Saint-Charles-Borromée", LAN),
  qc("Rawdon", LAN),
  // --- Laurentides ---
  qc("Blainville", LAU),
  qc("Mirabel", LAU),
  qc("Saint-Jérôme", LAU),
  qc("Boisbriand", LAU),
  qc("Sainte-Thérèse", LAU),
  qc("Saint-Eustache", LAU),
  qc("Deux-Montagnes", LAU),
  qc("Rosemère", LAU),
  qc("Sainte-Anne-des-Plaines", LAU),
  qc("Mont-Tremblant", LAU),
  qc("Saint-Sauveur", LAU),
  // --- Capitale-Nationale ---
  qc("Québec", CN),
  qc("L'Ancienne-Lorette", CN),
  qc("Saint-Augustin-de-Desmaures", CN),
  qc("Boischatel", CN),
  qc("Stoneham-et-Tewkesbury", CN),
  qc("Baie-Saint-Paul", CN),
  // --- Chaudière-Appalaches ---
  qc("Lévis", CA),
  qc("Saint-Georges", CA),
  qc("Thetford Mines", CA),
  qc("Sainte-Marie", CA),
  qc("Montmagny", CA),
  // --- Mauricie ---
  qc("Trois-Rivières", MAU),
  qc("Shawinigan", MAU),
  qc("Cap-de-la-Madeleine", MAU),
  qc("La Tuque", MAU),
  // --- Centre-du-Québec ---
  qc("Drummondville", CDQ),
  qc("Victoriaville", CDQ),
  qc("Bécancour", CDQ),
  qc("Nicolet", CDQ),
  // --- Estrie ---
  qc("Sherbrooke", EST),
  qc("Magog", EST),
  qc("Coaticook", EST),
  qc("Lac-Mégantic", EST),
  // --- Outaouais ---
  qc("Gatineau", OUT),
  qc("Hull", OUT),
  qc("Aylmer", OUT),
  qc("Buckingham", OUT),
  // --- Saguenay–Lac-Saint-Jean ---
  qc("Saguenay", SLSJ),
  qc("Chicoutimi", SLSJ),
  qc("Jonquière", SLSJ),
  qc("Alma", SLSJ),
  qc("Dolbeau-Mistassini", SLSJ),
  qc("Roberval", SLSJ),
  // --- Bas-Saint-Laurent ---
  qc("Rimouski", BSL),
  qc("Rivière-du-Loup", BSL),
  qc("Matane", BSL),
  qc("Mont-Joli", BSL),
  // --- Abitibi-Témiscamingue ---
  qc("Rouyn-Noranda", AT),
  qc("Val-d'Or", AT),
  qc("Amos", AT),
  qc("La Sarre", AT),
  // --- Côte-Nord ---
  qc("Baie-Comeau", COTE_NORD),
  qc("Sept-Îles", COTE_NORD),
  qc("Port-Cartier", COTE_NORD),
  // --- Gaspésie–Îles-de-la-Madeleine ---
  qc("Gaspé", GIM),
  qc("Chandler", GIM),
  qc("Carleton-sur-Mer", GIM),
  qc("Les Îles-de-la-Madeleine", GIM),

  // --- Major Canadian cities (region = province name) ---
  { city: "Toronto", province: "ON", region: "Ontario" },
  { city: "Ottawa", province: "ON", region: "Ontario" },
  { city: "Mississauga", province: "ON", region: "Ontario" },
  { city: "Brampton", province: "ON", region: "Ontario" },
  { city: "Hamilton", province: "ON", region: "Ontario" },
  { city: "London", province: "ON", region: "Ontario" },
  { city: "Markham", province: "ON", region: "Ontario" },
  { city: "Vaughan", province: "ON", region: "Ontario" },
  { city: "Kitchener", province: "ON", region: "Ontario" },
  { city: "Windsor", province: "ON", region: "Ontario" },
  { city: "Vancouver", province: "BC", region: "British Columbia" },
  { city: "Surrey", province: "BC", region: "British Columbia" },
  { city: "Burnaby", province: "BC", region: "British Columbia" },
  { city: "Richmond", province: "BC", region: "British Columbia" },
  { city: "Victoria", province: "BC", region: "British Columbia" },
  { city: "Kelowna", province: "BC", region: "British Columbia" },
  { city: "Calgary", province: "AB", region: "Alberta" },
  { city: "Edmonton", province: "AB", region: "Alberta" },
  { city: "Red Deer", province: "AB", region: "Alberta" },
  { city: "Lethbridge", province: "AB", region: "Alberta" },
  { city: "Winnipeg", province: "MB", region: "Manitoba" },
  { city: "Brandon", province: "MB", region: "Manitoba" },
  { city: "Saskatoon", province: "SK", region: "Saskatchewan" },
  { city: "Regina", province: "SK", region: "Saskatchewan" },
  { city: "Halifax", province: "NS", region: "Nova Scotia" },
  { city: "Sydney", province: "NS", region: "Nova Scotia" },
  { city: "Moncton", province: "NB", region: "New Brunswick" },
  { city: "Fredericton", province: "NB", region: "New Brunswick" },
  { city: "Saint John", province: "NB", region: "New Brunswick" },
  { city: "St. John's", province: "NL", region: "Newfoundland and Labrador" },
  { city: "Charlottetown", province: "PE", region: "Prince Edward Island" },
  { city: "Whitehorse", province: "YT", region: "Yukon" },
  { city: "Yellowknife", province: "NT", region: "Northwest Territories" },
  { city: "Iqaluit", province: "NU", region: "Nunavut" },
];

/** Display/value labels, e.g. "Terrebonne, QC". */
export const CITY_LABELS: string[] = CANADA_CITIES.map(
  (c) => `${c.city}, ${c.province}`,
);

const labelToEntry = new Map<string, CityEntry>(
  CANADA_CITIES.map((c) => [`${c.city}, ${c.province}`, c]),
);

/** Look up a city entry by its "City, QC" label (exact). */
export function findCityByLabel(label: string): CityEntry | undefined {
  return labelToEntry.get(label.trim());
}

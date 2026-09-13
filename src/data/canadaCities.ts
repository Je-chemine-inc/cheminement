/**
 * Quebec municipalities (with their administrative region, for proximity-based
 * jumelage) + major Canadian cities. Drives the city autocomplete, the
 * matcher's location proximity bonus and the showcase city hosts
 * (psy<city>.jechemine.ca, src/lib/showcase-cities.ts).
 *
 * Quebec: every municipality designated « Ville » in the Répertoire des
 * municipalités du Québec (ministère des Affaires municipales et de
 * l'Habitation, Données Québec, CC BY 4.0 — credited on www/psy), names and
 * regions as published on 2026-09-11, plus a few smaller municipalities and the
 * boroughs and former cities people still type (`borough`). NOT exhaustive
 * (Quebec has ~1,100 municipalities): the autocomplete allows a free-typed
 * value for anything not listed, so a small town is never blocked; it simply
 * won't earn the location bonus until matched. Within a region block, the
 * first entries come first in the autocomplete; new ones go at the end,
 * biggest first.
 *
 * ⚠ A Quebec entry's name is its public host. Never rename or remove one whose
 * host may be live; showcase-cities.spec.ts pins them.
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
  /** A borough or former city: the city it is part of today. No showcase host. */
  partOf?: string;
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
const NDQ = "Nord-du-Québec";

const qc = (city: string, region: string): CityEntry => ({
  city,
  province: "QC",
  region,
});

const borough = (city: string, region: string, partOf: string): CityEntry => ({
  ...qc(city, region),
  partOf,
});

export const CANADA_CITIES: CityEntry[] = [
  // --- Montréal ---
  qc("Montréal", MTL),
  borough("Montréal-Nord", MTL, "Montréal"),
  qc("Montréal-Ouest", MTL),
  qc("Westmount", MTL),
  borough("Outremont", MTL, "Montréal"),
  borough("Verdun", MTL, "Montréal"),
  borough("LaSalle", MTL, "Montréal"),
  borough("Lachine", MTL, "Montréal"),
  borough("Saint-Laurent", MTL, "Montréal"),
  borough("Anjou", MTL, "Montréal"),
  borough("Pierrefonds", MTL, "Montréal"),
  qc("Dollard-des-Ormeaux", MTL),
  qc("Pointe-Claire", MTL),
  qc("Kirkland", MTL),
  qc("Beaconsfield", MTL),
  qc("Dorval", MTL),
  qc("Côte-Saint-Luc", MTL),
  qc("Hampstead", MTL),
  qc("Mont-Royal", MTL),
  qc("Sainte-Anne-de-Bellevue", MTL),
  qc("Montréal-Est", MTL),
  qc("Baie-D'Urfé", MTL),
  qc("L'Île-Dorval", MTL),
  // --- Laval ---
  qc("Laval", LAV),
  // --- Montérégie ---
  qc("Longueuil", MON),
  qc("Brossard", MON),
  borough("Saint-Hubert", MON, "Longueuil"),
  qc("Boucherville", MON),
  qc("Saint-Lambert", MON),
  qc("Saint-Bruno-de-Montarville", MON),
  qc("Saint-Jean-sur-Richelieu", MON),
  qc("Châteauguay", MON),
  qc("Saint-Hyacinthe", MON),
  qc("Vaudreuil-Dorion", MON),
  qc("Sorel-Tracy", MON),
  qc("Beloeil", MON),
  qc("Chambly", MON),
  qc("Candiac", MON),
  qc("La Prairie", MON),
  qc("Sainte-Julie", MON),
  qc("Varennes", MON),
  qc("Saint-Constant", MON),
  qc("Salaberry-de-Valleyfield", MON),
  qc("Mont-Saint-Hilaire", MON),
  qc("Saint-Basile-le-Grand", MON),
  qc("Saint-Lazare", MON),
  qc("Sainte-Catherine", MON),
  qc("Mercier", MON),
  qc("Beauharnois", MON),
  qc("Pincourt", MON),
  qc("Saint-Amable", MON),
  qc("Carignan", MON),
  qc("Marieville", MON),
  qc("L'Île-Perrot", MON),
  qc("Notre-Dame-de-l'Île-Perrot", MON),
  qc("Contrecoeur", MON),
  qc("Saint-Zotique", MON),
  qc("Saint-Rémi", MON),
  qc("Otterburn Park", MON),
  qc("Delson", MON),
  qc("Saint-Philippe", MON),
  qc("Rigaud", MON),
  qc("Acton Vale", MON),
  qc("Coteau-du-Lac", MON),
  qc("Saint-Césaire", MON),
  qc("McMasterville", MON),
  qc("Saint-Pie", MON),
  qc("Richelieu", MON),
  qc("Hudson", MON),
  qc("Huntingdon", MON),
  qc("Léry", MON),
  qc("Saint-Ours", MON),
  qc("Saint-Joseph-de-Sorel", MON),
  qc("L'Île-Cadieux", MON),
  // --- Lanaudière ---
  qc("Terrebonne", LAN),
  qc("Repentigny", LAN),
  qc("Mascouche", LAN),
  qc("Joliette", LAN),
  qc("L'Assomption", LAN),
  qc("Lavaltrie", LAN),
  qc("Saint-Charles-Borromée", LAN),
  qc("Rawdon", LAN),
  qc("Saint-Lin–Laurentides", LAN),
  qc("Notre-Dame-des-Prairies", LAN),
  qc("L'Épiphanie", LAN),
  qc("Charlemagne", LAN),
  qc("Berthierville", LAN),
  qc("Crabtree", LAN),
  qc("Saint-Gabriel", LAN),
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
  qc("Sainte-Marthe-sur-le-Lac", LAU),
  qc("Saint-Colomban", LAU),
  qc("Lachute", LAU),
  qc("Sainte-Adèle", LAU),
  qc("Mont-Laurier", LAU),
  qc("Prévost", LAU),
  qc("Sainte-Agathe-des-Monts", LAU),
  qc("Bois-des-Filion", LAU),
  qc("Lorraine", LAU),
  qc("Brownsburg-Chatham", LAU),
  qc("Rivière-Rouge", LAU),
  qc("Sainte-Marguerite-du-Lac-Masson", LAU),
  qc("Estérel", LAU),
  qc("Barkmere", LAU),
  // --- Capitale-Nationale ---
  qc("Québec", CN),
  qc("L'Ancienne-Lorette", CN),
  qc("Saint-Augustin-de-Desmaures", CN),
  qc("Boischatel", CN),
  qc("Stoneham-et-Tewkesbury", CN),
  qc("Baie-Saint-Paul", CN),
  qc("Saint-Raymond", CN),
  qc("Pont-Rouge", CN),
  qc("Sainte-Catherine-de-la-Jacques-Cartier", CN),
  qc("Sainte-Brigitte-de-Laval", CN),
  qc("La Malbaie", CN),
  qc("Donnacona", CN),
  qc("Shannon", CN),
  qc("Château-Richer", CN),
  qc("Neuville", CN),
  qc("Beaupré", CN),
  qc("Cap-Santé", CN),
  qc("Portneuf", CN),
  qc("Sainte-Anne-de-Beaupré", CN),
  qc("Clermont", CN),
  qc("Saint-Marc-des-Carrières", CN),
  qc("Saint-Basile", CN),
  qc("Fossambault-sur-le-Lac", CN),
  qc("Lac-Delage", CN),
  qc("Lac-Sergent", CN),
  qc("Lac-Saint-Joseph", CN),
  // --- Chaudière-Appalaches ---
  qc("Lévis", CA),
  qc("Saint-Georges", CA),
  qc("Thetford Mines", CA),
  qc("Sainte-Marie", CA),
  qc("Montmagny", CA),
  qc("Beauceville", CA),
  qc("Saint-Joseph-de-Beauce", CA),
  qc("Saint-Pamphile", CA),
  qc("Disraeli", CA),
  // --- Mauricie ---
  qc("Trois-Rivières", MAU),
  qc("Shawinigan", MAU),
  borough("Cap-de-la-Madeleine", MAU, "Trois-Rivières"),
  qc("La Tuque", MAU),
  qc("Louiseville", MAU),
  qc("Saint-Tite", MAU),
  // --- Centre-du-Québec ---
  qc("Drummondville", CDQ),
  qc("Victoriaville", CDQ),
  qc("Bécancour", CDQ),
  qc("Nicolet", CDQ),
  qc("Plessisville", CDQ),
  qc("Princeville", CDQ),
  qc("Warwick", CDQ),
  qc("Daveluyville", CDQ),
  qc("Kingsey Falls", CDQ),
  // --- Estrie ---
  qc("Sherbrooke", EST),
  qc("Magog", EST),
  qc("Coaticook", EST),
  qc("Lac-Mégantic", EST),
  qc("Granby", EST),
  qc("Cowansville", EST),
  qc("Bromont", EST),
  qc("Farnham", EST),
  qc("Val-des-Sources", EST),
  qc("Lac-Brome", EST),
  qc("Waterloo", EST),
  qc("Cookshire-Eaton", EST),
  qc("Windsor", EST),
  qc("Sutton", EST),
  qc("East Angus", EST),
  qc("Danville", EST),
  qc("Dunham", EST),
  qc("Richmond", EST),
  qc("Stanstead", EST),
  qc("Bedford", EST),
  qc("Waterville", EST),
  qc("Valcourt", EST),
  qc("Scotstown", EST),
  // --- Outaouais ---
  qc("Gatineau", OUT),
  borough("Hull", OUT, "Gatineau"),
  borough("Aylmer", OUT, "Gatineau"),
  borough("Buckingham", OUT, "Gatineau"),
  qc("Maniwaki", OUT),
  qc("Thurso", OUT),
  qc("Gracefield", OUT),
  // --- Saguenay–Lac-Saint-Jean ---
  qc("Saguenay", SLSJ),
  borough("Chicoutimi", SLSJ, "Saguenay"),
  borough("Jonquière", SLSJ, "Saguenay"),
  qc("Alma", SLSJ),
  qc("Dolbeau-Mistassini", SLSJ),
  qc("Roberval", SLSJ),
  qc("Saint-Félicien", SLSJ),
  qc("Saint-Honoré", SLSJ),
  qc("Métabetchouan–Lac-à-la-Croix", SLSJ),
  qc("Normandin", SLSJ),
  qc("Desbiens", SLSJ),
  // --- Bas-Saint-Laurent ---
  qc("Rimouski", BSL),
  qc("Rivière-du-Loup", BSL),
  qc("Matane", BSL),
  qc("Mont-Joli", BSL),
  qc("La Pocatière", BSL),
  qc("Amqui", BSL),
  qc("Témiscouata-sur-le-Lac", BSL),
  qc("Saint-Antonin", BSL),
  qc("Saint-Pascal", BSL),
  qc("Trois-Pistoles", BSL),
  qc("Dégelis", BSL),
  qc("Pohénégamook", BSL),
  qc("Causapscal", BSL),
  qc("Lac-des-Aigles", BSL),
  qc("Métis-sur-Mer", BSL),
  // --- Abitibi-Témiscamingue ---
  qc("Rouyn-Noranda", AT),
  qc("Val-d'Or", AT),
  qc("Amos", AT),
  qc("La Sarre", AT),
  qc("Malartic", AT),
  qc("Senneterre", AT),
  qc("Macamic", AT),
  qc("Ville-Marie", AT),
  qc("Témiscaming", AT),
  qc("Duparquet", AT),
  qc("Belleterre", AT),
  // --- Côte-Nord ---
  qc("Baie-Comeau", COTE_NORD),
  qc("Sept-Îles", COTE_NORD),
  qc("Port-Cartier", COTE_NORD),
  qc("Forestville", COTE_NORD),
  qc("Fermont", COTE_NORD),
  qc("Schefferville", COTE_NORD),
  // --- Gaspésie–Îles-de-la-Madeleine ---
  qc("Gaspé", GIM),
  qc("Chandler", GIM),
  qc("Carleton-sur-Mer", GIM),
  qc("Les Îles-de-la-Madeleine", GIM),
  qc("Sainte-Anne-des-Monts", GIM),
  qc("New Richmond", GIM),
  qc("Grande-Rivière", GIM),
  qc("Paspébiac", GIM),
  qc("Percé", GIM),
  qc("Bonaventure", GIM),
  qc("Cap-Chat", GIM),
  qc("Murdochville", GIM),
  // --- Nord-du-Québec ---
  qc("Chibougamau", NDQ),
  qc("Lebel-sur-Quévillon", NDQ),
  qc("Chapais", NDQ),
  qc("Matagami", NDQ),

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

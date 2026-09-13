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
import { CANADA_CITIES, findCityByLabel } from "@/data/canadaCities";

/**
 * Every host label of the registry on 2026-09-13: the 234 « Ville » of the
 * Répertoire des municipalités du Québec plus Rawdon, Boischatel,
 * Stoneham-et-Tewkesbury and Les Îles-de-la-Madeleine. Adding a city is fine;
 * a label that disappears (a city renamed or removed in the data file) would
 * break every link to a live page, so it fails here. Add new labels to this
 * list once their host is live.
 */
const PINNED_HOST_LABELS = `
  actonvale alma amos amqui baiecomeau baiedurfe baiesaintpaul barkmere beaconsfield beauceville
  beauharnois beaupre becancour bedford belleterre beloeil berthierville blainville boisbriand
  boischatel boisdesfilion bonaventure boucherville bromont brossard brownsburgchatham candiac
  capchat capsante carignan carletonsurmer causapscal chambly chandler chapais charlemagne
  chateauguay chateauricher chibougamau clermont coaticook contrecoeur cookshireeaton coteaudulac
  cotesaintluc cowansville crabtree danville daveluyville degelis delson desbiens deuxmontagnes
  disraeli dolbeaumistassini dollarddesormeaux donnacona dorval drummondville dunham duparquet
  eastangus esterel farnham fermont forestville fossambaultsurlelac gaspe gatineau gracefield
  granby granderiviere hampstead hudson huntingdon joliette kingseyfalls kirkland lacbrome
  lacdelage lacdesaigles lachute lacmegantic lacsaintjoseph lacsergent lamalbaie lanciennelorette
  lapocatiere laprairie lasarre lassomption latuque laval lavaltrie lebelsurquevillon lepiphanie
  lery lesilesdelamadeleine levis lilecadieux liledorval lileperrot longueuil lorraine
  louiseville macamic magog malartic maniwaki marieville mascouche matagami matane mcmasterville
  mercier metabetchouanlacalacroix metissurmer mirabel montjoli montlaurier montmagny montreal
  montrealest montrealouest montroyal montsainthilaire monttremblant murdochville neuville
  newrichmond nicolet normandin notredamedelileperrot notredamedesprairies otterburnpark
  paspebiac perce pincourt plessisville pohenegamook pointeclaire pontrouge portcartier portneuf
  prevost princeville quebec rawdon repentigny richelieu richmond rigaud rimouski riviereduloup
  riviererouge roberval rosemere rouynnoranda saguenay saintamable saintantonin
  saintaugustindedesmaures saintbasile saintbasilelegrand saintbrunodemontarville saintcesaire
  saintcharlesborromee saintcolomban saintconstant sainteadele sainteagathedesmonts
  sainteannedebeaupre sainteannedebellevue sainteannedesmonts sainteannedesplaines
  saintebrigittedelaval saintecatherine saintecatherinedelajacquescartier saintejulie
  saintemargueritedulacmasson saintemarie saintemarthesurlelac saintetherese sainteustache
  saintfelicien saintgabriel saintgeorges sainthonore sainthyacinthe saintjeansurrichelieu
  saintjerome saintjosephdebeauce saintjosephdesorel saintlambert saintlazare saintlinlaurentides
  saintmarcdescarrieres saintours saintpamphile saintpascal saintphilippe saintpie saintraymond
  saintremi saintsauveur sainttite saintzotique salaberrydevalleyfield schefferville scotstown
  senneterre septiles shannon shawinigan sherbrooke soreltracy stanstead stonehamettewkesbury
  sutton temiscaming temiscouatasurlelac terrebonne thetfordmines thurso troispistoles
  troisrivieres valcourt valdessources valdor varennes vaudreuildorion victoriaville villemarie
  warwick waterloo waterville westmount windsor
`
  .trim()
  .split(/\s+/);

/**
 * The city registry decides which psy<city>.jechemine.ca hosts exist. Its keys
 * are public URLs, so they are pinned here: renaming a city in the data file
 * must fail this spec rather than silently move a live page.
 */
describe("showcase city registry", () => {
  it("has one host per Quebec city that is not a borough, and only Quebec", () => {
    const quebec = CANADA_CITIES.filter((c) => c.province === "QC" && !c.partOf);
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
      // A DNS label is at most 63 characters.
      expect(`psy${city.key}`.length).toBeLessThanOrEqual(63);
    }
  });

  it("never loses a host label that may be live", () => {
    const missing = PINNED_HOST_LABELS.filter((label) => !findShowcaseCity(label));
    expect(missing).toEqual([]);
    expect(PINNED_HOST_LABELS.length).toBeGreaterThanOrEqual(238);
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
      "Saint-Lin–Laurentides": "saintlinlaurentides",
      "Baie-D'Urfé": "baiedurfe",
      "Notre-Dame-de-l'Île-Perrot": "notredamedelileperrot",
    };
    for (const [name, key] of Object.entries(pinned)) {
      expect(cityHostKey(name)).toBe(key);
      expect(findShowcaseCity(key)?.name).toBe(name);
    }
  });

  it("gives boroughs and former cities no host, but keeps them in the city search", () => {
    const boroughs = CANADA_CITIES.filter((c) => c.partOf);
    expect(boroughs.map((c) => c.city)).toEqual(
      expect.arrayContaining(["Verdun", "Hull", "Chicoutimi", "Saint-Hubert", "Cap-de-la-Madeleine"]),
    );
    for (const borough of boroughs) {
      expect(findShowcaseCity(cityHostKey(borough.city)), borough.city).toBeNull();
      const parent = findShowcaseCity(cityHostKey(borough.partOf!));
      expect(parent?.name, borough.city).toBe(borough.partOf);
      expect(parent?.region, borough.city).toBe(borough.region);
      expect(findCityByLabel(`${borough.city}, QC`)?.region).toBe(borough.region);
    }
    expect(matchShowcaseCity("Verdun, QC")).toBeNull();
  });

  it("lists every city label once", () => {
    const labels = CANADA_CITIES.map((c) => `${c.city}, ${c.province}`);
    expect(new Set(labels).size).toBe(labels.length);
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
    // Moved from Montérégie to Estrie in 2021, as the Répertoire has them.
    expect(findShowcaseCity("granby")?.region).toBe("Estrie");
    expect(findShowcaseCity("cowansville")?.region).toBe("Estrie");
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
    expect(matchShowcaseCity("saint-lin-laurentides")?.key).toBe("saintlinlaurentides");
    expect(matchShowcaseCity("Toronto")).toBeNull();
    expect(matchShowcaseCity("")).toBeNull();
    expect(matchShowcaseCity(null)).toBeNull();
  });
});

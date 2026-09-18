import { describe, expect, it } from "vitest";
import {
  SHOWCASE_SECTION_KEYS,
  SHOWCASE_TEXT_DEFAULTS,
  SHOWCASE_TEXT_GROUPS,
  SHOWCASE_TEXT_KEYS,
  SHOWCASE_TEXT_LIMITS,
  aboutHeadingMessage,
  layoutChoicesOf,
  resolveSectionOrder,
  visibleSections,
  type ShowcaseSectionKey,
} from "@/lib/showcase-customization";
import { changedShowcaseFields, normalizeShowcaseDraft } from "@/lib/showcase-workflow";
import { VITRINE_NAV_TEXT } from "@/lib/showcase-vitrine";
import fr from "../../messages/fr.json";
import en from "../../messages/en.json";

const ALL_AVAILABLE = Object.fromEntries(SHOWCASE_SECTION_KEYS.map((key) => [key, true])) as Record<ShowcaseSectionKey, boolean>;

describe("section order and visibility", () => {
  it("keeps a saved order, drops unknown or repeated keys, and appends the sections it lacks", () => {
    expect(resolveSectionOrder(["products", "about", "bogus", "about"])).toEqual([
      "products",
      "about",
      "approach",
      "expertises",
      "articles",
    ]);
    expect(resolveSectionOrder(undefined)).toEqual([...SHOWCASE_SECTION_KEYS]);
  });

  it("draws a section only when it has something to show and is not hidden", () => {
    expect(visibleSections(["articles", "about"], ["about"], { ...ALL_AVAILABLE, products: false })).toEqual([
      "articles",
      "approach",
      "expertises",
    ]);
  });
});


describe("aboutHeadingMessage", () => {
  it("names the title and the years when the profile has both, the title alone without years", () => {
    expect(aboutHeadingMessage({ title: "Psychologue", years: 12, name: "Léo Barnabé" })).toEqual({
      key: "vitrine.about.headingYears",
      values: { title: "Psychologue", years: 12 },
    });
    for (const years of [null, 0]) {
      expect(aboutHeadingMessage({ title: "Psychologue", years, name: "Léo Barnabé" })).toEqual({
        key: "vitrine.about.heading",
        values: { title: "Psychologue" },
      });
    }
  });

  it("uses the name only without a title (the editor's hint once promised the name with a title on the page)", () => {
    expect(aboutHeadingMessage({ title: null, years: 12, name: "Léo Barnabé" })).toEqual({
      key: "vitrine.about.headingNoTitle",
      values: { name: "Léo Barnabé" },
    });
  });

  it("names no city, in either language — « Psychologue depuis 26 ans », not « …, à Québec »", () => {
    for (const [language, messages] of [["fr", fr], ["en", en]] as const) {
      const about = messages.Showcase.vitrine.about as Record<string, string>;
      for (const key of ["heading", "headingYears", "headingNoTitle"]) {
        expect(about[key], `${language}: vitrine.about.${key}`).not.toContain("{city}");
      }
    }
  });
});

describe("layoutChoicesOf", () => {
  it("replaces anything unknown with the page's default", () => {
    expect(
      layoutChoicesOf({
        sectionOrder: [],
        hiddenSections: ["slots", "expertises", "x"],
        accent: "neon",
      }),
    ).toEqual({
      sectionOrder: [...SHOWCASE_SECTION_KEYS],
      hiddenSections: ["expertises"],
      accent: "teal",
    });
    expect(layoutChoicesOf(undefined).accent).toBe("teal");
    expect(layoutChoicesOf({ accent: "plum" }).accent).toBe("plum");
  });
});

describe("normalizeShowcaseDraft: the page's customization", () => {
  const save = (body: Record<string, unknown>) => normalizeShowcaseDraft(body, new Set(), "professional");

  it("stores only the texts written in French, each on one line, and never an unknown key", () => {
    expect(
      save({
        texts: {
          approachTitle: { fr: "  Ma  façon\nde travailler ", en: "" },
          disposTitle: { fr: "", en: "Only English" },
          bogus: { fr: "POISON", en: "" },
        },
      }),
    ).toEqual({ ok: true, set: { "draft.texts": { approachTitle: { fr: "Ma façon de travailler", en: "" } } }, unset: [] });
  });

  it("refuses a text too long or malformed, naming it", () => {
    expect(save({ texts: { aboutTitle: { fr: "x".repeat(SHOWCASE_TEXT_LIMITS.aboutTitle + 1), en: "" } } })).toMatchObject({
      ok: false,
      code: "TOO_LONG",
      field: "texts.aboutTitle.fr",
    });
    expect(save({ texts: { aboutTitle: "plain" } })).toMatchObject({ ok: false, code: "INVALID_FIELD", field: "texts.aboutTitle" });
    expect(save({ texts: [] })).toMatchObject({ ok: false, code: "INVALID_FIELD", field: "texts" });
  });

  it("stores a new order, and none for the default one", () => {
    const moved = ["products", ...SHOWCASE_SECTION_KEYS.filter((key) => key !== "products")];
    expect(save({ sectionOrder: moved })).toMatchObject({ ok: true, set: { "draft.sectionOrder": moved } });
    expect(save({ sectionOrder: [...SHOWCASE_SECTION_KEYS] })).toMatchObject({ ok: true, set: { "draft.sectionOrder": [] } });
    for (const bad of [["about", "about"], ["nope"], "about"]) {
      expect(save({ sectionOrder: bad })).toMatchObject({ ok: false, code: "INVALID_FIELD", field: "sectionOrder" });
    }
  });

  it("hides sections in the page's order, and refuses a key it does not know", () => {
    expect(save({ hiddenSections: ["products", "expertises"] })).toMatchObject({
      ok: true,
      set: { "draft.hiddenSections": ["expertises", "products"] },
    });
    expect(save({ hiddenSections: ["bogus"] })).toMatchObject({ ok: false, field: "hiddenSections" });
  });

  it("takes a colour from the palette, storing none for the default", () => {
    expect(save({ accent: "plum" })).toMatchObject({ ok: true, set: { "draft.accent": "plum" } });
    expect(save({ accent: "teal" })).toMatchObject({ ok: true, set: { "draft.accent": "" } });
    expect(save({ accent: "" })).toMatchObject({ ok: true, set: { "draft.accent": "" } });
    expect(save({ accent: "#ff0000" })).toMatchObject({ ok: false, code: "INVALID_FIELD", field: "accent" });
  });

});

describe("changedShowcaseFields: the page's customization", () => {
  it("sees no change when the editor sends nothing chosen over a page that never chose anything", () => {
    expect(
      changedShowcaseFields({}, { texts: {}, sectionOrder: [], hiddenSections: [], accent: "", ambience: {} }),
    ).toEqual([]);
  });

  it("names the choices that change", () => {
    expect(changedShowcaseFields({ accent: "" }, { accent: "plum", texts: { aboutTitle: { fr: "Venez", en: "" } } })).toEqual([
      "accent",
      "texts",
    ]);
  });
});

/**
 * Every heading a page shows is the professional's to rewrite (owner, 2026-09-18): each section's
 * name — its dock entry too — « En bref », « Parcours », « Motifs de consultation », and the
 * « Disponibilités » title and text. A blank one keeps the page's own wording.
 */
describe("the texts a professional can rewrite", () => {
  const save = (body: Record<string, unknown>) => normalizeShowcaseDraft(body, new Set(), "professional");
  const at = (messages: unknown, path: string) =>
    path.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

  it("lists each text in exactly one section of the editor", () => {
    const grouped = SHOWCASE_TEXT_GROUPS.flatMap((group) => group.keys);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...SHOWCASE_TEXT_KEYS].sort());
  });

  it("gives every text a limit, the page's wording as its default and an editor label, in both languages", () => {
    for (const key of SHOWCASE_TEXT_KEYS) {
      expect(SHOWCASE_TEXT_LIMITS[key], key).toBeGreaterThan(0);
      for (const [language, messages] of [["fr", fr], ["en", en]] as const) {
        expect(typeof at(messages, `Showcase.${SHOWCASE_TEXT_DEFAULTS[key]}`), `${language}: default of ${key}`).toBe("string");
        expect(typeof at(messages, `ShowcasePro.customize.texts.${key}`), `${language}: label of ${key}`).toBe("string");
      }
    }
    for (const { group } of SHOWCASE_TEXT_GROUPS) {
      expect(typeof at(fr, `ShowcasePro.customize.groups.${group}`)).toBe("string");
      expect(typeof at(en, `ShowcasePro.customize.groups.${group}`)).toBe("string");
    }
  });

  it("keeps every section's name short enough for the dock", () => {
    for (const key of Object.values(VITRINE_NAV_TEXT)) expect(SHOWCASE_TEXT_LIMITS[key], key).toBeLessThanOrEqual(30);
  });

  it("stores a section's name and the « Disponibilités » texts, and refuses a name too long for the dock", () => {
    expect(
      save({
        texts: {
          aboutLabel: { fr: " Qui  suis-je ", en: "Who I am" },
          availabilityTitle: { fr: "Prendre rendez-vous avec moi", en: "" },
          themesTitle: { fr: "Ce dont on peut parler", en: "" },
        },
      }),
    ).toEqual({
      ok: true,
      set: {
        "draft.texts": {
          aboutLabel: { fr: "Qui suis-je", en: "Who I am" },
          availabilityTitle: { fr: "Prendre rendez-vous avec moi", en: "" },
          themesTitle: { fr: "Ce dont on peut parler", en: "" },
        },
      },
      unset: [],
    });
    expect(save({ texts: { productsLabel: { fr: "x".repeat(31), en: "" } } })).toMatchObject({
      ok: false,
      code: "TOO_LONG",
      field: "texts.productsLabel.fr",
    });
  });
});

describe("visibleSections with a forced section (team resources, 2026-09-18)", () => {
  const hiddenProducts = ["products"];

  it("shows a forced section the professional hid, in its place", () => {
    expect(visibleSections(["products", "about"], hiddenProducts, ALL_AVAILABLE, ["products"])).toEqual([
      "products",
      "about",
      "approach",
      "expertises",
      "articles",
    ]);
    expect(visibleSections(["products", "about"], hiddenProducts, ALL_AVAILABLE)).not.toContain("products");
  });

  it("never draws a forced section with nothing to show", () => {
    expect(visibleSections(undefined, [], { ...ALL_AVAILABLE, products: false }, ["products"])).not.toContain("products");
  });
});

import { TALL_AMBIENCE_IMAGES, WIDE_AMBIENCE_IMAGES } from "@/lib/showcase-imagery";

/**
 * What a professional makes their own on their page (spec 003, 2026-09-15),
 * beyond the content: section titles and intros, which optional sections show
 * and in which order, an accent colour from an approved palette, and the
 * ambience photos. Constants and pure helpers, client-safe: the draft rules
 * (showcase-workflow) clean what is saved, showcase-public reads it back, and
 * anything unknown falls back to the page's default.
 */

// ------------------------------------------------------------------- texts

export const SHOWCASE_TEXT_KEYS = [
  "aboutTitle",
  "approachTitle",
  "methodsTitle",
  "stepsTitle",
  "valuesTitle",
  "valuesIntro",
  "servicesTitle",
  "servicesIntro",
  "standardPoint",
  "quickPoint",
  "disposTitle",
  "disposIntro",
  "expertisesTitle",
  "expertisesIntro",
  "productsTitle",
  "articlesTitle",
  "ctaTitle",
  "ctaBody",
] as const;
export type ShowcaseTextKey = (typeof SHOWCASE_TEXT_KEYS)[number];

const TITLE = 90;
const INTRO = 300;
const POINT = 160;

/** Each text is a single line; titles are short, intros a sentence or two. */
export const SHOWCASE_TEXT_LIMITS: Readonly<Record<ShowcaseTextKey, number>> = {
  aboutTitle: TITLE,
  approachTitle: TITLE,
  methodsTitle: TITLE,
  stepsTitle: TITLE,
  valuesTitle: TITLE,
  valuesIntro: INTRO,
  servicesTitle: TITLE,
  servicesIntro: INTRO,
  standardPoint: POINT,
  quickPoint: POINT,
  disposTitle: TITLE,
  disposIntro: INTRO,
  expertisesTitle: TITLE,
  expertisesIntro: INTRO,
  productsTitle: TITLE,
  articlesTitle: TITLE,
  ctaTitle: TITLE,
  ctaBody: INTRO,
};

/** The page's own wording a blank text keeps (Showcase messages), shown as the editor's placeholder. */
export const SHOWCASE_TEXT_DEFAULTS: Readonly<Record<ShowcaseTextKey, string>> = {
  aboutTitle: "vitrine.about.headingNoTitle",
  approachTitle: "vitrine.approach.title",
  methodsTitle: "vitrine.approach.methodsTitle",
  stepsTitle: "vitrine.approach.stepsTitle",
  valuesTitle: "vitrine.values.title",
  valuesIntro: "vitrine.values.intro",
  servicesTitle: "vitrine.services.title",
  servicesIntro: "vitrine.services.intro",
  standardPoint: "vitrine.services.standardPoint",
  quickPoint: "vitrine.services.quickPoint",
  disposTitle: "vitrine.dispos.title",
  disposIntro: "vitrine.dispos.intro",
  expertisesTitle: "vitrine.expertisesTitle",
  expertisesIntro: "vitrine.expertisesIntro",
  productsTitle: "vitrine.products.title",
  articlesTitle: "vitrine.articles.title",
  ctaTitle: "vitrine.cta.title",
  ctaBody: "vitrine.cta.body",
};

// ---------------------------------------------------------------- sections

/** The sections below the image band, in the page's default order. */
export const SHOWCASE_SECTION_KEYS = [
  "about",
  "approach",
  "values",
  "services",
  "slots",
  "expertises",
  "products",
  "articles",
  "cta",
] as const;
export type ShowcaseSectionKey = (typeof SHOWCASE_SECTION_KEYS)[number];

/** Prices and booking are how a client reaches the professional: they cannot be hidden. */
export const REQUIRED_SHOWCASE_SECTIONS: ReadonlySet<ShowcaseSectionKey> = new Set(["services", "slots"]);
export const HIDEABLE_SHOWCASE_SECTIONS: readonly ShowcaseSectionKey[] = SHOWCASE_SECTION_KEYS.filter(
  (key) => !REQUIRED_SHOWCASE_SECTIONS.has(key),
);

export function isShowcaseSectionKey(value: unknown): value is ShowcaseSectionKey {
  return typeof value === "string" && (SHOWCASE_SECTION_KEYS as readonly string[]).includes(value);
}

/** A saved order, known keys once each, followed by any section it does not name, in the default order. */
export function resolveSectionOrder(order: readonly unknown[] | null | undefined): ShowcaseSectionKey[] {
  const seen = new Set<ShowcaseSectionKey>();
  for (const key of order ?? []) if (isShowcaseSectionKey(key)) seen.add(key);
  return [...seen, ...SHOWCASE_SECTION_KEYS.filter((key) => !seen.has(key))];
}

/** The sections a page draws, in order: those with something to show that are not hidden (the required ones always). */
export function visibleSections(
  order: readonly unknown[] | null | undefined,
  hidden: readonly unknown[] | null | undefined,
  available: Readonly<Record<ShowcaseSectionKey, boolean>>,
): ShowcaseSectionKey[] {
  const hiddenKeys = new Set((hidden ?? []).filter(isShowcaseSectionKey));
  return resolveSectionOrder(order).filter(
    (key) => available[key] && (REQUIRED_SHOWCASE_SECTIONS.has(key) || !hiddenKeys.has(key)),
  );
}

/**
 * The approach section's headings. With no approach text it shows only the request steps, under
 * the steps title; a title the professional wrote for the section still heads it, steps below.
 */
export function approachHeadings(input: { hasApproachText: boolean; customApproachTitle: string }): {
  title: "approach" | "steps";
  stepsSubheading: boolean;
} {
  const titled = input.hasApproachText || input.customApproachTitle.trim().length > 0;
  return { title: titled ? "approach" : "steps", stepsSubheading: titled };
}

export type AboutHeadingMessage =
  | { key: "vitrine.about.headingYears"; values: { title: string; years: number; city: string } }
  | { key: "vitrine.about.heading"; values: { title: string; city: string } }
  | { key: "vitrine.about.headingNoTitle"; values: { name: string; city: string } };

/**
 * The « À propos » title a page shows when the professional wrote none (Showcase messages). One rule
 * for the page and for the editor's grey hint, so the hint never promises another wording.
 */
export function aboutHeadingMessage(input: {
  title: string | null;
  years: number | null;
  name: string;
  city: string;
}): AboutHeadingMessage {
  if (!input.title) return { key: "vitrine.about.headingNoTitle", values: { name: input.name, city: input.city } };
  if (input.years !== null && input.years > 0) {
    return { key: "vitrine.about.headingYears", values: { title: input.title, years: input.years, city: input.city } };
  }
  return { key: "vitrine.about.heading", values: { title: input.title, city: input.city } };
}

// ------------------------------------------------------------------ colour

/** The approved accents: each dark enough for white text, with a darker hover and a soft tint. */
export const SHOWCASE_ACCENTS = {
  teal: { accent: "#17505F", dark: "#0E3A46", soft: "#E6EFEA" },
  forest: { accent: "#2F5D46", dark: "#1F4231", soft: "#E4EEE6" },
  ocean: { accent: "#1F4E79", dark: "#153757", soft: "#E3ECF5" },
  plum: { accent: "#5B3E6B", dark: "#412C4D", soft: "#EFE7F3" },
  terracotta: { accent: "#8A4B32", dark: "#653522", soft: "#F4E8E1" },
} as const;
export type ShowcaseAccentKey = keyof typeof SHOWCASE_ACCENTS;
export const SHOWCASE_ACCENT_KEYS = Object.keys(SHOWCASE_ACCENTS) as ShowcaseAccentKey[];
export const DEFAULT_SHOWCASE_ACCENT: ShowcaseAccentKey = "teal";

export function isShowcaseAccentKey(value: unknown): value is ShowcaseAccentKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SHOWCASE_ACCENTS, value);
}

// ------------------------------------------------------------------ photos

export const SHOWCASE_AMBIENCE_SLOTS = ["band", "about", "closing"] as const;
export type ShowcaseAmbienceSlot = (typeof SHOWCASE_AMBIENCE_SLOTS)[number];

/** The library photos a slot may show: landscape for the wide bands, portrait beside « À propos ». */
export function ambienceChoicesFor(slot: ShowcaseAmbienceSlot): readonly string[] {
  return slot === "about" ? TALL_AMBIENCE_IMAGES : WIDE_AMBIENCE_IMAGES;
}

export function isAmbienceChoice(slot: ShowcaseAmbienceSlot, value: unknown): value is string {
  return typeof value === "string" && ambienceChoicesFor(slot).includes(value);
}

// ------------------------------------------------------------------ reading

export interface ShowcaseLayoutChoices {
  sectionOrder: ShowcaseSectionKey[];
  hiddenSections: ShowcaseSectionKey[];
  accent: ShowcaseAccentKey;
  ambience: Partial<Record<ShowcaseAmbienceSlot, string>>;
}

/** A stored copy's layout choices, anything unknown replaced by the default. */
export function layoutChoicesOf(
  source:
    | {
        sectionOrder?: readonly unknown[] | null;
        hiddenSections?: readonly unknown[] | null;
        accent?: unknown;
        ambience?: Partial<Record<ShowcaseAmbienceSlot, unknown>> | null;
      }
    | null
    | undefined,
): ShowcaseLayoutChoices {
  const hidden = source?.hiddenSections ?? [];
  const accent = source?.accent;
  const ambience: Partial<Record<ShowcaseAmbienceSlot, string>> = {};
  for (const slot of SHOWCASE_AMBIENCE_SLOTS) {
    const value = source?.ambience?.[slot];
    if (isAmbienceChoice(slot, value)) ambience[slot] = value;
  }
  return {
    sectionOrder: resolveSectionOrder(source?.sectionOrder),
    hiddenSections: HIDEABLE_SHOWCASE_SECTIONS.filter((key) => hidden.includes(key)),
    accent: isShowcaseAccentKey(accent) ? accent : DEFAULT_SHOWCASE_ACCENT,
    ambience,
  };
}

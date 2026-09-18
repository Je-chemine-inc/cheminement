
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
  "expertisesTitle",
  "expertisesIntro",
  "productsTitle",
  "articlesTitle",
] as const;
export type ShowcaseTextKey = (typeof SHOWCASE_TEXT_KEYS)[number];

const TITLE = 90;
const INTRO = 300;

/** Each text is a single line; titles are short, intros a sentence or two. */
export const SHOWCASE_TEXT_LIMITS: Readonly<Record<ShowcaseTextKey, number>> = {
  aboutTitle: TITLE,
  approachTitle: TITLE,
  methodsTitle: TITLE,
  expertisesTitle: TITLE,
  expertisesIntro: INTRO,
  productsTitle: TITLE,
  articlesTitle: TITLE,
};

/** The page's own wording a blank text keeps (Showcase messages), shown as the editor's placeholder. */
export const SHOWCASE_TEXT_DEFAULTS: Readonly<Record<ShowcaseTextKey, string>> = {
  aboutTitle: "vitrine.about.headingNoTitle",
  approachTitle: "vitrine.approach.title",
  methodsTitle: "vitrine.approach.methodsTitle",
  expertisesTitle: "vitrine.expertisesTitle",
  expertisesIntro: "vitrine.expertisesIntro",
  productsTitle: "vitrine.products.title",
  articlesTitle: "vitrine.articles.title",
};

// ---------------------------------------------------------------- sections

/** The sections below the image band, in the page's default order. */
export const SHOWCASE_SECTION_KEYS = [
  "about",
  "approach",
  "expertises",
  "products",
  "articles",
] as const;
export type ShowcaseSectionKey = (typeof SHOWCASE_SECTION_KEYS)[number];

/** Every section can be hidden: a client reaches the professional through Je chemine's funnel, which
 * the page's buttons lead to whatever the professional shows. */
export const REQUIRED_SHOWCASE_SECTIONS: ReadonlySet<ShowcaseSectionKey> = new Set();
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
 * The « À propos » title's message and its values. No city: « Psychologue depuis 26 ans », not
 * « …, à Québec » (owner, 2026-09-18) — the office address says less than it seems to for someone
 * who sees people remotely across Québec, and the city already sits in the page's title for search.
 */
export type AboutHeadingMessage =
  | { key: "vitrine.about.headingYears"; values: { title: string; years: number } }
  | { key: "vitrine.about.heading"; values: { title: string } }
  | { key: "vitrine.about.headingNoTitle"; values: { name: string } };

/**
 * The « À propos » title a page shows when the professional wrote none (Showcase messages). One rule
 * for the page and for the editor's grey hint, so the hint never promises another wording.
 */
export function aboutHeadingMessage(input: {
  title: string | null;
  years: number | null;
  name: string;
}): AboutHeadingMessage {
  if (!input.title) return { key: "vitrine.about.headingNoTitle", values: { name: input.name } };
  if (input.years !== null && input.years > 0) {
    return { key: "vitrine.about.headingYears", values: { title: input.title, years: input.years } };
  }
  return { key: "vitrine.about.heading", values: { title: input.title } };
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

// ------------------------------------------------------------------ reading

export interface ShowcaseLayoutChoices {
  sectionOrder: ShowcaseSectionKey[];
  hiddenSections: ShowcaseSectionKey[];
  accent: ShowcaseAccentKey;
}

/** A stored copy's layout choices, anything unknown replaced by the default. */
export function layoutChoicesOf(
  source:
    | {
        sectionOrder?: readonly unknown[] | null;
        hiddenSections?: readonly unknown[] | null;
        accent?: unknown;
      }
    | null
    | undefined,
): ShowcaseLayoutChoices {
  const hidden = source?.hiddenSections ?? [];
  const accent = source?.accent;
  return {
    sectionOrder: resolveSectionOrder(source?.sectionOrder),
    hiddenSections: HIDEABLE_SHOWCASE_SECTIONS.filter((key) => hidden.includes(key)),
    accent: isShowcaseAccentKey(accent) ? accent : DEFAULT_SHOWCASE_ACCENT,
  };
}

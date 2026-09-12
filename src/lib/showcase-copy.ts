import "server-only";
import { getTranslations } from "next-intl/server";
import type { ShowcaseCard, ShowcaseLocale } from "@/lib/showcase-public";
import { headingTitleKeys, titlesPhrase, type CatalogExpertise } from "@/lib/showcase-seo";

/**
 * Wording shared by the search pages of spec 003 (city, expertise, region).
 */

/**
 * « psychologues et psychothérapeutes » for the professionals listed, or null
 * when the generic wording must be used (see headingTitleKeys).
 */
export async function showcaseTitlesPhrase(
  cards: readonly Pick<ShowcaseCard, "title">[],
  locale: ShowcaseLocale,
): Promise<string | null> {
  const keys = headingTitleKeys(cards.map((card) => card.title));
  if (!keys) return null;
  const t = await getTranslations("Showcase.titlesPlural");
  return titlesPhrase(keys, (key) => t(key), locale);
}

export function expertiseLabel(
  expertise: Pick<CatalogExpertise, "labelFr" | "labelEn">,
  locale: ShowcaseLocale,
): string {
  return locale === "en" && expertise.labelEn ? expertise.labelEn : expertise.labelFr;
}

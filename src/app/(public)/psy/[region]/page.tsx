import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { findShowcaseRegion } from "@/lib/showcase-cities";
import { SHOWCASE_HUB_PATH, absoluteShowcaseUrl, canonicalSiteUrl } from "@/lib/showcase-hosts";
import { hubPageMetadata } from "@/lib/showcase-metadata";
import { listPublishedShowcaseCards, loadShowcaseDirectory } from "@/lib/showcase-queries";
import type { ShowcaseLocale } from "@/lib/showcase-public";
import { breadcrumbJsonLd, capitalizeFirst, countByCity, itemListJsonLd, summarizeRegions } from "@/lib/showcase-seo";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { showcaseTitlesPhrase } from "@/lib/showcase-copy";
import { ShowcaseCardList } from "@/components/showcase/ShowcaseCardList";
import { ShowcaseMatchBand } from "@/components/showcase/ShowcaseMatchBand";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

/**
 * www.jechemine.ca/psy/<region> — a region's cities and the professionals
 * presented there (spec 003), each linked to its city host. Not found while
 * the pages are off or for an unknown region; out of search results while
 * nobody is presented in the region.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ region: string }> };
type Translate = (key: string, values?: Record<string, string | number>) => string;

async function currentLocale(): Promise<ShowcaseLocale> {
  return (await getLocale()) === "en" ? "en" : "fr";
}

const loadRegionPage = cache(async (key: string, locale: ShowcaseLocale) => {
  if (!(await isShowcaseEnabled())) return null;
  const region = findShowcaseRegion(key);
  if (!region) return null;
  const summary = summarizeRegions(countByCity(await loadShowcaseDirectory())).find(
    (candidate) => candidate.region.key === region.key,
  );
  if (!summary) return null;
  const cards =
    summary.total > 0 ? await listPublishedShowcaseCards(summary.cities.map((entry) => entry.city.key), locale) : [];
  const tShowcase = await getTranslations("Showcase");
  return {
    summary,
    cards,
    titles: await showcaseTitlesPhrase(cards, locale),
    // « dans Lanaudière », « en Mauricie », « à Laval »: each region its own preposition.
    regionIn: tShowcase(`regionIn.${region.key}`),
  };
});

function headingOf(t: Translate, regionIn: string, titles: string | null, locale: ShowcaseLocale): string {
  return titles
    ? capitalizeFirst(t("region.heading", { titles, regionIn }), locale)
    : t("region.title", { regionIn });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { region: key } = await params;
  const locale = await currentLocale();
  const data = await loadRegionPage(key, locale);
  if (!data) return {};
  const t = await getTranslations("ShowcaseHub");
  return hubPageMetadata({
    path: `${SHOWCASE_HUB_PATH}/${data.summary.region.key}`,
    title: headingOf(t, data.regionIn, data.titles, locale),
    description: t("region.metaDescription", { regionIn: data.regionIn }),
    index: data.summary.total > 0,
  });
}

export default async function ShowcaseRegionPage({ params }: Params) {
  const { region: key } = await params;
  const locale = await currentLocale();
  const data = await loadRegionPage(key, locale);
  if (!data) notFound();
  const { summary, cards, titles, regionIn } = data;
  const t = await getTranslations("ShowcaseHub");
  const heading = headingOf(t, regionIn, titles, locale);
  const hubUrl = canonicalSiteUrl(SHOWCASE_HUB_PATH);
  const regionUrl = canonicalSiteUrl(`${SHOWCASE_HUB_PATH}/${summary.region.key}`);

  return (
    <>
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: t("breadcrumbQuebec"), url: hubUrl },
          { name: summary.region.name, url: regionUrl },
        ])}
      />
      {summary.cities.length > 0 ? (
        <JsonLdScript
          data={itemListJsonLd(
            heading,
            summary.cities.map(({ city }) => ({ name: city.name, url: absoluteShowcaseUrl(city.key, "/") })),
          )}
        />
      ) : null}

      <section className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto max-w-6xl px-4 py-14 md:py-20">
          <nav aria-label={t("breadcrumbLabel")} className="text-xs text-muted-foreground">
            <Link href={SHOWCASE_HUB_PATH} className="hover:text-foreground hover:underline">
              {t("breadcrumbQuebec")}
            </Link>
          </nav>
          <h1 className="mt-4 max-w-3xl font-serif text-3xl font-light leading-tight text-foreground md:text-5xl">
            {heading}
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            {summary.total > 0 ? t("region.intro", { regionIn }) : t("region.empty", { regionIn })}
          </p>
        </div>
      </section>

      {summary.cities.length > 0 ? (
        <section className="container mx-auto max-w-6xl px-4 pt-12" aria-labelledby="region-cities">
          <h2 id="region-cities" className="font-serif text-2xl font-light text-foreground">
            {t("region.citiesTitle")}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.cities.map(({ city, count }) => (
              <li key={city.key}>
                <a
                  href={absoluteShowcaseUrl(city.key, "/")}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-foreground transition-colors hover:border-primary"
                >
                  <span>{city.name}</span>
                  <span className="text-xs text-muted-foreground">{t("regionCount", { count })}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cards.length > 0 ? (
        <section className="container mx-auto max-w-6xl px-4 py-12" aria-labelledby="region-professionals">
          <h2 id="region-professionals" className="font-serif text-2xl font-light text-foreground">
            {t("region.professionalsTitle")}
          </h2>
          <div className="mt-6">
            <ShowcaseCardList cards={cards} absolute />
          </div>
        </section>
      ) : null}

      <section className="container mx-auto max-w-6xl px-4 pb-12">
        <Link href={SHOWCASE_HUB_PATH} className="text-sm text-primary hover:underline">
          {t("region.back")}
        </Link>
      </section>

      <ShowcaseMatchBand href="/appointment?from=showcase" />
    </>
  );
}

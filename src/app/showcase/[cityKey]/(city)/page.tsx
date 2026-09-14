import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { SHOWCASE_HUB_PATH, absoluteShowcaseUrl, canonicalSiteUrl } from "@/lib/showcase-hosts";
import { showcasePageMetadata } from "@/lib/showcase-metadata";
import { listPublishedShowcaseCards, loadShowcaseCatalog, loadShowcaseDirectory } from "@/lib/showcase-queries";
import type { ShowcaseLocale } from "@/lib/showcase-public";
import {
  breadcrumbJsonLd,
  capitalizeFirst,
  countByCity,
  decideCityPage,
  expertisesInCity,
  nearbyCities,
} from "@/lib/showcase-seo";
import { expertiseLabel, showcaseTitlesPhrase } from "@/lib/showcase-copy";
import { ShowcaseBeacon } from "@/components/showcase/ShowcaseBeacon";
import { ShowcaseCardList } from "@/components/showcase/ShowcaseCardList";
import { ShowcaseFaq } from "@/components/showcase/ShowcaseFaq";
import { ShowcaseMatchBand } from "@/components/showcase/ShowcaseMatchBand";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

/**
 * psy<city>.jechemine.ca/ — the city's page (spec 003): who is presented,
 * their expertises, the nearby cities of the region, frequent questions.
 * Indexed only with a professional presented here; served out of search
 * results while the region has some; otherwise the visitor goes to the
 * region's page on www (decideCityPage).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cityKey: string }> };

async function currentLocale(): Promise<ShowcaseLocale> {
  return (await getLocale()) === "en" ? "en" : "fr";
}

const loadCityPage = cache(async (cityKey: string, locale: ShowcaseLocale) => {
  const city = findShowcaseCity(cityKey);
  if (!city) return null;
  const [cards, directory, catalog] = await Promise.all([
    listPublishedShowcaseCards(cityKey, locale),
    loadShowcaseDirectory(),
    loadShowcaseCatalog(),
  ]);
  const nearby = nearbyCities(city, countByCity(directory));
  const elsewhere = nearby.reduce((sum, entry) => sum + entry.count, 0);
  return {
    city,
    cards,
    nearby,
    expertises: expertisesInCity(directory, catalog, cityKey),
    decision: decideCityPage(cards.length, elsewhere),
    titles: await showcaseTitlesPhrase(cards, locale),
  };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cityKey } = await params;
  const locale = await currentLocale();
  const data = await loadCityPage(cityKey, locale);
  if (!data) return {};
  const tCity = await getTranslations("Showcase.city");
  const { city } = data;
  return showcasePageMetadata({
    cityKey,
    path: "/",
    title: data.titles
      ? capitalizeFirst(tCity("heading", { titles: data.titles, city: city.name }), locale)
      : tCity("title", { city: city.name }),
    description: tCity("metaDescription", { city: city.name, region: city.region }),
    index: data.decision === "index",
  });
}

export default async function ShowcaseCityPage({ params }: Params) {
  const { cityKey } = await params;
  const locale = await currentLocale();
  const data = await loadCityPage(cityKey, locale);
  if (!data) notFound();
  const { city, cards, nearby, expertises, decision, titles } = data;
  const regionUrl = canonicalSiteUrl(`${SHOWCASE_HUB_PATH}/${city.regionKey}`);
  if (decision === "redirect-region") redirect(regionUrl);

  const t = await getTranslations("Showcase");
  // « dans Lanaudière », « en Mauricie », « à Laval »: each region its own preposition.
  const regionIn = t(`regionIn.${city.regionKey}`);
  const hubUrl = canonicalSiteUrl(SHOWCASE_HUB_PATH);
  const heading = titles
    ? capitalizeFirst(t("city.heading", { titles, city: city.name }), locale)
    : t("city.title", { city: city.name });

  return (
    <>
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: t("breadcrumb.quebec"), url: hubUrl },
          { name: city.region, url: regionUrl },
          { name: city.name, url: absoluteShowcaseUrl(city.key, "/") },
        ])}
      />
      <ShowcaseBeacon city={city.key} />

      <section className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto max-w-6xl px-4 py-14 md:py-20">
          <nav aria-label={t("breadcrumb.label")} className="text-xs text-muted-foreground">
            <a href={hubUrl} className="hover:text-foreground hover:underline">
              {t("breadcrumb.quebec")}
            </a>
            <span aria-hidden="true"> / </span>
            <a href={regionUrl} className="hover:text-foreground hover:underline">
              {city.region}
            </a>
          </nav>
          <h1 className="mt-4 max-w-3xl font-serif text-3xl font-light leading-tight text-foreground md:text-5xl">
            {heading}
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            {cards.length > 0
              ? t("city.intro", { city: city.name, regionIn })
              : t("city.introEmpty", { city: city.name, regionIn })}
          </p>
          {cards.length > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("city.count", { count: cards.length })}</p>
          ) : null}
        </div>
      </section>

      {cards.length > 0 ? (
        <section className="container mx-auto max-w-6xl px-4 py-12" aria-labelledby="city-professionals">
          <h2 id="city-professionals" className="sr-only">
            {t("city.professionalsTitle", { city: city.name })}
          </h2>
          <ShowcaseCardList cards={cards} />
        </section>
      ) : null}

      {expertises.length > 0 ? (
        <section className="container mx-auto max-w-6xl px-4 pb-12" aria-labelledby="city-expertises">
          <h2 id="city-expertises" className="font-serif text-2xl font-light text-foreground">
            {t("city.expertisesTitle", { city: city.name })}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {expertises.map(({ expertise, count }) => (
              <li key={expertise.slug}>
                <Link
                  href={`/specialite/${expertise.slug}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary"
                >
                  {expertiseLabel(expertise, locale)}
                  <span className="text-xs text-muted-foreground">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {nearby.length > 0 ? (
        <section className="container mx-auto max-w-6xl px-4 pb-12" aria-labelledby="city-nearby">
          <h2 id="city-nearby" className="font-serif text-2xl font-light text-foreground">
            {t("city.nearbyTitle", { regionIn })}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nearby.map(({ city: other, count }) => (
              <li key={other.key}>
                <a
                  href={absoluteShowcaseUrl(other.key, "/")}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-foreground transition-colors hover:border-primary"
                >
                  <span>{other.name}</span>
                  <span className="text-xs text-muted-foreground">{t("city.count", { count })}</span>
                </a>
              </li>
            ))}
          </ul>
          <a href={regionUrl} className="mt-4 inline-flex text-sm text-primary hover:underline">
            {t("city.regionLink", { regionIn })}
          </a>
        </section>
      ) : null}

      <ShowcaseFaq city={city.name} offersVideo={cards.some((card) => card.modalities.includes("video"))} />
      <ShowcaseMatchBand href={canonicalSiteUrl(`/appointment?from=showcase&city=${encodeURIComponent(city.key)}`)} />
    </>
  );
}

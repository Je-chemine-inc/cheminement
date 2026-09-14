import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { absoluteShowcaseUrl, canonicalSiteUrl } from "@/lib/showcase-hosts";
import { showcasePageMetadata } from "@/lib/showcase-metadata";
import { listPublishedShowcaseCards, loadShowcaseCatalog, loadShowcaseDirectory } from "@/lib/showcase-queries";
import type { ShowcaseLocale } from "@/lib/showcase-public";
import { breadcrumbJsonLd, capitalizeFirst, expertisesInCity } from "@/lib/showcase-seo";
import { expertiseLabel, showcaseTitlesPhrase } from "@/lib/showcase-copy";
import { ShowcaseBeacon } from "@/components/showcase/ShowcaseBeacon";
import { ShowcaseCardList } from "@/components/showcase/ShowcaseCardList";
import { ShowcaseFaq } from "@/components/showcase/ShowcaseFaq";
import { ShowcaseMatchBand } from "@/components/showcase/ShowcaseMatchBand";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

/**
 * psy<city>.jechemine.ca/specialite/<expertise> — the professionals of a city
 * who carry an expertise (spec 003). A real 404 unless the expertise is
 * offered on pages AND someone in this city carries it: no empty page exists
 * to be indexed.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cityKey: string; expertise: string }> };

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function currentLocale(): Promise<ShowcaseLocale> {
  return (await getLocale()) === "en" ? "en" : "fr";
}

const loadExpertisePage = cache(async (cityKey: string, slug: string, locale: ShowcaseLocale) => {
  const city = findShowcaseCity(cityKey);
  if (!city || !SLUG_FORMAT.test(slug)) return null;
  const [catalog, directory] = await Promise.all([loadShowcaseCatalog(), loadShowcaseDirectory()]);
  const expertise = catalog.find((item) => item.slug === slug);
  if (!expertise) return null;
  const cards = await listPublishedShowcaseCards(cityKey, locale, { expertiseSlug: slug });
  if (cards.length === 0) return null;
  return {
    city,
    expertise,
    cards,
    others: expertisesInCity(directory, catalog, cityKey).filter((found) => found.expertise.slug !== slug),
    titles: await showcaseTitlesPhrase(cards, locale),
  };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cityKey, expertise: slug } = await params;
  const locale = await currentLocale();
  const data = await loadExpertisePage(cityKey, slug, locale);
  if (!data) return {};
  const tExpertise = await getTranslations("Showcase.expertise");
  const label = expertiseLabel(data.expertise, locale);
  const titles = data.titles ?? tExpertise("genericTitles");
  return showcasePageMetadata({
    cityKey,
    path: `/specialite/${data.expertise.slug}`,
    title: tExpertise("metaTitle", { expertise: label, city: data.city.name, titles }),
    description: tExpertise("metaDescription", {
      expertise: label,
      city: data.city.name,
      region: data.city.region,
      titles: capitalizeFirst(titles, locale),
    }),
  });
}

export default async function ShowcaseExpertisePage({ params }: Params) {
  const { cityKey, expertise: slug } = await params;
  const locale = await currentLocale();
  const data = await loadExpertisePage(cityKey, slug, locale);
  if (!data) notFound();
  const { city, expertise, cards, others } = data;
  const t = await getTranslations("Showcase");
  const label = expertiseLabel(expertise, locale);

  return (
    <>
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: city.name, url: absoluteShowcaseUrl(city.key, "/") },
          { name: label, url: absoluteShowcaseUrl(city.key, `/specialite/${expertise.slug}`) },
        ])}
      />
      <ShowcaseBeacon city={city.key} />

      <section className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto max-w-6xl px-4 py-14 md:py-20">
          <nav aria-label={t("breadcrumb.label")} className="text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground hover:underline">
              {city.name}
            </Link>
            <span aria-hidden="true"> / </span>
            <span>{t("expertise.eyebrow")}</span>
          </nav>
          <h1 className="mt-4 max-w-3xl font-serif text-3xl font-light leading-tight text-foreground md:text-5xl">
            {t("expertise.title", { expertise: label, city: city.name })}
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            {t("expertise.intro", { expertise: label, city: city.name })}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{t("city.count", { count: cards.length })}</p>
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-4 py-12" aria-labelledby="expertise-professionals">
        <h2 id="expertise-professionals" className="sr-only">
          {t("expertise.title", { expertise: label, city: city.name })}
        </h2>
        <ShowcaseCardList cards={cards} />
      </section>

      <section className="container mx-auto max-w-6xl space-y-4 px-4 pb-12" aria-labelledby="expertise-others">
        {others.length > 0 ? (
          <>
            <h2 id="expertise-others" className="font-serif text-2xl font-light text-foreground">
              {t("expertise.othersTitle", { city: city.name })}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {others.map((found) => (
                <li key={found.expertise.slug}>
                  <Link
                    href={`/specialite/${found.expertise.slug}`}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary"
                  >
                    {expertiseLabel(found.expertise, locale)}
                    <span className="text-xs text-muted-foreground">{found.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <Link href="/" className="inline-flex text-sm text-primary hover:underline">
          {t("expertise.backCity", { city: city.name })}
        </Link>
      </section>

      <ShowcaseFaq city={city.name} offersVideo={cards.some((card) => card.modalities.includes("video"))} />
      <ShowcaseMatchBand href={canonicalSiteUrl(`/appointment?from=showcase&city=${encodeURIComponent(city.key)}`)} />
    </>
  );
}

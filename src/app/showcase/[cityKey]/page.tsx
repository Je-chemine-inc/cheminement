import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import { showcasePageMetadata } from "@/lib/showcase-metadata";
import { listPublishedShowcaseCards } from "@/lib/showcase-queries";
import type { ShowcaseLocale } from "@/lib/showcase-public";
import { ShowcaseCardList } from "@/components/showcase/ShowcaseCardList";

/**
 * psy<city>.jechemine.ca/ — the city's page (spec 003). Indexable only once a
 * professional is presented here: an empty city page would be thin content.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cityKey: string }> };

const loadCards = cache((cityKey: string, locale: ShowcaseLocale) =>
  listPublishedShowcaseCards(cityKey, locale),
);

async function currentLocale(): Promise<ShowcaseLocale> {
  return (await getLocale()) === "en" ? "en" : "fr";
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cityKey } = await params;
  const city = findShowcaseCity(cityKey);
  if (!city) return {};
  const [t, cards] = await Promise.all([
    getTranslations("Showcase.city"),
    loadCards(cityKey, await currentLocale()),
  ]);
  return showcasePageMetadata({
    cityKey,
    path: "/",
    title: t("metaTitle", { city: city.name }),
    description: t("metaDescription", { city: city.name, region: city.region }),
    index: cards.length > 0,
  });
}

export default async function ShowcaseCityPage({ params }: Params) {
  const { cityKey } = await params;
  const city = findShowcaseCity(cityKey);
  if (!city) notFound();
  const [t, cards] = await Promise.all([
    getTranslations("Showcase.city"),
    loadCards(cityKey, await currentLocale()),
  ]);
  const matchUrl = canonicalSiteUrl(`/appointment?from=showcase&city=${encodeURIComponent(city.key)}`);

  return (
    <>
      <section className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto max-w-6xl px-4 py-16 md:py-20">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            {t("eyebrow", { city: city.name })}
          </p>
          <h1 className="mt-4 max-w-3xl font-serif text-3xl font-light leading-tight text-foreground md:text-5xl">
            {t("title", { city: city.name })}
          </h1>
          {cards.length > 0 ? (
            <p className="mt-4 text-muted-foreground">{t("count", { count: cards.length })}</p>
          ) : null}
        </div>
      </section>

      {cards.length > 0 ? (
        <section className="container mx-auto max-w-6xl px-4 py-12">
          <ShowcaseCardList cards={cards} />
        </section>
      ) : (
        <section className="container mx-auto max-w-6xl px-4 py-12">
          <div className="max-w-2xl rounded-xl border border-dashed border-border/60 bg-background p-8">
            <p className="text-muted-foreground">{t("empty", { city: city.name })}</p>
            <a
              href={matchUrl}
              className="mt-6 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("emptyCta")}
            </a>
          </div>
        </section>
      )}
    </>
  );
}

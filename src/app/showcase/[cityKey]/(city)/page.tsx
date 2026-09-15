import type { Metadata } from "next";
import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Compass, Heart, Hourglass, MapPin, Monitor, Sparkles, Sprout, User, Users, type LucideIcon } from "lucide-react";
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
import { buildDirectoryItems } from "@/lib/showcase-directory-items";
import { WIDE_AMBIENCE_IMAGES } from "@/lib/showcase-imagery";
import { loadNextShowcaseSlots } from "@/lib/showcase-next-slots";
import { ShowcaseBeacon } from "@/components/showcase/ShowcaseBeacon";
import { ShowcaseCityDirectory } from "@/components/showcase/ShowcaseCityDirectory";
import { ShowcaseFaq } from "@/components/showcase/ShowcaseFaq";
import { ShowcaseMatchBand } from "@/components/showcase/ShowcaseMatchBand";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

/**
 * psy<city>.jechemine.ca/ — the city's page (spec 003), in the « Ville »
 * design: a photo hero, the directory of who is presented (searched and
 * filtered in the browser, with their next free times), the expertises and
 * nearby cities of the region, frequent questions and the matching request.
 * Indexed only with a professional presented here; served out of search
 * results while the region has some; otherwise the visitor goes to the
 * region's page on www (decideCityPage).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cityKey: string }> };

const WRAP = "mx-auto w-full max-w-[1260px] px-[clamp(14px,3vw,28px)]";
const THEME_ICONS: LucideIcon[] = [Sparkles, Sprout, Hourglass, Heart, Monitor, User, Users, Compass];
const TILE =
  "flex items-center gap-3 rounded-[14px] border border-[#EDE6DA] bg-white px-4 py-3.5 text-[14.5px] text-[#22403C] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#17505F] hover:text-[#17505F] motion-reduce:hover:translate-y-0";

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
  const matchUrl = canonicalSiteUrl(`/appointment?from=showcase&city=${encodeURIComponent(city.key)}`);
  const heading = titles
    ? capitalizeFirst(t("city.heading", { titles, city: city.name }), locale)
    : t("city.title", { city: city.name });
  // The next free times only for the page itself: the metadata does not need them.
  const items =
    cards.length > 0
      ? await buildDirectoryItems(cards, { nextSlots: await loadNextShowcaseSlots(cards.map((card) => card.slug)) })
      : [];
  // Each city keeps the same landscape photo; neighbouring cities differ.
  const heroImage =
    WIDE_AMBIENCE_IMAGES[[...city.key].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % WIDE_AMBIENCE_IMAGES.length];

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

      <section className="relative isolate flex min-h-[clamp(300px,34vw,430px)] items-end overflow-hidden">
        <Image src={heroImage} alt="" fill priority sizes="100vw" className="-z-20 object-cover" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgba(10,46,57,0.88)_0%,rgba(10,46,57,0.66)_52%,rgba(10,46,57,0.26)_100%)]"
        />
        <div className={`${WRAP} pb-[clamp(56px,6vw,90px)] pt-[clamp(40px,6vw,72px)]`}>
          <nav aria-label={t("breadcrumb.label")} className="text-xs text-white/70">
            <a href={hubUrl} className="text-white/80 hover:text-white hover:underline">
              {t("breadcrumb.quebec")}
            </a>
            <span aria-hidden="true"> / </span>
            <a href={regionUrl} className="text-white/80 hover:text-white hover:underline">
              {city.region}
            </a>
          </nav>
          <span className="mt-4 inline-block rounded-md border border-white/30 bg-white/15 px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#F4F7F1]">
            {city.region}
          </span>
          <h1 className="mt-4 max-w-[18ch] font-serif text-[clamp(34px,6vw,64px)] font-medium leading-[1.04] tracking-[-0.02em] text-[#FCFBF7] text-balance">
            {heading}
          </h1>
          <p className="mt-4 max-w-[58ch] text-[clamp(15.5px,1.8vw,19px)] leading-relaxed text-[#E4EBE2] text-pretty">
            {cards.length > 0
              ? t("city.intro", { city: city.name, regionIn })
              : t("city.introEmpty", { city: city.name, regionIn })}
          </p>
        </div>
      </section>

      {items.length > 0 ? (
        <section
          className={`${WRAP} relative z-10 -mt-[clamp(24px,3vw,36px)]`}
          aria-label={t("city.professionalsTitle", { city: city.name })}
        >
          <ShowcaseCityDirectory items={items} cityName={city.name} />
        </section>
      ) : null}

      {expertises.length > 0 ? (
        <section className={`${WRAP} pt-[clamp(40px,5vw,64px)]`} aria-labelledby="city-expertises">
          <h2 id="city-expertises" className="font-serif text-[clamp(24px,3vw,32px)] leading-tight tracking-[-0.02em] text-[#0F3540]">
            {t("city.themesTitle", { city: city.name })}
          </h2>
          <p className="mt-1.5 text-[15px] text-[#5E6863]">{t("city.themesIntro", { city: city.name })}</p>
          <ul className="mt-5 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(196px,1fr))]">
            {expertises.map(({ expertise, count }, index) => {
              const Icon = THEME_ICONS[index % THEME_ICONS.length];
              return (
                <li key={expertise.slug}>
                  <Link href={`/specialite/${expertise.slug}`} className={TILE}>
                    <Icon className="h-[17px] w-[17px] shrink-0 text-[#17505F]" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{expertiseLabel(expertise, locale)}</span>
                    <span className="text-xs text-[#8E948C]">{count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {nearby.length > 0 ? (
        <section className={`${WRAP} pt-[clamp(40px,5vw,64px)]`} aria-labelledby="city-nearby">
          <h2 id="city-nearby" className="font-serif text-[clamp(24px,3vw,32px)] leading-tight tracking-[-0.02em] text-[#0F3540]">
            {t("city.nearbyTitle", { regionIn })}
          </h2>
          <ul className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {nearby.map(({ city: other, count }) => (
              <li key={other.key}>
                <a href={absoluteShowcaseUrl(other.key, "/")} className={`${TILE} justify-between`}>
                  <span className="inline-flex items-center gap-2.5">
                    <MapPin className="h-4 w-4 text-[#17505F]" aria-hidden="true" />
                    {other.name}
                  </span>
                  <span className="text-xs text-[#8E948C]">{t("city.count", { count })}</span>
                </a>
              </li>
            ))}
          </ul>
          <a href={regionUrl} className="mt-4 inline-flex text-sm font-medium text-[#17505F] hover:text-[#0E3A46] hover:underline">
            {t("city.regionLink", { regionIn })}
          </a>
        </section>
      ) : null}

      <ShowcaseFaq city={city.name} offersVideo={cards.some((card) => card.modalities.includes("video"))} />
      <ShowcaseMatchBand href={matchUrl} />

      {cards.length > 0 ? (
        <>
          <div aria-hidden="true" className="h-[82px] md:hidden" />
          <div className="fixed inset-x-0 bottom-0 z-[60] flex items-center gap-3 border-t border-[#EAE2D5] bg-white/95 px-4 pt-2.5 shadow-[0_-8px_24px_-18px_rgba(16,51,61,0.5)] backdrop-blur-[10px] [padding-bottom:calc(10px+env(safe-area-inset-bottom))] md:hidden">
            <div className="min-w-0">
              <p className="whitespace-nowrap text-[14.5px] font-semibold leading-tight text-[#15404B]">{t("city.stickyTitle", { count: cards.length })}</p>
              <p className="truncate text-xs text-[#6A736C]">{t("city.stickyNote", { city: city.name })}</p>
            </div>
            <a
              href={matchUrl}
              data-showcase-cta=""
              className="ml-auto inline-flex flex-none items-center rounded-xl bg-[#17505F] px-5 py-3 text-[15px] font-semibold text-[#F8F5EE] hover:bg-[#0E3A46] hover:text-[#F8F5EE]"
            >
              {t("city.stickyButton")}
            </a>
          </div>
        </>
      ) : null}
    </>
  );
}

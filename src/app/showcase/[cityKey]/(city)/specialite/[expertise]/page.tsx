import type { Metadata } from "next";
import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Compass, Heart, Hourglass, Monitor, Sparkles, Sprout, User, Users, type LucideIcon } from "lucide-react";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { absoluteShowcaseUrl, canonicalSiteUrl } from "@/lib/showcase-hosts";
import { showcasePageMetadata } from "@/lib/showcase-metadata";
import { listPublishedShowcaseCards, loadShowcaseCatalog, loadShowcaseDirectory } from "@/lib/showcase-queries";
import type { ShowcaseLocale } from "@/lib/showcase-public";
import { breadcrumbJsonLd, capitalizeFirst, expertisesInCity } from "@/lib/showcase-seo";
import { expertiseLabel, showcaseTitlesPhrase } from "@/lib/showcase-copy";
import { WIDE_AMBIENCE_IMAGES } from "@/lib/showcase-imagery";
import { loadNextShowcaseSlots } from "@/lib/showcase-next-slots";
import { ShowcaseBeacon } from "@/components/showcase/ShowcaseBeacon";
import { ShowcaseCardList } from "@/components/showcase/ShowcaseCardList";
import { ShowcaseFaq } from "@/components/showcase/ShowcaseFaq";
import { ShowcaseMatchBand } from "@/components/showcase/ShowcaseMatchBand";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

/**
 * psy<city>.jechemine.ca/specialite/<expertise> — the professionals of a city
 * who carry an expertise (spec 003), in the city page's « Ville » design. A
 * real 404 unless the expertise is offered on pages AND someone in this city
 * carries it: no empty page exists to be indexed.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cityKey: string; expertise: string }> };

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WRAP = "mx-auto w-full max-w-[1260px] px-[clamp(14px,3vw,28px)]";
const THEME_ICONS: LucideIcon[] = [Sparkles, Sprout, Hourglass, Heart, Monitor, User, Users, Compass];

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
  const nextSlots = await loadNextShowcaseSlots(cards.map((card) => card.slug));
  const heroImage =
    WIDE_AMBIENCE_IMAGES[[...city.key].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % WIDE_AMBIENCE_IMAGES.length];

  return (
    <>
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: city.name, url: absoluteShowcaseUrl(city.key, "/") },
          { name: label, url: absoluteShowcaseUrl(city.key, `/specialite/${expertise.slug}`) },
        ])}
      />
      <ShowcaseBeacon city={city.key} />

      <section className="relative isolate flex min-h-[clamp(260px,28vw,360px)] items-end overflow-hidden">
        <Image src={heroImage} alt="" fill priority sizes="100vw" className="-z-20 object-cover" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgba(10,46,57,0.9)_0%,rgba(10,46,57,0.7)_52%,rgba(10,46,57,0.32)_100%)]"
        />
        <div className={`${WRAP} pb-[clamp(40px,5vw,64px)] pt-[clamp(36px,5vw,60px)]`}>
          <nav aria-label={t("breadcrumb.label")} className="text-xs text-white/70">
            <Link href="/" className="text-white/80 hover:text-white hover:underline">
              {city.name}
            </Link>
            <span aria-hidden="true"> / </span>
            <span>{t("expertise.eyebrow")}</span>
          </nav>
          <span className="mt-4 inline-block rounded-md border border-white/30 bg-white/15 px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#F4F7F1]">
            {t("expertise.eyebrow")}
          </span>
          <h1 className="mt-4 max-w-[20ch] font-serif text-[clamp(32px,5vw,56px)] font-medium leading-[1.05] tracking-[-0.02em] text-[#FCFBF7] text-balance">
            {t("expertise.title", { expertise: label, city: city.name })}
          </h1>
          <p className="mt-4 max-w-[60ch] text-[clamp(15px,1.6vw,18px)] leading-relaxed text-[#E4EBE2] text-pretty">
            {t("expertise.intro", { expertise: label, city: city.name })}
          </p>
        </div>
      </section>

      <section className={`${WRAP} pt-[clamp(28px,3.4vw,40px)]`} aria-labelledby="expertise-professionals">
        <h2 id="expertise-professionals" className="text-base font-semibold text-[#2B403C]">
          {t("city.count", { count: cards.length })}
        </h2>
        <div className="mt-4">
          <ShowcaseCardList cards={cards} nextSlots={nextSlots} />
        </div>
      </section>

      <section className={`${WRAP} pt-[clamp(40px,5vw,64px)]`} aria-labelledby="expertise-others">
        {others.length > 0 ? (
          <>
            <h2 id="expertise-others" className="font-serif text-[clamp(24px,3vw,32px)] leading-tight tracking-[-0.02em] text-[#0F3540]">
              {t("expertise.othersTitle", { city: city.name })}
            </h2>
            <ul className="mt-5 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(196px,1fr))]">
              {others.map((found, index) => {
                const Icon = THEME_ICONS[index % THEME_ICONS.length];
                return (
                  <li key={found.expertise.slug}>
                    <Link
                      href={`/specialite/${found.expertise.slug}`}
                      className="flex items-center gap-3 rounded-[14px] border border-[#EDE6DA] bg-white px-4 py-3.5 text-[14.5px] text-[#22403C] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#17505F] hover:text-[#17505F] motion-reduce:hover:translate-y-0"
                    >
                      <Icon className="h-[17px] w-[17px] shrink-0 text-[#17505F]" aria-hidden="true" />
                      <span className="min-w-0 flex-1">{expertiseLabel(found.expertise, locale)}</span>
                      <span className="text-xs text-[#8E948C]">{found.count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[#17505F] hover:text-[#0E3A46] hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("expertise.backCity", { city: city.name })}
        </Link>
      </section>

      <ShowcaseFaq city={city.name} offersVideo={cards.some((card) => card.modalities.includes("video"))} />
      <ShowcaseMatchBand href={canonicalSiteUrl(`/appointment?from=showcase&city=${encodeURIComponent(city.key)}`)} />
    </>
  );
}

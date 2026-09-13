import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SHOWCASE_HUB_PATH, absoluteShowcaseUrl, canonicalSiteUrl } from "@/lib/showcase-hosts";
import { hubPageMetadata } from "@/lib/showcase-metadata";
import { loadShowcaseDirectory } from "@/lib/showcase-queries";
import { countByCity, itemListJsonLd, summarizeRegions } from "@/lib/showcase-seo";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { ShowcaseMatchBand } from "@/components/showcase/ShowcaseMatchBand";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

/**
 * www.jechemine.ca/psy — the directory of Quebec's regions and the cities
 * where professionals are presented (spec 003): the internal links through
 * which search engines reach the city hosts. Not found while the pages are
 * off; out of search results while nobody is presented.
 */
export const dynamic = "force-dynamic";

const loadDirectory = cache(async () => {
  if (!(await isShowcaseEnabled())) return null;
  return summarizeRegions(countByCity(await loadShowcaseDirectory()));
});

export async function generateMetadata(): Promise<Metadata> {
  const regions = await loadDirectory();
  if (!regions) return {};
  const t = await getTranslations("ShowcaseHub");
  return hubPageMetadata({
    path: SHOWCASE_HUB_PATH,
    title: t("metaTitle"),
    description: t("metaDescription"),
    index: regions.some((summary) => summary.total > 0),
  });
}

export default async function ShowcaseHubPage() {
  const regions = await loadDirectory();
  if (!regions) notFound();
  const t = await getTranslations("ShowcaseHub");
  const live = regions.filter((summary) => summary.total > 0);

  return (
    <>
      {live.length > 0 ? (
        <JsonLdScript
          data={itemListJsonLd(
            t("title"),
            live.map((summary) => ({
              name: summary.region.name,
              url: canonicalSiteUrl(`${SHOWCASE_HUB_PATH}/${summary.region.key}`),
            })),
          )}
        />
      ) : null}

      <section className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto max-w-6xl px-4 py-14 md:py-20">
          <h1 className="max-w-3xl font-serif text-3xl font-light leading-tight text-foreground md:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">{t("intro")}</p>
          {live.length === 0 ? <p className="mt-4 max-w-3xl text-muted-foreground">{t("empty")}</p> : null}
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-4 py-12">
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {regions.map((summary) => (
            <li key={summary.region.key} className="rounded-2xl border border-border/60 bg-card p-6">
              <h2 className="font-serif text-xl font-light text-foreground">
                {summary.total > 0 ? (
                  <Link href={`${SHOWCASE_HUB_PATH}/${summary.region.key}`} className="hover:text-primary hover:underline">
                    {summary.region.name}
                  </Link>
                ) : (
                  summary.region.name
                )}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {summary.total > 0 ? t("regionCount", { count: summary.total }) : t("soon")}
              </p>
              {summary.cities.length > 0 ? (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {summary.cities.map(({ city, count }) => (
                    <li key={city.key}>
                      <a
                        href={absoluteShowcaseUrl(city.key, "/")}
                        className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-sm text-foreground transition-colors hover:border-primary"
                      >
                        {city.name}
                        <span className="text-xs text-muted-foreground">{count}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs text-muted-foreground">{t("source")}</p>
      </section>

      <ShowcaseMatchBand href="/appointment?from=showcase" />
    </>
  );
}

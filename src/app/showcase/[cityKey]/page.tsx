import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import { showcasePageMetadata } from "@/lib/showcase-metadata";

/** psy<city>.jechemine.ca/ — the city's page. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cityKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cityKey } = await params;
  const city = findShowcaseCity(cityKey);
  if (!city) return {};
  const t = await getTranslations("Showcase.city");
  return showcasePageMetadata({
    cityKey,
    path: "/",
    title: t("metaTitle", { city: city.name }),
    description: t("metaDescription", { city: city.name, region: city.region }),
    // Kept out of search results until a professional is presented here.
    index: false,
  });
}

export default async function ShowcaseCityPage({ params }: Params) {
  const { cityKey } = await params;
  const city = findShowcaseCity(cityKey);
  if (!city) notFound();
  const t = await getTranslations("Showcase.city");

  return (
    <section className="border-b border-border/60 bg-accent/30">
      <div className="container mx-auto max-w-6xl px-4 py-16 md:py-20">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {t("eyebrow", { city: city.name })}
        </p>
        <h1 className="mt-4 max-w-3xl font-serif text-3xl font-light leading-tight text-foreground md:text-5xl">
          {t("title", { city: city.name })}
        </h1>
        <div className="mt-10 max-w-2xl rounded-xl border border-dashed border-border/60 bg-background p-8">
          <p className="text-muted-foreground">{t("empty", { city: city.name })}</p>
          <a
            href={canonicalSiteUrl(`/appointment?from=showcase&city=${encodeURIComponent(city.key)}`)}
            className="mt-6 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("emptyCta")}
          </a>
        </div>
      </div>
    </section>
  );
}

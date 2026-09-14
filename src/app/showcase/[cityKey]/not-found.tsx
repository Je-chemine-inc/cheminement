import Link from "next/link";
import { headers } from "next/headers";
import { Compass } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { SHOWCASE_CITY_HEADER, canonicalSiteUrl } from "@/lib/showcase-hosts";
import { ShowcaseFooter, ShowcaseHeader } from "@/components/showcase/ShowcaseChrome";

/**
 * 404 inside a city host: a professional that is not (or no longer) published,
 * or a mistyped path. The city layout draws no header (a professional's page
 * has its own), so this page adds the city's; the city comes from the header
 * the middleware sets, which a client cannot send. "/" is the city's own page.
 */
export default async function ShowcaseNotFound() {
  const t = await getTranslations("Showcase.notFound");
  const city = findShowcaseCity((await headers()).get(SHOWCASE_CITY_HEADER));
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {city ? <ShowcaseHeader city={city} /> : null}
      <main className="flex-1">
        <div className="container mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Compass className="h-8 w-8 text-primary" />
          </div>
          <p className="mt-6 text-sm uppercase tracking-[0.3em] text-muted-foreground">404</p>
          <h1 className="mt-2 font-serif text-3xl font-light text-foreground">{t("title")}</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t("body")}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("backCity")}
            </Link>
            <a
              href={canonicalSiteUrl("/")}
              className="rounded-lg border border-border/60 bg-background px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t("backSite")}
            </a>
          </div>
        </div>
      </main>
      <ShowcaseFooter />
    </div>
  );
}

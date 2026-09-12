import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ShowcaseCity } from "@/lib/showcase-cities";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";

/**
 * Header and footer of a city host (psy<city>.jechemine.ca).
 *
 * Deliberately not the www Header/Footer: their relative links (/services,
 * /contact, /login) would resolve on the city host, where only showcase pages
 * exist. Every link to the rest of the platform here is absolute to www;
 * links within the city stay relative.
 */
export async function ShowcaseHeader({ city }: { city: ShowcaseCity }) {
  const t = await getTranslations("Showcase");
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-card/95 backdrop-blur">
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={t("brand")}>
          <Image src="/Logo.png" alt={t("brand")} width={128} height={16} className="h-auto w-28 shrink-0" priority />
          <span className="truncate rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground">
            {t("cityBadge", { city: city.name })}
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <a
            href={canonicalSiteUrl(`/appointment?from=showcase&city=${encodeURIComponent(city.key)}`)}
            data-showcase-cta=""
            className="whitespace-nowrap rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {/* On a phone the long label would squeeze the city badge. */}
            <span className="sm:hidden">{t("nav.bookShort")}</span>
            <span className="hidden sm:inline">{t("nav.book")}</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

export async function ShowcaseFooter() {
  const t = await getTranslations("Showcase");
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/40 bg-accent/20">
      <div className="container mx-auto max-w-6xl space-y-4 px-4 py-10 text-sm text-muted-foreground">
        <p className="rounded-lg border border-border/60 bg-background/60 p-4 text-foreground/80">
          {t("footer.emergency")}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p>
            <a href={canonicalSiteUrl("/")} className="font-medium text-foreground hover:underline">
              {t("footer.site")}
            </a>{" "}
            — {t("footer.tagline")}
          </p>
          <div className="flex flex-wrap gap-4">
            <a href={canonicalSiteUrl("/privacy")} className="hover:text-foreground">
              {t("footer.privacy")}
            </a>
            <a href={canonicalSiteUrl("/terms")} className="hover:text-foreground">
              {t("footer.terms")}
            </a>
          </div>
        </div>
        <p className="text-xs">{t("footer.rights", { year })}</p>
      </div>
    </footer>
  );
}

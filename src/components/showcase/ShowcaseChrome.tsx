import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ShowcaseCity } from "@/lib/showcase-cities";
import { SHOWCASE_HUB_PATH, canonicalSiteUrl } from "@/lib/showcase-hosts";

/**
 * Header and footer of a city host (psy<city>.jechemine.ca), in the « Ville »
 * design.
 *
 * Deliberately not the www Header/Footer: their relative links (/services,
 * /contact, /login) would resolve on the city host, where only showcase pages
 * exist. Every link to the rest of the platform here is absolute to www;
 * links within the city stay relative.
 */
const WRAP = "mx-auto w-full max-w-[1260px] px-[clamp(14px,3vw,28px)]";

export async function ShowcaseHeader({ city }: { city: ShowcaseCity }) {
  const t = await getTranslations("Showcase");
  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#EDE6DA] bg-[#FAF7F2]/90 backdrop-blur-[14px]">
      <div className={`${WRAP} flex h-16 items-center gap-[clamp(10px,2vw,24px)]`}>
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={t("brand")}>
          <Image src="/Logo.png" alt={t("brand")} width={423} height={84} className="h-7 w-auto shrink-0" priority />
          {/* On a phone the badge would squeeze the booking button. */}
          <span className="hidden truncate rounded-full border border-[#E2DACB] bg-white px-3 py-1 text-xs text-[#5B6661] sm:inline">
            {t("cityBadge", { city: city.name })}
          </span>
        </Link>
        <nav className="ml-auto flex flex-none items-center gap-[clamp(8px,1.4vw,16px)] text-sm">
          <a href={canonicalSiteUrl("/login")} className="hidden whitespace-nowrap text-[#5B6661] hover:text-[#17505F] sm:inline">
            {t("nav.login")}
          </a>
          <a
            href={canonicalSiteUrl(`/appointment?from=showcase&city=${encodeURIComponent(city.key)}`)}
            data-showcase-cta=""
            className="whitespace-nowrap rounded-full bg-[#17505F] px-4 py-2.5 font-semibold text-[#F7F3EC] transition-colors hover:bg-[#0E3A46] hover:text-[#F7F3EC]"
          >
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
  const link = "text-[#17505F] hover:text-[#0E3A46]";
  return (
    <footer className="border-t border-[#EDE6DA] bg-[#FAF7F2]">
      <div className={`${WRAP} grid gap-8 py-[clamp(32px,4vw,52px)] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`}>
        <div className="min-w-0">
          <a href={canonicalSiteUrl("/")} className="inline-flex" aria-label={t("brand")}>
            <Image src="/Logo.png" alt={t("brand")} width={423} height={84} className="h-7 w-auto" />
          </a>
          <p className="mt-3 max-w-[280px] text-[13.5px] leading-relaxed text-[#5E6863]">{t("footer.tagline")}</p>
        </div>
        <nav aria-label={t("footer.linksTitle")} className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#666E62]">{t("footer.linksTitle")}</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li>
              <a href={canonicalSiteUrl("/")} className={link}>
                {t("footer.site")}
              </a>
            </li>
            <li>
              <a href={canonicalSiteUrl(SHOWCASE_HUB_PATH)} className={link}>
                {t("footer.hub")}
              </a>
            </li>
            <li>
              <a href={canonicalSiteUrl("/appointment?from=showcase")} data-showcase-cta="" className={link}>
                {t("footer.match")}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className={`${WRAP} pb-8`}>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-[#EDE6DA] pt-5 text-center text-[13px] text-[#666E62]">
          <span>{t("footer.rights", { year })}</span>
          <a href={canonicalSiteUrl("/privacy")} className="hover:text-[#17505F]">
            {t("footer.privacy")}
          </a>
          <a href={canonicalSiteUrl("/terms")} className="hover:text-[#17505F]">
            {t("footer.terms")}
          </a>
        </div>
      </div>
    </footer>
  );
}

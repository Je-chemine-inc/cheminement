import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Languages, MapPin, MessageCircle, Phone, Video, type LucideIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { vitrineSans, vitrineSerif } from "@/components/showcase/vitrine/fonts";
import type { FeaturedProfessional } from "@/lib/showcase-featured";
import { loadFeaturedProfessionals } from "@/lib/showcase-featured-queries";
import type { ShowcaseModalityKey } from "@/lib/showcase-public";

const SERIF = { fontFamily: "var(--font-vitrine-serif), Georgia, 'Times New Roman', serif" };
const SANS = { fontFamily: "var(--font-vitrine-sans), ui-sans-serif, system-ui, sans-serif" };
const SHELL = "mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-14 xl:px-20";

/** Soft backgrounds for a professional without a portrait, taken in turn. */
const TINTS = [
  { from: "#DCEBEA", to: "#BFD9D7", ink: "#17505F" },
  { from: "#F1E4D8", to: "#E4CCB8", ink: "#7A4B2E" },
  { from: "#E3EBDD", to: "#CCDBC1", ink: "#3F5A3A" },
  { from: "#DFE7F1", to: "#C6D6E8", ink: "#2F4E6F" },
] as const;

const MODALITY_ICONS: Record<ShowcaseModalityKey, LucideIcon> = {
  inPerson: MapPin,
  video: Video,
  phone: Phone,
  chat: MessageCircle,
};

function initialsOf(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toLocaleUpperCase("fr-CA"))
    .join("");
}

async function loadFeatured(locale: "fr" | "en"): Promise<FeaturedProfessional[]> {
  try {
    return await loadFeaturedProfessionals(locale);
  } catch (error) {
    // The section is a bonus on the page: a failed read hides it, never the page.
    console.error("[showcase] featured professionals could not be loaded:", error);
    return [];
  }
}

/**
 * « Quelques-uns de nos professionnels »: a few of the platform's professionals,
 * each a portrait beside its presentation (the design of the former « Nos
 * professionnels » page). One with a published page links to it; one without
 * shows no link. Who is shown: lib/showcase-featured.ts.
 * Renders nothing when nobody can be shown.
 *
 * `context` only changes the heading: « Qui sommes-nous » speaks to people
 * looking for help, « Je suis un professionnel » to professionals.
 */
export default async function ShowcaseProfessionalsSection({
  context,
}: {
  context: "about" | "professional";
}) {
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const featured = await loadFeatured(locale);
  if (featured.length === 0) return null;

  const [t, tTitles, tShowcase] = await Promise.all([
    getTranslations("ShowcaseProfessionals"),
    getTranslations("Showcase.titles"),
    getTranslations("Showcase"),
  ]);

  return (
    <section
      aria-labelledby={`featured-professionals-${context}`}
      className={`${vitrineSerif.variable} ${vitrineSans.variable} relative overflow-hidden bg-[#F6F3EE] py-20 text-[#1F2A2E] md:py-28`}
      style={SANS}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-56 -top-64 size-[640px] rounded-full bg-[radial-gradient(circle,rgba(23,80,95,0.12),transparent_65%)]" />
        <div className="absolute -left-64 bottom-0 size-[560px] rounded-full bg-[radial-gradient(circle,rgba(196,150,110,0.14),transparent_65%)]" />
      </div>

      <div className={`${SHELL} relative`}>
        <header className="max-w-3xl">
          <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#17505F]">
            <span aria-hidden className="h-px w-10 bg-[#17505F]" />
            {t(`${context}.eyebrow`)}
          </p>
          <h2
            id={`featured-professionals-${context}`}
            style={SERIF}
            className="mt-6 text-4xl leading-[1.08] tracking-tight md:text-5xl xl:text-6xl"
          >
            {t(`${context}.title`)}
          </h2>
          <p className="mt-6 text-lg leading-8 text-[#5B6566] md:text-xl md:leading-9">{t(`${context}.intro`)}</p>
        </header>

        <ul className="mt-8 md:mt-12">
          {featured.map((pro, index) => {
            const tint = TINTS[index % TINTS.length]!;
            const title = pro.title.key ? tTitles(pro.title.key) : pro.title.label;
            const eyebrow = [pro.degree, title].filter(Boolean).join(" · ");
            const portrait = (
              <>
                <span className="absolute -inset-4 rounded-full border border-[#17505F]/15 transition duration-500 group-hover:-inset-6" />
                <span className="relative block size-52 overflow-hidden rounded-full border-2 border-[#17505F]/70 bg-[#F3F7F7] shadow-[0_28px_56px_-28px_rgba(31,42,46,0.45)] md:size-60 lg:size-72">
                  {pro.photoUrl ? (
                    <Image
                      src={pro.photoUrl}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 288px, (min-width: 768px) 240px, 208px"
                      className="object-cover transition duration-700 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <span
                      style={{ ...SERIF, color: tint.ink, background: `linear-gradient(135deg, ${tint.from}, ${tint.to})` }}
                      className="flex size-full items-center justify-center text-6xl md:text-7xl"
                    >
                      {initialsOf(pro.displayName)}
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={pro.id} className="border-b border-[#DFDAD1] py-12 last:border-b-0 md:py-16">
                <article
                  className={`group flex flex-col items-center gap-10 md:items-center md:gap-14 lg:gap-20 ${
                    index % 2 === 1 ? "md:flex-row-reverse" : "md:flex-row"
                  }`}
                >
                  {pro.pagePath ? (
                    <Link href={pro.pagePath} tabIndex={-1} aria-hidden className="relative shrink-0">
                      {portrait}
                    </Link>
                  ) : (
                    <div aria-hidden className="relative shrink-0">
                      {portrait}
                    </div>
                  )}

                  <div className="min-w-0 flex-1 text-center md:text-left">
                    {eyebrow && (
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#17505F]">{eyebrow}</p>
                    )}
                    <h3 style={SERIF} className="mt-3 text-[32px] leading-tight md:text-[40px]">
                      {pro.displayName}
                    </h3>
                    {pro.yearsOfExperience ? (
                      <p className="mt-2 text-[15px] text-[#5B6566]">
                        {t("experience", { count: pro.yearsOfExperience })}
                      </p>
                    ) : null}
                    {pro.summary && (
                      <p className="mt-5 max-w-3xl text-base leading-8 text-[#5B6566] md:text-lg">{pro.summary}</p>
                    )}

                    {(pro.languages.length > 0 || pro.modalities.length > 0) && (
                      <dl className="mt-7 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 md:justify-start">
                        {pro.languages.length > 0 && (
                          <div className="flex items-center gap-2 text-[15px]">
                            <dt className="sr-only">{t("languagesLabel")}</dt>
                            <Languages aria-hidden className="size-4 shrink-0 text-[#17505F]" />
                            <dd>{pro.languages.map((key) => tShowcase(`languages.${key}`)).join(" · ")}</dd>
                          </div>
                        )}
                        {pro.modalities.length > 0 && (
                          <div>
                            <dt className="sr-only">{t("modalitiesLabel")}</dt>
                            <dd>
                              <ul className="flex flex-wrap justify-center gap-2 md:justify-start">
                                {pro.modalities.map((key) => {
                                  const Icon = MODALITY_ICONS[key];
                                  return (
                                    <li
                                      key={key}
                                      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-[13px] ring-1 ring-[#E4E1DA]"
                                    >
                                      <Icon aria-hidden className="size-3.5 text-[#17505F]" />
                                      {tShowcase(`modalities.${key}`)}
                                    </li>
                                  );
                                })}
                              </ul>
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {/* No page yet: no link at all. */}
                    {pro.pagePath && (
                      <Link
                        href={pro.pagePath}
                        aria-label={t("viewPageLabel", { name: pro.displayName })}
                        style={SERIF}
                        className="mt-8 inline-flex items-center gap-2 text-xl font-bold text-[#17505F] underline underline-offset-[6px] transition hover:text-[#0F3F4C]"
                      >
                        {t("viewPage")}
                        <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

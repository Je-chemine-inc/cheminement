import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { vitrineSans, vitrineSerif } from "@/components/showcase/vitrine/fonts";
import {
  ProfessionalsDirectoryGrid,
  type DirectoryCard,
  type DirectoryGroup,
} from "@/components/professionals/ProfessionalsDirectoryGrid";
import { directoryTint } from "@/components/professionals/directory-tints";
import { loadProfessionalsDirectory } from "@/lib/professionals-directory-queries";
import type { DirectoryProfessional } from "@/lib/professionals-directory";

/**
 * www /professionnels — « Nos professionnels »: every listed professional as a card, filterable by
 * profession (lib/professionals-directory.ts decides who and what). Read per request, so a page
 * published or a profile hidden shows at once. Same typefaces and palette as the professionals' pages.
 */
export const dynamic = "force-dynamic";

const SERIF = { fontFamily: "var(--font-vitrine-serif), Georgia, 'Times New Roman', serif" };
const SANS = { fontFamily: "var(--font-vitrine-sans), ui-sans-serif, system-ui, sans-serif" };

/** Where the hero's portraits sit (desktop), largest first: a loose, overlapping cluster. */
const CLUSTER = [
  { size: 224, top: 88, left: 124 },
  { size: 156, top: 0, left: 316 },
  { size: 136, top: 276, left: 8 },
  { size: 128, top: 300, left: 330 },
  { size: 100, top: 36, left: 20 },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: t("professionals.title"),
    description: t("professionals.description"),
    openGraph: {
      title: t("professionals.title"),
      description: t("professionals.description"),
    },
  };
}

function initialsOf(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toLocaleUpperCase("fr-CA"))
    .join("");
}

export default async function ProfessionalsPage() {
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const [t, tTitles, tShowcase, professionals] = await Promise.all([
    getTranslations("Professionals"),
    getTranslations("Showcase.titles"),
    getTranslations("Showcase"),
    loadProfessionalsDirectory(locale).catch((error): DirectoryProfessional[] => {
      console.error("[professionnels] the list could not be loaded:", error);
      return [];
    }),
  ]);

  const cards: DirectoryCard[] = professionals.map((pro, index) => {
    const title = pro.title.key ? tTitles(pro.title.key) : pro.title.label;
    return {
      id: pro.id,
      name: pro.displayName,
      initials: initialsOf(pro.displayName),
      eyebrow: [pro.degree, title].filter(Boolean).join(" · "),
      group: pro.title.key ?? "other",
      experience: pro.yearsOfExperience ? t("experience", { count: pro.yearsOfExperience }) : null,
      summary: pro.summary,
      photoUrl: pro.photoUrl,
      photoAlt: t("photoAlt", { name: pro.displayName }),
      languages: pro.languages.map((key) => tShowcase(`languages.${key}`)),
      modalities: pro.modalities.map((key) => ({ key, label: tShowcase(`modalities.${key}`) })),
      profileHref: pro.showcasePath,
      profileLabel: t("readMoreLabel", { name: pro.displayName }),
      tint: index,
    };
  });

  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.group, (counts.get(card.group) ?? 0) + 1);
  const groups: DirectoryGroup[] = [...counts].map(([key, count]) => ({
    key,
    count,
    label: t(`groups.${key as "psychologist"}`),
  }));

  const languageCount = new Set(professionals.flatMap((pro) => pro.languages)).size;
  const yearsTotal = professionals.reduce((sum, pro) => sum + (pro.yearsOfExperience ?? 0), 0);
  const stats = [
    cards.length > 0 ? t("stats.professionals", { count: cards.length }) : null,
    languageCount > 0 ? t("stats.languages", { count: languageCount }) : null,
    yearsTotal > 0 ? t("stats.years", { count: yearsTotal }) : null,
  ].filter((stat): stat is string => Boolean(stat));

  // Portraits first in the hero: a photo draws the eye more than a monogram.
  const cluster = [...cards].sort((a, b) => Number(Boolean(b.photoUrl)) - Number(Boolean(a.photoUrl))).slice(0, CLUSTER.length);

  return (
    <main
      className={`${vitrineSerif.variable} ${vitrineSans.variable} relative bg-[#F6F3EE] pt-14 text-[#1F2A2E]`}
      style={SANS}
    >
      {/* Soft light behind the top of the page; tall enough that no glow meets its edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[1200px] overflow-hidden">
        <div className="absolute -right-48 -top-56 size-[620px] rounded-full bg-[radial-gradient(circle,rgba(23,80,95,0.14),transparent_65%)]" />
        <div className="absolute -left-56 top-[340px] size-[560px] rounded-full bg-[radial-gradient(circle,rgba(196,150,110,0.16),transparent_65%)]" />
      </div>

      {/* Hero */}
      <section className="relative">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-14 pt-16 sm:px-6 md:pb-20 md:pt-24 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:px-8">
          <div>
            <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#17505F]">
              <span aria-hidden className="h-px w-8 bg-[#17505F]" />
              {t("eyebrow")}
            </p>
            <h1 style={SERIF} className="mt-5 text-5xl leading-[1.04] tracking-tight md:text-7xl">
              {t("title")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#5B6566] md:text-xl md:leading-9">{t("intro")}</p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/appointment"
                className="group inline-flex items-center gap-2 rounded-full bg-[#17505F] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_-12px_rgba(23,80,95,0.6)] transition hover:bg-[#123F4B]"
              >
                {t("cta.match")}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center rounded-full border border-[#1F2A2E]/15 bg-white/60 px-7 py-3.5 text-sm font-semibold transition hover:bg-white"
              >
                {t("cta.contact")}
              </Link>
            </div>
            {stats.length > 0 && (
              <ul className="mt-14 grid gap-5 border-t border-[#1F2A2E]/10 pt-8 sm:grid-cols-3 sm:gap-6">
                {stats.map((stat) => (
                  <li key={stat} style={SERIF} className="text-lg leading-snug md:text-xl">
                    {stat}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cluster.length > 0 && (
            <div aria-hidden className="relative mx-auto hidden h-[440px] w-[470px] lg:block">
              {cluster.map((card, index) => {
                const spot = CLUSTER[index]!;
                const tint = directoryTint(card.tint);
                return (
                  <div
                    key={card.id}
                    className="absolute overflow-hidden rounded-full border-[5px] border-[#F6F3EE] shadow-[0_24px_48px_-24px_rgba(31,42,46,0.45)]"
                    style={{ width: spot.size, height: spot.size, top: spot.top, left: spot.left }}
                  >
                    {card.photoUrl ? (
                      <Image src={card.photoUrl} alt="" fill sizes={`${spot.size}px`} className="object-cover" />
                    ) : (
                      <span
                        style={{ ...SERIF, color: tint.ink, background: `linear-gradient(135deg, ${tint.from}, ${tint.to})`, fontSize: spot.size * 0.3 }}
                        className="flex size-full items-center justify-center"
                      >
                        {card.initials}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* The professionals */}
      <section className="relative pb-20 md:pb-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          {cards.length === 0 ? (
            <p className="rounded-[28px] border border-[#E4E1DA] bg-white p-10 text-center text-lg text-[#5B6566]">{t("empty")}</p>
          ) : (
            <ProfessionalsDirectoryGrid
              cards={cards}
              groups={groups}
              labels={{
                filter: t("filters.label"),
                all: t("filters.all"),
                noResults: t("noResults"),
                viewProfile: t("viewProfile"),
                languages: t("languagesLabel"),
                modalities: t("modalitiesLabel"),
              }}
            />
          )}
        </div>
      </section>

      {/* Closing */}
      <section className="relative pb-24 md:pb-32">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-[32px] bg-[#17505F] px-8 py-14 text-white md:px-16 md:py-20">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "repeating-radial-gradient(circle at 100% 0%, transparent 0 38px, rgba(255,255,255,0.18) 38px 39px)",
              }}
            />
            <div className="relative grid gap-10 md:grid-cols-[1.5fr_1fr] md:items-center">
              <div>
                <h2 style={SERIF} className="text-3xl leading-tight md:text-5xl">
                  {t("closing.title")}
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-8 text-white/80">{t("closing.text")}</p>
              </div>
              <div className="flex flex-wrap gap-3 md:justify-end">
                <Link
                  href="/appointment"
                  className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-[#17505F] transition hover:bg-[#F6F3EE]"
                >
                  {t("closing.cta")}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center rounded-full border border-white/30 px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {t("closing.contact")}
                </Link>
              </div>
            </div>
          </div>
          <p className="mt-8 text-center text-sm text-[#5B6566]">
            {t.rich("contactLine", {
              link: (chunks) => (
                <Link href="/contact" className="font-medium text-[#17505F] underline-offset-4 hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      </section>
    </main>
  );
}

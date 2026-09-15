import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { vitrineSerif } from "@/components/showcase/vitrine/fonts";
import { loadProfessionalsDirectory } from "@/lib/professionals-directory-queries";
import type { DirectoryProfessional } from "@/lib/professionals-directory";

/**
 * www /professionnels — « Nos professionnels »: every listed professional with a short text, and
 * « Lire plus » to their page when they have one (lib/professionals-directory.ts decides who and what).
 * Read per request, so a page published or a profile hidden shows at once.
 */
export const dynamic = "force-dynamic";

const SERIF = { fontFamily: "var(--font-vitrine-serif), Georgia, 'Times New Roman', serif" };

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
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toLocaleUpperCase("fr-CA"))
    .join("");
}

export default async function ProfessionalsPage() {
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const [t, tTitles, professionals] = await Promise.all([
    getTranslations("Professionals"),
    getTranslations("Showcase.titles"),
    loadProfessionalsDirectory(locale).catch((error): DirectoryProfessional[] => {
      console.error("[professionnels] the list could not be loaded:", error);
      return [];
    }),
  ]);

  return (
    <main className={`${vitrineSerif.variable} bg-white pt-14`}>
      <section className="mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 md:pt-24 lg:px-8">
        <header className="max-w-3xl">
          <h1 style={SERIF} className="text-4xl font-bold text-[#1F2A2E] md:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-6 text-lg leading-8 text-[#5B6566]">{t("intro")}</p>
          <p className="mt-3 text-base text-[#5B6566]">
            {t.rich("contactLine", {
              link: (chunks) => (
                <Link href="/contact" className="text-[#16858C] hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </header>

        {professionals.length === 0 ? (
          <p className="mt-16 text-lg text-[#5B6566]">{t("empty")}</p>
        ) : (
          <ul className="mt-10 md:mt-16">
            {professionals.map((pro, index) => {
              const title = pro.title.key ? tTitles(pro.title.key) : pro.title.label;
              const titleLine = [pro.degree, title].filter(Boolean).join(", ");
              return (
                <li key={pro.id} className="border-b border-[#D7E6E6] py-12 last:border-b-0 md:py-14">
                  <article
                    className={`flex flex-col gap-8 md:items-start md:gap-12 ${
                      index % 2 === 1 ? "md:flex-row-reverse" : "md:flex-row"
                    }`}
                  >
                    <div className="size-44 shrink-0 self-center overflow-hidden rounded-full border-2 border-[#16858C] bg-[#F3F7F7] md:size-[212px] md:self-start">
                      {pro.photoUrl ? (
                        <Image
                          src={pro.photoUrl}
                          alt={t("photoAlt", { name: pro.displayName })}
                          width={424}
                          height={424}
                          sizes="(min-width: 768px) 212px, 176px"
                          className="size-full object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden
                          style={SERIF}
                          className="flex size-full items-center justify-center text-5xl text-[#16858C]"
                        >
                          {initialsOf(pro.displayName)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 style={SERIF} className="text-2xl font-bold text-[#1F2A2E]">
                        {pro.displayName}
                      </h2>
                      {titleLine && <p className="mt-2 tracking-wide text-[#5B6566]">{titleLine}</p>}
                      {pro.summary && (
                        <p className="mt-6 text-[15px] leading-7 text-[#5B6566]">{pro.summary}</p>
                      )}
                      {pro.showcasePath && (
                        <Link
                          href={pro.showcasePath}
                          aria-label={t("readMoreLabel", { name: pro.displayName })}
                          style={SERIF}
                          className="mt-8 inline-block font-bold text-[#16858C] underline underline-offset-4 hover:text-[#0F6A70]"
                        >
                          {t("readMore")}
                        </Link>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

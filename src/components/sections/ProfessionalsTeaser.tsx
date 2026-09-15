import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** A short band that leads to « Nos professionnels » (home page, « Qui sommes-nous »). */
export default async function ProfessionalsTeaser() {
  const t = await getTranslations("Professionals.teaser");
  return (
    <section className="bg-muted py-20">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <span className="text-sm font-bold uppercase tracking-widest text-primary">{t("badge")}</span>
        <h2 className="mt-4 font-serif text-3xl font-bold text-foreground md:text-4xl">{t("title")}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">{t("text")}</p>
        <Link
          href="/professionnels"
          className="group mt-8 inline-flex items-center gap-3 rounded-full bg-foreground px-8 py-4 font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary"
        >
          <span>{t("button")}</span>
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </section>
  );
}

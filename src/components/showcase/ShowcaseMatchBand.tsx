import { getTranslations } from "next-intl/server";
import { ArrowRight, Users } from "lucide-react";

/** « Vous ne savez pas qui choisir ? » — the way to the matching request on www (spec 003), as a dark band. */
export async function ShowcaseMatchBand({ href }: { href: string }) {
  const t = await getTranslations("Showcase.match");
  return (
    <section className="mx-auto w-full max-w-[1260px] px-[clamp(14px,3vw,28px)] py-[clamp(40px,5vw,64px)]">
      <div className="relative flex flex-wrap items-center gap-[clamp(20px,3vw,36px)] overflow-hidden rounded-3xl bg-[#12414F] p-[clamp(24px,4vw,44px)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-32 h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(169,190,155,0.22),rgba(169,190,155,0)_66%)]"
        />
        <span className="flex h-[54px] w-[54px] flex-none items-center justify-center self-start rounded-2xl bg-white/10 text-[#DCE8D6]">
          <Users className="h-[26px] w-[26px]" aria-hidden="true" />
        </span>
        <div className="relative min-w-0 flex-[1_1_300px]">
          <h2 className="font-serif text-[clamp(23px,3vw,32px)] leading-tight tracking-[-0.02em] text-[#FCFBF7] text-pretty">{t("title")}</h2>
          <p className="mt-2 max-w-[56ch] text-[15.5px] leading-relaxed text-[#D5E2DC] text-pretty">{t("body")}</p>
        </div>
        <a
          href={href}
          data-showcase-cta=""
          className="relative inline-flex flex-none items-center gap-2.5 rounded-[14px] bg-[#F7F4EC] px-6 py-3.5 text-[15.5px] font-semibold text-[#12414F] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#DCE8D6] hover:text-[#0E3A46] motion-reduce:hover:translate-y-0"
        >
          {t("button")}
          <ArrowRight className="h-[17px] w-[17px]" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

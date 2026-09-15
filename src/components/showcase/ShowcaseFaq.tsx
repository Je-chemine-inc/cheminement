import { getTranslations } from "next-intl/server";
import { ArrowRight, Plus } from "lucide-react";
import { FREE_CANCELLATION_HOURS } from "@/lib/cancellation-policy";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import { faqJsonLd } from "@/lib/showcase-seo";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

/**
 * Frequent questions on a city or expertise page (spec 003), with their
 * FAQPage structured data: the title and a way to write to the team on one
 * side, the questions on the other. The answers state only what the platform
 * does: the video answer depends on whether someone listed offers it.
 */
export async function ShowcaseFaq({ city, offersVideo }: { city: string; offersVideo: boolean }) {
  const t = await getTranslations("Showcase.faq");
  const items = [
    { question: t("bookQ", { city }), answer: t("bookA") },
    { question: t("videoQ"), answer: offersVideo ? t("videoA", { city }) : t("videoANone", { city }) },
    { question: t("insuranceQ"), answer: t("insuranceA") },
    { question: t("cancelQ"), answer: t("cancelA", { hours: FREE_CANCELLATION_HOURS }) },
    { question: t("emergencyQ"), answer: t("emergencyA") },
  ];
  return (
    <section className="mx-auto w-full max-w-[1260px] px-[clamp(14px,3vw,28px)] pt-[clamp(40px,5vw,64px)]" aria-labelledby="showcase-faq">
      <JsonLdScript data={faqJsonLd(items)} />
      <div className="flex flex-wrap gap-[clamp(20px,3vw,48px)]">
        <div className="min-w-0 max-w-[360px] flex-[1_1_260px]">
          <h2 id="showcase-faq" className="font-serif text-[clamp(24px,3vw,32px)] leading-tight tracking-[-0.02em] text-[#0F3540]">
            {t("title")}
          </h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[#5E6863]">{t("intro", { city })}</p>
          <a
            href={canonicalSiteUrl("/contact")}
            className="mt-3.5 inline-flex items-center gap-2 whitespace-nowrap text-[14.5px] font-medium text-[#17505F] hover:text-[#0E3A46]"
          >
            {t("contact")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
          {items.map((item) => (
            <details key={item.question} className="group overflow-hidden rounded-2xl border border-[#EDE6DA] bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-3.5 px-5 py-4 text-[15.5px] font-medium leading-snug text-[#1B3E48] [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">{item.question}</span>
                <Plus className="h-[18px] w-[18px] shrink-0 text-[#17505F] transition-transform duration-300 group-open:rotate-45" aria-hidden="true" />
              </summary>
              <p className="px-5 pb-5 text-[14.5px] leading-relaxed text-[#55605B] text-pretty">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

import { getTranslations } from "next-intl/server";
import { FREE_CANCELLATION_HOURS } from "@/lib/cancellation-policy";
import { faqJsonLd } from "@/lib/showcase-seo";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

/**
 * Frequent questions on a city or expertise page (spec 003), with their
 * FAQPage structured data. The answers state only what the platform does:
 * the video answer depends on whether someone listed offers it.
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
    <section className="container mx-auto max-w-3xl px-4 py-12" aria-labelledby="showcase-faq">
      <JsonLdScript data={faqJsonLd(items)} />
      <h2 id="showcase-faq" className="font-serif text-2xl font-light text-foreground">
        {t("title")}
      </h2>
      <div className="mt-6 divide-y divide-border/60 rounded-2xl border border-border/60 bg-card">
        {items.map((item) => (
          <details key={item.question} className="group p-5">
            <summary className="cursor-pointer font-medium text-foreground">{item.question}</summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

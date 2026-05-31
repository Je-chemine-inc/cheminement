"use client";

import { useTranslations } from "next-intl";
import { HelpCircle } from "lucide-react";
import FaqList from "@/components/faqs/FaqList";
import ContactSupportSection from "@/components/help/ContactSupportSection";

export default function HelpCenterPage() {
  const t = useTranslations("Dashboard.helpCenter");

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="rounded-3xl border border-border/20 bg-linear-to-br from-card via-card/80 to-card/30 p-8 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <HelpCircle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground/70">
              {t("badge")}
            </p>
            <h1 className="font-serif text-3xl font-light text-foreground">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-8 shadow-lg">
        <h2 className="font-serif text-xl font-medium text-foreground">
          {t("faqTitle")}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t("faqDescription")}
        </p>
        <FaqList
          audience="professional"
          fallback={
            <ul className="space-y-4">
              <li className="border-b border-border/20 pb-4">
                <h3 className="font-medium text-foreground">{t("faq1.question")}</h3>
                <p className="text-sm text-muted-foreground">{t("faq1.answer")}</p>
              </li>
              <li className="border-b border-border/20 pb-4">
                <h3 className="font-medium text-foreground">{t("faq2.question")}</h3>
                <p className="text-sm text-muted-foreground">{t("faq2.answer")}</p>
              </li>
            </ul>
          }
        />
      </section>

      {/* Contact Section */}
      <ContactSupportSection />
    </div>
  );
}
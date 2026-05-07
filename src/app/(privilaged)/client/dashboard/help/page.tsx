"use client";

import { useTranslations } from "next-intl";
import { HelpCircle, MessageCircle, Mail, Phone } from "lucide-react";
import FaqList from "@/components/faqs/FaqList";

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
        <h2 className="font-serif text-xl font-medium text-foreground mb-2">
          {t("faqTitle")}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {t("faqDescription")}
        </p>
        <FaqList
          audience="client"
          fallback={
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/20 bg-card/60 p-5">
                <h3 className="font-medium text-foreground mb-2">
                  {t("faq1.question")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("faq1.answer")}</p>
              </div>
              <div className="rounded-2xl border border-border/20 bg-card/60 p-5">
                <h3 className="font-medium text-foreground mb-2">
                  {t("faq2.question")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("faq2.answer")}</p>
              </div>
            </div>
          }
        />
      </section>

      {/* Contact Section */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-8 shadow-lg">
        <h2 className="font-serif text-xl font-medium text-foreground mb-2">
          {t("contactTitle")}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {t("contactDescription")}
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div
            aria-disabled="true"
            className="flex items-center gap-3 rounded-2xl border border-border/20 bg-card/60 p-4 opacity-60 pointer-events-none"
          >
            <MessageCircle className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">{t("chat")}</p>
                <span className="rounded-full border border-amber-300/60 bg-amber-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  {t("chatComingSoon")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t("chatDesc")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border/20 bg-card/60 p-4">
            <Mail className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">{t("email")}</p>
              <p className="text-xs text-muted-foreground">support@jechemine.ca</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border/20 bg-card/60 p-4">
            <Phone className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">{t("phone")}</p>
              <p className="text-xs text-muted-foreground">1-800-XXX-XXXX</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

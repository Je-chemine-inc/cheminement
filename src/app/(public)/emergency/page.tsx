"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import BookingButtonsGroup from "@/components/appointments/BookingButtonsGroup";

/**
 * Public "Prendre un rendez-vous d'urgence" page.
 *
 * Presents the urgent-request conditions, a life-threatening-crisis disclaimer
 * (this is NOT a real-time crisis service), then routes the visitor into the
 * standard booking funnel via the three entry points (self / loved-one /
 * patient) with ?emergency=true so the request is flagged urgent at reception.
 *
 * NOTE: the specific eligibility conditions are client-provided copy and live in
 * messages/{en,fr}.json under EmergencyAppointment.conditionsBody — edit there.
 */
export default function EmergencyAppointmentPage() {
  const t = useTranslations("EmergencyAppointment");

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-3xl mx-auto px-6 pt-28 pb-20 md:pt-32">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-red-100 text-red-600 mb-6 dark:bg-red-900/40 dark:text-red-300">
            <AlertCircle className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-4">
            {t("pageTitle")}
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t("pageIntro")}
          </p>
        </div>

        {/* Life-threatening crisis disclaimer — always shown first */}
        <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-6 mb-8 dark:border-red-900/50 dark:bg-red-950/20">
          <div className="flex items-start gap-3">
            <Phone className="h-5 w-5 text-red-600 shrink-0 mt-0.5 dark:text-red-300" />
            <div>
              <h2 className="font-semibold text-red-800 mb-1 dark:text-red-300">
                {t("crisisTitle")}
              </h2>
              <p className="text-sm text-red-800/90 leading-relaxed dark:text-red-200/90">
                {t("crisisBody")}
              </p>
            </div>
          </div>
        </div>

        {/* Specific conditions (client-provided copy) */}
        <div className="rounded-2xl border border-border bg-card p-6 mb-10">
          <h2 className="font-serif text-xl font-semibold text-foreground mb-3">
            {t("conditionsTitle")}
          </h2>
          <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
            {t("conditionsBody")}
          </p>
        </div>

        {/* Three booking entries, carrying ?emergency=true */}
        <BookingButtonsGroup title={t("selectTitle")} emergency />

        {/* Back to home */}
        <div className="text-center mt-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

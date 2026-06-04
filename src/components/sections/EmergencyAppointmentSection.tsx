"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import ScrollReveal from "@/components/ui/ScrollReveal";

/**
 * Homepage "Prendre un rendez-vous d'urgence" call-to-action. Sits at the bottom
 * of the homepage body (just above the footer) and routes to the dedicated
 * /emergency page, which presents the urgent-request conditions before sending
 * the visitor into the standard booking funnel with ?emergency=true.
 */
export default function EmergencyAppointmentSection() {
  const t = useTranslations("EmergencyAppointment");

  return (
    <section className="relative py-20 bg-muted">
      <div className="max-w-4xl mx-auto px-6">
        <ScrollReveal variant="fade-up" duration={700}>
          <div className="relative overflow-hidden rounded-3xl border border-red-200 bg-red-50 p-8 md:p-12 text-center shadow-lg dark:border-red-900/40 dark:bg-red-950/20">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-red-100 text-red-600 mb-6 dark:bg-red-900/40 dark:text-red-300">
              <AlertCircle className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <h3 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-4">
              {t("homeTitle")}
            </h3>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
              {t("homeDescription")}
            </p>
            <Link
              href="/emergency"
              className="group inline-flex items-center gap-3 bg-red-600 text-white px-8 py-4 rounded-full font-semibold hover:bg-red-700 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
            >
              <span>{t("homeButton")}</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

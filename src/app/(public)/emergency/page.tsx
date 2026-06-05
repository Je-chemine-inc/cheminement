import Link from "next/link";
import { AlertCircle, ArrowLeft, Phone } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import BookingButtonsGroup from "@/components/appointments/BookingButtonsGroup";
import { getLegalDocument } from "@/lib/legal-content";
import type { LegalDocumentLocale } from "@/models/LegalDocument";

export const dynamic = "force-dynamic";

/**
 * Public "Consultation ponctuelle rapide" page (route/flag stay "emergency"
 * internally; the request is still triaged as a priority one at reception).
 *
 * Presents the conditions, a life-threatening-crisis disclaimer (this is NOT a
 * real-time crisis service), then routes the visitor into the standard booking
 * funnel via the three entry points (self / loved-one / patient) with
 * ?emergency=true so the request is flagged urgent at reception.
 *
 * CONDITIONS ARE ADMIN-EDITABLE: they come from the legal-documents CMS
 * (LegalDocument key "emergencyConditions") — editable at
 * /admin/dashboard/legal-documents. If the DB read fails we fall back to the
 * static i18n placeholder (EmergencyAppointment.conditionsBody) so the page
 * never renders empty.
 */
export default async function EmergencyAppointmentPage() {
  const t = await getTranslations("EmergencyAppointment");
  const rawLocale = await getLocale();
  const locale: LegalDocumentLocale = rawLocale === "fr" ? "fr" : "en";

  let conditionsTitle = t("conditionsTitle");
  let conditionsHtml: string | null = null;
  try {
    const doc = await getLegalDocument("emergencyConditions", locale);
    conditionsTitle = doc.title || conditionsTitle;
    conditionsHtml = doc.contentHtml || null;
  } catch (err) {
    console.error("[emergency] failed to load conditions document:", err);
  }

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

        {/* Specific conditions (admin-editable via the legal-documents CMS) */}
        <div className="rounded-2xl border border-border bg-card p-6 mb-10">
          <h2 className="font-serif text-xl font-semibold text-foreground mb-3">
            {conditionsTitle}
          </h2>
          {conditionsHtml ? (
            <div
              className="legal-prose text-muted-foreground leading-relaxed"
              dangerouslySetInnerHTML={{ __html: conditionsHtml }}
            />
          ) : (
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
              {t("conditionsBody")}
            </p>
          )}
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

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, RotateCcw, ArrowLeft } from "lucide-react";

/**
 * Error boundary for the admin legal-documents area (list + editor). Prevents a
 * render crash (e.g. inside the rich-text editor) from blanking the whole page —
 * client spec reported a "page blanche" on the legal docs. Instead of an empty
 * screen, this shows a recoverable fallback (retry / back to the list).
 */
export default function LegalDocumentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("AdminLegalDocuments");

  useEffect(() => {
    console.error("[legal-documents] render error:", error);
  }, [error]);

  return (
    <div className="space-y-4">
      <Link
        href="/admin/dashboard/legal-documents"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToList")}
      </Link>
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
          <div className="space-y-3">
            <div>
              <h2 className="font-medium text-foreground">{t("errorTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("errorBody")}</p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RotateCcw className="h-4 w-4" />
              {t("errorRetry")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

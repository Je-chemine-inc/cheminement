"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

export default function LegalBackButton() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations("Legal.ui");

  const from = searchParams.get("from");
  if (!from) return null;

  return (
    <div className="border-b border-border/60 bg-background">
      <div className="container mx-auto px-6 py-3">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToForm")}
        </button>
      </div>
    </div>
  );
}

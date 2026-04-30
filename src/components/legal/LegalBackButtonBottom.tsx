"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

export default function LegalBackButtonBottom() {
  const router = useRouter();
  const t = useTranslations("Legal.ui");

  return (
    <div className="border-t border-border/60 bg-accent/30">
      <div className="container mx-auto px-6 py-8 flex justify-center">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border text-sm text-foreground hover:bg-background transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToForm")}
        </button>
      </div>
    </div>
  );
}

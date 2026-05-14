"use client";

import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Professional library page — marketplace content is hidden per client spec
 * ("Masquer section bibliothèque pour professionnel comme pour les clients").
 * The route remains reachable so anyone navigating directly lands on a clear
 * Coming Soon message; the section will be re-enabled when the marketplace
 * launches.
 */
export default function LibraryPage() {
  const t = useTranslations("Dashboard.library");

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-border/20 bg-linear-to-br from-card via-card/80 to-card/30 p-8 shadow-lg">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground/70">
            {t("badge")}
          </p>
          <h1 className="font-serif text-3xl font-light text-foreground lg:text-4xl">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t("description")}
          </p>
        </div>
      </section>

      <section
        id="resources"
        className="rounded-3xl border border-dashed border-border/40 bg-card/60 p-10 text-center shadow-inner"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="mt-4 font-serif text-2xl font-light text-foreground">
          {t("comingSoonTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          {t("comingSoonDesc")}
        </p>
      </section>
    </div>
  );
}

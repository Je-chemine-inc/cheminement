"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

/**
 * Spec 002 phase 6 — the client sees who pays their sessions and how many
 * covered sessions are used (« 3/10 séances utilisées »). Renders nothing
 * without a coverage, or while organization billing is off (the API then
 * returns none).
 */

interface Coverage {
  id: string;
  organizationName: string;
  forLovedOne: string | null;
  mode: "full" | "split" | "per_session" | "external";
  used: number;
  max: number | null;
  status: "active" | "exhausted";
  validUntil: string | null;
}

export function ClientCoverageSummary() {
  const t = useTranslations("Client.billing.coverage");
  const locale = useLocale();
  const [coverages, setCoverages] = useState<Coverage[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/client/coverages")
      .then((res) => (res.ok ? res.json() : { coverages: [] }))
      .then((body: { coverages?: Coverage[] }) => {
        if (!cancelled) setCoverages(body.coverages ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (coverages.length === 0) return null;

  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "fr-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));

  return (
    <section className="space-y-4">
      {coverages.map((c) => {
        const exhausted = c.status === "exhausted" || (c.max !== null && c.used >= c.max);
        const oneLeft = !exhausted && c.max !== null && c.max - c.used === 1;
        return (
          <div key={c.id} className="rounded-3xl border border-teal-500/20 bg-teal-500/5 p-6 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-teal-500/10 p-3">
                <Building2 className="h-5 w-5 text-teal-700 dark:text-teal-400" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-lg font-medium text-foreground">
                    {t("title", { org: c.organizationName })}
                  </p>
                  {c.forLovedOne !== null && (
                    <p className="text-sm text-muted-foreground">
                      {c.forLovedOne ? t("forLovedOne", { name: c.forLovedOne }) : t("forALovedOne")}
                    </p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{t(`mode.${c.mode}`)}</p>

                {c.max !== null ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">{t("used", { used: c.used, max: c.max })}</span>
                      {c.validUntil && <span className="text-xs text-muted-foreground">{t("until", { date: day(c.validUntil) })}</span>}
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={c.max}
                      aria-valuenow={Math.min(c.used, c.max)}
                    >
                      <div
                        className={`h-full rounded-full ${exhausted ? "bg-amber-500" : "bg-teal-500"}`}
                        style={{ width: `${Math.min(100, (c.used / Math.max(1, c.max)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-foreground">
                    {t("usedNoCap", { used: c.used })}
                    {c.validUntil ? ` · ${t("until", { date: day(c.validUntil) })}` : ""}
                  </p>
                )}

                {exhausted && <p className="text-sm text-amber-700 dark:text-amber-400">{t("exhausted")}</p>}
                {oneLeft && <p className="text-sm text-amber-700 dark:text-amber-400">{t("oneLeft")}</p>}
                <p className="text-xs text-muted-foreground">{t("lateCancelNote")}</p>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

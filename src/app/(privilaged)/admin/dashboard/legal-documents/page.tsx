"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  FileText,
  Languages,
  ExternalLink,
  Pencil,
  Loader2,
} from "lucide-react";

interface LegalDocRow {
  id: string;
  documentKey: "terms" | "privacy" | "professionalTerms" | "cookies";
  locale: "fr" | "en";
  title: string;
  subtitle?: string;
  lastUpdated: string;
  version: string;
  updatedAt: string;
}

const DOCUMENT_KEYS = ["terms", "privacy", "professionalTerms", "cookies"] as const;

const PUBLIC_PATH: Record<LegalDocRow["documentKey"], string> = {
  terms: "/terms",
  privacy: "/privacy",
  professionalTerms: "/professional-terms",
  cookies: "/cookies",
};

export default function LegalDocumentsListPage() {
  const t = useTranslations("AdminLegalDocuments");

  const [rows, setRows] = useState<LegalDocRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/legal-documents", {
          cache: "no-store",
        });
        if (!res.ok) {
          const text = await res.text();
          let detail = text;
          try {
            const parsed = JSON.parse(text);
            detail = parsed?.error ?? parsed?.details ?? text;
          } catch {}
          throw new Error(`[${res.status}] ${detail || "Request failed"}`);
        }
        const data = (await res.json()) as LegalDocRow[];
        setRows(data);
      } catch (err) {
        console.error("List load error:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load documents",
        );
      }
    })();
  }, []);

  const grouped = rows
    ? DOCUMENT_KEYS.map((key) => ({
        key,
        entries: rows
          .filter((r) => r.documentKey === key)
          .sort((a, b) => a.locale.localeCompare(b.locale)),
      }))
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted-foreground font-light">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!rows && !error ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : null}

      {grouped ? (
        <div className="space-y-4">
          {grouped.map(({ key, entries }) => {
            const first = entries[0];
            return (
              <div
                key={key}
                className="rounded-xl border border-border/40 bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-serif text-lg font-medium text-foreground">
                        {t(`documents.${key}.label`)}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {t(`documents.${key}.description`)}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={PUBLIC_PATH[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("viewPublic")}
                  </Link>
                </div>

                <div className="divide-y divide-border/40">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                    >
                      <div className="flex items-center gap-3">
                        <Languages className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {entry.locale === "fr"
                              ? t("localeFrench")
                              : t("localeEnglish")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("lastUpdatedLabel")} · {entry.lastUpdated}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/admin/dashboard/legal-documents/${entry.id}/edit`}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("edit")}
                      </Link>
                    </div>
                  ))}
                  {first ? null : (
                    <div className="px-6 py-4 text-sm text-muted-foreground">
                      {t("empty")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

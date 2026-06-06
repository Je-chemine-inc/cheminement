"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Mail, Languages, Pencil, Loader2 } from "lucide-react";

type Locale = "fr" | "en";

interface TemplateRow {
  id: string;
  templateKey: string;
  locale: Locale;
  subject: string;
  title: string;
  updatedAt: string;
}

interface DefinitionRow {
  key: TemplateRow["templateKey"];
  labelFr: string;
  labelEn: string;
  descriptionFr: string;
  descriptionEn: string;
}

interface ApiResponse {
  templates: TemplateRow[];
  definitions: DefinitionRow[];
}

export default function AdminEmailTemplatesPage() {
  const t = useTranslations("AdminEmailTemplates");
  const locale = useLocale() as Locale;

  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/email-templates", {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "Failed to load");
        }
        const json = (await res.json()) as ApiResponse;
        setData(json);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">
          {t("title")}
        </h1>
        <p className="mt-2 text-muted-foreground font-light">{t("subtitle")}</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!data && !error ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : null}

      {data ? (
        <div className="space-y-4">
          {data.definitions.map((def) => {
            const entries = data.templates
              .filter((tpl) => tpl.templateKey === def.key)
              .sort((a, b) => a.locale.localeCompare(b.locale));
            return (
              <div
                key={def.key}
                className="rounded-xl border border-border/40 bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-serif text-lg font-medium text-foreground">
                        {locale === "fr" ? def.labelFr : def.labelEn}
                      </h2>
                      <p className="text-xs text-muted-foreground max-w-2xl">
                        {locale === "fr"
                          ? def.descriptionFr
                          : def.descriptionEn}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-border/40">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Languages className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {entry.locale === "fr"
                              ? t("localeFrench")
                              : t("localeEnglish")}
                          </p>
                          <p className="text-xs text-muted-foreground truncate max-w-md">
                            {t("subjectLabel")} · {entry.subject}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/admin/dashboard/email-templates/${entry.id}/edit`}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("edit")}
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

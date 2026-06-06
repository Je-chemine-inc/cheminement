"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import EmailTemplateEditor from "@/components/admin/EmailTemplateEditor";

interface Placeholder {
  key: string;
  labelFr: string;
  labelEn: string;
  sampleFr: string;
  sampleEn: string;
}

interface TemplateDTO {
  id: string;
  templateKey: string;
  locale: "fr" | "en";
  subject: string;
  title: string;
  subtitle?: string;
  bodyHtml: string;
  ctaText?: string;
  updatedAt: string;
  definition?: {
    key: string;
    labelFr: string;
    labelEn: string;
    descriptionFr: string;
    descriptionEn: string;
    placeholders: Placeholder[];
  };
}

export default function EmailTemplateEditPage() {
  const t = useTranslations("AdminEmailTemplates");
  const locale = useLocale() as "fr" | "en";
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [tpl, setTpl] = useState<TemplateDTO | null>(null);
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/email-templates/${id}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? "Failed to load");
        }
        const data = (await res.json()) as TemplateDTO;
        setTpl(data);
        setSubject(data.subject);
        setTitle(data.title);
        setSubtitle(data.subtitle ?? "");
        setBodyHtml(data.bodyHtml);
        setCtaText(data.ctaText ?? "");
      } catch (err) {
        console.error(err);
        setLoadError(
          err instanceof Error ? err.message : "Failed to load template",
        );
      }
    })();
  }, [id]);

  const dirty = useMemo(() => {
    if (!tpl) return false;
    return (
      subject !== tpl.subject ||
      title !== tpl.title ||
      subtitle !== (tpl.subtitle ?? "") ||
      bodyHtml !== tpl.bodyHtml ||
      ctaText !== (tpl.ctaText ?? "")
    );
  }, [tpl, subject, title, subtitle, bodyHtml, ctaText]);

  const placeholders = tpl?.definition?.placeholders ?? [];

  const handleSave = async () => {
    if (!id || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/email-templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          title,
          subtitle,
          bodyHtml,
          ctaText,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to save");
      }
      const data = (await res.json()) as TemplateDTO;
      setTpl((prev) => (prev ? { ...prev, ...data } : data));
      setSubject(data.subject);
      setTitle(data.title);
      setSubtitle(data.subtitle ?? "");
      setBodyHtml(data.bodyHtml);
      setCtaText(data.ctaText ?? "");
      setSavedAt(new Date());
    } catch (err) {
      console.error(err);
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/dashboard/email-templates"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToList")}
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError}
        </div>
      </div>
    );
  }

  if (!tpl) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const templateLabel = tpl.definition
    ? locale === "fr"
      ? tpl.definition.labelFr
      : tpl.definition.labelEn
    : tpl.templateKey;
  const templateDescription = tpl.definition
    ? locale === "fr"
      ? tpl.definition.descriptionFr
      : tpl.definition.descriptionEn
    : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/admin/dashboard/email-templates"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToList")}
          </Link>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {templateLabel}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            {templateDescription}
          </p>
          <p className="text-xs text-muted-foreground">
            {tpl.locale === "fr" ? t("localeFrench") : t("localeEnglish")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("save")}
          </button>
        </div>
      </div>

      {savedAt ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          {t("savedAt", { time: savedAt.toLocaleTimeString() })}
        </div>
      ) : null}
      {saveError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {saveError}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/40 bg-card p-6 space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t("fieldSubject")}
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fieldTitle")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fieldSubtitle")}
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t("fieldBody")}
          </label>
          <p className="text-xs text-muted-foreground">{t("bodyHint")}</p>
          <EmailTemplateEditor
            value={tpl.bodyHtml}
            onChange={setBodyHtml}
            placeholders={placeholders}
            locale={locale}
            placeholdersLabel={t("placeholdersLabel")}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t("fieldCta")}
          </label>
          <p className="text-xs text-muted-foreground">{t("ctaHint")}</p>
          <input
            type="text"
            value={ctaText}
            onChange={(e) => setCtaText(e.target.value)}
            placeholder={t("ctaPlaceholder")}
            className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {placeholders.length > 0 ? (
        <div className="rounded-xl border border-border/40 bg-muted/20 p-5 space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("placeholdersLabel")}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {placeholders.map((p) => (
              <li
                key={p.key}
                className="flex items-start gap-2 text-xs text-foreground"
              >
                <span className="inline-flex shrink-0 items-center rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[11px] text-primary">{`{{${p.key}}}`}</span>
                <span className="text-muted-foreground">
                  {locale === "fr" ? p.labelFr : p.labelEn}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

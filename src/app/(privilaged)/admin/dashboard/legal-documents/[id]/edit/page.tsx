"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import LegalDocumentEditor from "@/components/admin/LegalDocumentEditor";

interface LegalDocDTO {
  id: string;
  documentKey:
    | "terms"
    | "privacy"
    | "professionalTerms"
    | "cookies"
    | "emergencyConditions";
  locale: "fr" | "en";
  title: string;
  subtitle?: string;
  lastUpdated: string;
  version: string;
  contentHtml: string;
  updatedAt: string;
}

const PUBLIC_PATH: Record<LegalDocDTO["documentKey"], string> = {
  terms: "/terms",
  privacy: "/privacy",
  professionalTerms: "/professional-terms",
  cookies: "/cookies",
  emergencyConditions: "/emergency",
};

export default function LegalDocumentEditPage() {
  const t = useTranslations("AdminLegalDocuments");
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [doc, setDoc] = useState<LegalDocDTO | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/legal-documents/${id}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? "Failed to load");
        }
        const data = (await res.json()) as LegalDocDTO;
        setDoc(data);
        setTitle(data.title);
        setSubtitle(data.subtitle ?? "");
        setContentHtml(data.contentHtml);
      } catch (err) {
        console.error("Load error:", err);
        setLoadError(
          err instanceof Error ? err.message : "Failed to load document",
        );
      }
    })();
  }, [id]);

  const dirty = useMemo(() => {
    if (!doc) return false;
    return (
      title !== doc.title ||
      subtitle !== (doc.subtitle ?? "") ||
      contentHtml !== doc.contentHtml
    );
  }, [doc, title, subtitle, contentHtml]);

  const handleSave = async () => {
    if (!id || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/legal-documents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          subtitle,
          contentHtml,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to save");
      }
      const data = (await res.json()) as LegalDocDTO;
      setDoc(data);
      setTitle(data.title);
      setSubtitle(data.subtitle ?? "");
      setContentHtml(data.contentHtml);
      setSavedAt(new Date());
    } catch (err) {
      console.error("Save error:", err);
      setSaveError(
        err instanceof Error ? err.message : "Failed to save document",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/dashboard/legal-documents"
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

  if (!doc) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/admin/dashboard/legal-documents"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToList")}
          </Link>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t(`documents.${doc.documentKey}.label`)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {doc.locale === "fr" ? t("localeFrench") : t("localeEnglish")} ·{" "}
            {t("lastUpdatedLabel")} {doc.lastUpdated}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={PUBLIC_PATH[doc.documentKey]}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
            {t("viewPublic")}
          </Link>
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
          {t("savedAt", {
            time: savedAt.toLocaleTimeString(),
          })}
        </div>
      ) : null}
      {saveError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {saveError}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/40 bg-card p-6 space-y-5">
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
            {t("fieldContent")}
          </label>
          <p className="text-xs text-muted-foreground">{t("contentHint")}</p>
          <LegalDocumentEditor
            value={doc.contentHtml}
            onChange={setContentHtml}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("versionNote", { version: doc.version })}
      </p>
    </div>
  );
}

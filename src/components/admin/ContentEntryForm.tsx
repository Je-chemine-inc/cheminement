"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Save,
  ImagePlus,
  Trash2,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  PlayCircle,
  Podcast,
  Link2,
} from "lucide-react";
import ContentEntryEditor from "@/components/admin/ContentEntryEditor";
import { MEDIA_TYPES, type ContentKind, type MediaType } from "@/lib/content-kind";

export interface ContentEntryFormValues {
  slug: string;
  titleFr: string;
  titleEn: string;
  summaryFr: string;
  summaryEn: string;
  iconUrl: string;
  contentHtmlFr: string;
  contentHtmlEn: string;
  mediaType: MediaType;
  mediaUrl: string;
  status: "draft" | "published";
  sortOrder: number;
}

const MEDIA_TYPE_ICON: Record<MediaType, typeof FileText> = {
  article: FileText,
  video: PlayCircle,
  podcast: Podcast,
};

interface Props {
  kind: ContentKind;
  initialValues: ContentEntryFormValues;
  /** When false the slug input is locked (edit mode after first publish). */
  slugEditable: boolean;
  /** Auto-derive slug from titleFr while user types (create mode only). */
  autoSlugFromTitle: boolean;
  onSubmit: (
    values: ContentEntryFormValues,
  ) => Promise<{ ok: boolean; error?: string }>;
  submitLabel: string;
  saved?: boolean;
  savedMessage?: string;
}

function slugifyClient(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function ContentEntryForm({
  kind,
  initialValues,
  slugEditable,
  autoSlugFromTitle,
  onSubmit,
  submitLabel,
  saved,
  savedMessage,
}: Props) {
  const t = useTranslations("AdminContent");
  const [values, setValues] = useState<ContentEntryFormValues>(initialValues);
  const [activeLocale, setActiveLocale] = useState<"fr" | "en">("fr");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const slugTouchedRef = useRef<boolean>(!autoSlugFromTitle);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const dirty = useMemo(() => {
    return JSON.stringify(values) !== JSON.stringify(initialValues);
  }, [values, initialValues]);

  const update = <K extends keyof ContentEntryFormValues>(
    key: K,
    value: ContentEntryFormValues[K],
  ) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const handleTitleFrChange = (value: string) => {
    setValues((v) => {
      const next = { ...v, titleFr: value };
      if (autoSlugFromTitle && !slugTouchedRef.current) {
        next.slug = slugifyClient(value);
      }
      return next;
    });
  };

  const handleSlugChange = (value: string) => {
    slugTouchedRef.current = true;
    update("slug", slugifyClient(value));
  };

  const handleIconPick = () => {
    iconInputRef.current?.click();
  };

  const handleIconFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingIcon(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "content");
      const res = await fetch("/api/admin/uploads", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Upload failed");
      }
      const { url } = (await res.json()) as { url: string };
      update("iconUrl", url);
    } catch (err) {
      console.error("Icon upload error:", err);
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (!values.titleFr.trim() || !values.titleEn.trim()) {
      setError(t("errorTitlesRequired"));
      return;
    }
    if (!values.slug) {
      setError(t("errorSlugRequired"));
      return;
    }

    setSaving(true);
    try {
      const result = await onSubmit(values);
      if (!result.ok) {
        setError(result.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const isMedia = kind === "media";
  const isDateSorted = kind === "nouveaute" || isMedia;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          {savedMessage ?? t("savedDefault")}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/40 bg-card p-6 space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fieldTitleFr")}
              <span className="ml-1 text-destructive">*</span>
            </label>
            <input
              type="text"
              value={values.titleFr}
              onChange={(e) => handleTitleFrChange(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fieldTitleEn")}
              <span className="ml-1 text-destructive">*</span>
            </label>
            <input
              type="text"
              value={values.titleEn}
              onChange={(e) => update("titleEn", e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-[1fr_180px]">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fieldSlug")}
              <span className="ml-1 text-destructive">*</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {t(`pathPrefix_${kind}`)}/
              </span>
              <input
                type="text"
                value={values.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                disabled={!slugEditable}
                className="flex-1 rounded-lg border border-border/60 bg-background px-4 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted/30 disabled:text-muted-foreground"
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {slugEditable ? t("slugHintEditable") : t("slugHintLocked")}
            </p>
          </div>
          {!isDateSorted ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t("fieldSortOrder")}
              </label>
              <input
                type="number"
                value={values.sortOrder}
                onChange={(e) =>
                  update("sortOrder", Number(e.target.value) || 0)
                }
                className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground">
                {t("sortOrderHint")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t("fieldDateSortHint")}
              </label>
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                {t("nouveauteSortHint")}
              </p>
            </div>
          )}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fieldSummaryFr")}
            </label>
            <textarea
              value={values.summaryFr}
              onChange={(e) => update("summaryFr", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder={t("summaryPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fieldSummaryEn")}
            </label>
            <textarea
              value={values.summaryEn}
              onChange={(e) => update("summaryEn", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder={t("summaryPlaceholder")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t("fieldIcon")}
          </label>
          <p className="text-xs text-muted-foreground">{t("iconHint")}</p>
          <div className="flex items-center gap-4">
            {values.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={values.iconUrl}
                alt=""
                className="h-16 w-16 rounded-lg border border-border/60 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border/60 text-muted-foreground">
                <ImagePlus className="h-6 w-6" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleIconPick}
                disabled={uploadingIcon}
                className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                {uploadingIcon ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
                {values.iconUrl ? t("iconReplace") : t("iconUpload")}
              </button>
              {values.iconUrl ? (
                <button
                  type="button"
                  onClick={() => update("iconUrl", "")}
                  className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("iconRemove")}
                </button>
              ) : null}
            </div>
            <input
              ref={iconInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={handleIconFile}
            />
          </div>
        </div>
      </div>

      {isMedia ? (
        <div className="space-y-5 rounded-xl border border-border/40 bg-card p-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fieldMediaType")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("mediaTypeHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              {MEDIA_TYPES.map((type) => {
                const Icon = MEDIA_TYPE_ICON[type];
                const active = values.mediaType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => update("mediaType", type)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {t(`mediaType_${type}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t(`mediaUrlLabel_${values.mediaType}`)}
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 focus-within:ring-2 focus-within:ring-primary">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="url"
                value={values.mediaUrl}
                onChange={(e) => update("mediaUrl", e.target.value)}
                placeholder={t(`mediaUrlPlaceholder_${values.mediaType}`)}
                className="w-full bg-transparent py-2 text-sm text-foreground focus:outline-none"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t(`mediaUrlHint_${values.mediaType}`)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border/40 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
          <div className="inline-flex rounded-lg border border-border/60 bg-background p-0.5">
            <button
              type="button"
              onClick={() => setActiveLocale("fr")}
              className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                activeLocale === "fr"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("tabFrench")}
            </button>
            <button
              type="button"
              onClick={() => setActiveLocale("en")}
              className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                activeLocale === "en"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("tabEnglish")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t("contentHint")}</p>
        </div>
        <div className="p-4">
          {activeLocale === "fr" ? (
            <ContentEntryEditor
              key="fr"
              value={values.contentHtmlFr}
              onChange={(html) => update("contentHtmlFr", html)}
            />
          ) : (
            <ContentEntryEditor
              key="en"
              value={values.contentHtmlEn}
              onChange={(html) => update("contentHtmlEn", html)}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-card p-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            {t("statusLabel")}
          </p>
          <p className="text-xs text-muted-foreground">{t("statusHint")}</p>
        </div>
        <div className="inline-flex rounded-lg border border-border/60 bg-background p-0.5">
          <button
            type="button"
            onClick={() => update("status", "draft")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              values.status === "draft"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {t("statusDraft")}
          </button>
          <button
            type="button"
            onClick={() => update("status", "published")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              values.status === "published"
                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            {t("statusPublished")}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

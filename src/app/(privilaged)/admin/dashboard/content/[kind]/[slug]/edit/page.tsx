"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import ContentEntryForm, {
  type ContentEntryFormValues,
} from "@/components/admin/ContentEntryForm";
import {
  isContentKind,
  type ContentKind,
  type MediaType,
} from "@/lib/content-kind";

interface PairDTO {
  kind: ContentKind;
  slug: string;
  sortOrder: number;
  publishedAt?: string;
  fr: {
    title: string;
    summary: string;
    iconUrl?: string;
    contentHtml: string;
    mediaType?: MediaType;
    mediaUrl?: string;
    status: "draft" | "published";
  };
  en: {
    title: string;
    summary: string;
    iconUrl?: string;
    contentHtml: string;
    mediaType?: MediaType;
    mediaUrl?: string;
    status: "draft" | "published";
  };
}

const PUBLIC_BASE: Record<ContentKind, string> = {
  problematique: "/explore",
  traitement: "/approaches",
  nouveaute: "/nouveautes",
  media: "/medias",
  resource: "/book",
};

export default function EditContentEntryPage() {
  const t = useTranslations("AdminContent");
  const params = useParams<{ kind: string; slug: string }>();
  const searchParams = useSearchParams();
  const kind = params?.kind && isContentKind(params.kind) ? params.kind : null;
  const slug = params?.slug;
  const justCreated = searchParams?.get("created") === "1";

  const [values, setValues] = useState<ContentEntryFormValues | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(justCreated);
  const [wasPublished, setWasPublished] = useState(false);

  const load = useCallback(async () => {
    if (!kind || !slug) return;
    try {
      const res = await fetch(`/api/admin/content/${kind}/${slug}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to load");
      }
      const data = (await res.json()) as PairDTO;
      setValues({
        slug: data.slug,
        titleFr: data.fr.title,
        titleEn: data.en.title,
        summaryFr: data.fr.summary,
        summaryEn: data.en.summary,
        iconUrl: data.fr.iconUrl ?? "",
        contentHtmlFr: data.fr.contentHtml,
        contentHtmlEn: data.en.contentHtml,
        mediaType: data.fr.mediaType ?? "article",
        mediaUrl: data.fr.mediaUrl ?? "",
        status: data.fr.status,
        sortOrder: data.sortOrder,
      });
      setWasPublished(data.fr.status === "published");
    } catch (err) {
      console.error("Load error:", err);
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [kind, slug]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (next: ContentEntryFormValues) => {
    if (!kind || !slug) return { ok: false, error: "Missing params" };
    try {
      const res = await fetch(`/api/admin/content/${kind}/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleFr: next.titleFr,
          titleEn: next.titleEn,
          summaryFr: next.summaryFr,
          summaryEn: next.summaryEn,
          iconUrl: next.iconUrl || null,
          contentHtmlFr: next.contentHtmlFr,
          contentHtmlEn: next.contentHtmlEn,
          mediaType: next.mediaType,
          mediaUrl: next.mediaUrl || null,
          status: next.status,
          sortOrder: next.sortOrder,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, error: data?.error ?? "Failed to save" };
      }
      setSaved(true);
      setWasPublished(next.status === "published");
      await load();
      return { ok: true };
    } catch (err) {
      console.error("Save error:", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to save",
      };
    }
  };

  if (!kind) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Unknown content kind.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link
          href={`/admin/dashboard/content/${kind}`}
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

  if (!values) {
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
            href={`/admin/dashboard/content/${kind}`}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToList")}
          </Link>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {values.titleFr}
          </h1>
          <p className="text-sm text-muted-foreground font-mono">
            {PUBLIC_BASE[kind]}/{values.slug}
          </p>
        </div>
        {wasPublished ? (
          <Link
            href={`${PUBLIC_BASE[kind]}/${values.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
            {t("viewPublic")}
          </Link>
        ) : null}
      </div>

      <ContentEntryForm
        kind={kind}
        initialValues={values}
        slugEditable={!wasPublished}
        autoSlugFromTitle={false}
        onSubmit={handleSubmit}
        submitLabel={t("editSubmit")}
        saved={saved}
        savedMessage={justCreated ? t("createdMessage") : t("savedDefault")}
      />
    </div>
  );
}

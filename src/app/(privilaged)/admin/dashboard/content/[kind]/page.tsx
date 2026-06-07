"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpenCheck,
  Pencil,
  Plus,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Circle,
  Trash2,
  FileText,
  PlayCircle,
  Podcast,
} from "lucide-react";
import {
  isContentKind,
  isDateSortedKind,
  type ContentKind,
  type MediaType,
} from "@/lib/content-kind";

const MEDIA_TYPE_ICON: Record<MediaType, typeof FileText> = {
  article: FileText,
  video: PlayCircle,
  podcast: Podcast,
};

interface ContentDTO {
  id: string;
  slug: string;
  locale: "fr" | "en";
  title: string;
  summary: string;
  iconUrl?: string;
  mediaType?: MediaType;
  mediaUrl?: string;
  status: "draft" | "published";
  sortOrder: number;
  publishedAt?: string;
  updatedAt: string;
}

interface PairDTO {
  kind: ContentKind;
  slug: string;
  sortOrder: number;
  publishedAt?: string;
  fr: ContentDTO;
  en: ContentDTO;
}

const PUBLIC_BASE: Record<ContentKind, string> = {
  problematique: "/explore",
  traitement: "/approaches",
  nouveaute: "/nouveautes",
  media: "/medias",
  resource: "/book",
};

export default function ContentListPage() {
  const t = useTranslations("AdminContent");
  const params = useParams<{ kind: string }>();
  const kind = params?.kind && isContentKind(params.kind) ? params.kind : null;

  const [rows, setRows] = useState<PairDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    if (!kind) return;
    try {
      const res = await fetch(`/api/admin/content/${kind}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to load");
      }
      const data = (await res.json()) as { items: PairDTO[] };
      setRows(data.items);
    } catch (err) {
      console.error("List load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const counts = useMemo(() => {
    if (!rows) return { total: 0, published: 0, drafts: 0 };
    return {
      total: rows.length,
      published: rows.filter((r) => r.fr.status === "published").length,
      drafts: rows.filter((r) => r.fr.status === "draft").length,
    };
  }, [rows]);

  if (!kind) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Unknown content kind.
      </div>
    );
  }

  const handleDelete = async (slug: string) => {
    if (!window.confirm(t("deleteConfirm", { slug }))) return;
    setDeleting(slug);
    try {
      const res = await fetch(`/api/admin/content/${kind}/${slug}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to delete");
      }
      await load();
    } catch (err) {
      console.error("Delete error:", err);
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(null);
    }
  };

  const isDateSorted = isDateSortedKind(kind);
  const isMedia = kind === "media";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t(`kind_${kind}.title`)}
          </h1>
          <p className="mt-2 text-muted-foreground font-light">
            {t(`kind_${kind}.subtitle`)}
          </p>
        </div>
        <Link
          href={`/admin/dashboard/content/${kind}/new`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t(`kind_${kind}.createButton`)}
        </Link>
      </div>

      {rows ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t("statTotal")} value={counts.total} />
          <StatCard label={t("statPublished")} value={counts.published} />
          <StatCard label={t("statDrafts")} value={counts.drafts} />
        </div>
      ) : null}

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

      {rows && rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-12 text-center text-muted-foreground">
          <BookOpenCheck className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p className="font-light">{t(`kind_${kind}.empty`)}</p>
        </div>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border/40 bg-card">
          <table className="w-full">
            <thead className="border-b border-border/40 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t("colTitle")}</th>
                <th className="px-4 py-3 font-medium">{t("colSlug")}</th>
                <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-4 py-3 font-medium">
                  {isDateSorted ? t("colPublishedAt") : t("colUpdated")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("colActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row) => {
                const fr = row.fr;
                const isPublished = fr.status === "published";
                const dateStr = isDateSorted
                  ? row.publishedAt
                    ? new Date(row.publishedAt).toLocaleDateString()
                    : "—"
                  : new Date(fr.updatedAt).toLocaleDateString();
                const MediaIcon =
                  isMedia && fr.mediaType
                    ? MEDIA_TYPE_ICON[fr.mediaType]
                    : null;
                return (
                  <tr key={row.slug} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {fr.iconUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={fr.iconUrl}
                            alt=""
                            className="h-9 w-9 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            {MediaIcon ? (
                              <MediaIcon className="h-4 w-4" />
                            ) : (
                              <BookOpenCheck className="h-4 w-4" />
                            )}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">
                              {fr.title}
                            </p>
                            {isMedia && fr.mediaType ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {MediaIcon ? (
                                  <MediaIcon className="h-3 w-3" />
                                ) : null}
                                {t(`mediaType_${fr.mediaType}`)}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            EN · {row.en.title}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {row.slug}
                    </td>
                    <td className="px-4 py-3">
                      {isPublished ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-3 w-3" />
                          {t("statusPublished")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          <Circle className="h-3 w-3" />
                          {t("statusDraft")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {dateStr}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {isPublished ? (
                          <Link
                            href={`${PUBLIC_BASE[kind]}/${row.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={t("viewPublic")}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        ) : null}
                        <Link
                          href={`/admin/dashboard/content/${kind}/${row.slug}/edit`}
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t("edit")}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(row.slug)}
                          disabled={deleting === row.slug}
                          className="inline-flex items-center gap-1 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          title={t("delete")}
                        >
                          {deleting === row.slug ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-light text-foreground">{value}</p>
    </div>
  );
}

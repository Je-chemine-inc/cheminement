"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Clapperboard,
  FileText,
  Headphones,
  PlayCircle,
  Podcast,
} from "lucide-react";
import type { MediaType } from "@/lib/content-kind";

export interface MediaItem {
  slug: string;
  title: string;
  summary: string;
  iconUrl?: string;
  mediaType: MediaType;
  publishedAt?: string;
}

type Filter = "all" | MediaType;

const TYPE_META: Record<
  MediaType,
  { icon: typeof FileText; accent: string }
> = {
  article: { icon: FileText, accent: "text-sky-600 dark:text-sky-400" },
  video: { icon: PlayCircle, accent: "text-rose-600 dark:text-rose-400" },
  podcast: { icon: Podcast, accent: "text-violet-600 dark:text-violet-400" },
};

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(locale === "fr" ? "fr-CA" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function MediaGallery({
  items,
  locale,
}: {
  items: MediaItem[];
  locale: string;
}) {
  const t = useTranslations("Press");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    return {
      all: items.length,
      article: items.filter((i) => i.mediaType === "article").length,
      video: items.filter((i) => i.mediaType === "video").length,
      podcast: items.filter((i) => i.mediaType === "podcast").length,
    };
  }, [items]);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? items
        : items.filter((i) => i.mediaType === filter),
    [items, filter],
  );

  const filters: { key: Filter; count: number }[] = [
    { key: "all", count: counts.all },
    { key: "article", count: counts.article },
    { key: "video", count: counts.video },
    { key: "podcast", count: counts.podcast },
  ];

  return (
    <div className="space-y-10">
      {/* Filter chips */}
      <div className="flex flex-wrap justify-center gap-2">
        {filters.map(({ key, count }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {t(`filter_${key}`)}
              <span
                className={`rounded-full px-1.5 text-xs ${
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-border/60 p-12 text-center text-muted-foreground">
          <Clapperboard className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p>{t("emptyFiltered")}</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
          {filtered.map((item) => {
            const meta = TYPE_META[item.mediaType];
            const Icon = meta.icon;
            return (
              <Link
                key={item.slug}
                href={`/medias/${item.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border/40 bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  {item.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.iconUrl}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 via-accent/30 to-background">
                      <Icon className="h-12 w-12 text-primary/40" />
                    </div>
                  )}

                  {/* Type badge */}
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur">
                    <Icon className={`h-3.5 w-3.5 ${meta.accent}`} />
                    {t(`type_${item.mediaType}`)}
                  </span>

                  {/* Play overlay for video/podcast */}
                  {item.mediaType !== "article" ? (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-background/85 text-primary shadow-lg backdrop-blur transition-transform duration-300 group-hover:scale-110">
                        {item.mediaType === "video" ? (
                          <PlayCircle className="h-7 w-7" />
                        ) : (
                          <Headphones className="h-7 w-7" />
                        )}
                      </span>
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col gap-3 p-5">
                  {item.publishedAt ? (
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {formatDate(item.publishedAt, locale)}
                    </p>
                  ) : null}
                  <h2 className="font-serif text-xl font-light leading-snug text-foreground line-clamp-2">
                    {item.title}
                  </h2>
                  {item.summary ? (
                    <p className="flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-3">
                      {item.summary}
                    </p>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span className="inline-flex items-center gap-1 text-sm font-light text-primary transition-colors group-hover:text-primary/80">
                    {t(`cta_${item.mediaType}`)}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

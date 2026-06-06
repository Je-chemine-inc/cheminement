import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Clapperboard } from "lucide-react";
import { listPublishedContent } from "@/lib/content-entry";
import type { ContentLocale } from "@/models/ContentEntry";
import MediaGallery, { type MediaItem } from "@/components/media/MediaGallery";

export const dynamic = "force-dynamic";

async function loadEntries(): Promise<MediaItem[]> {
  const localeRaw = await getLocale();
  const locale: ContentLocale = localeRaw === "fr" ? "fr" : "en";
  const docs = await listPublishedContent("media", locale);
  return docs.map((d) => ({
    slug: d.slug,
    title: d.title,
    summary: d.summary,
    iconUrl: d.iconUrl,
    mediaType: d.mediaType ?? "article",
    publishedAt: d.publishedAt,
  }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Press");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function PressPage() {
  const items = await loadEntries();
  const locale = await getLocale();
  const t = await getTranslations("Press");

  return (
    <article className="bg-background">
      <header className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto px-6 py-16 md:py-20">
          <div className="mx-auto max-w-4xl space-y-4 text-center">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
              <Clapperboard className="h-4 w-4" />
              {t("badge")}
            </p>
            <h1 className="font-serif text-3xl font-light leading-tight text-foreground md:text-4xl lg:text-5xl">
              {t("title")}
            </h1>
            <p className="mx-auto max-w-2xl text-base text-muted-foreground md:text-lg">
              {t("subtitle")}
            </p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-16">
        {items.length === 0 ? (
          <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-border/60 p-12 text-center text-muted-foreground">
            <Clapperboard className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p>{t("empty")}</p>
          </div>
        ) : (
          <MediaGallery items={items} locale={locale} />
        )}
      </div>
    </article>
  );
}

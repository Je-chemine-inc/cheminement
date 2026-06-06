import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FileText,
  PlayCircle,
  Podcast,
} from "lucide-react";
import { getPublishedContent } from "@/lib/content-entry";
import { getMediaEmbed } from "@/lib/media-embed";
import type { ContentLocale, MediaType } from "@/models/ContentEntry";

export const dynamic = "force-dynamic";

const TYPE_ICON: Record<MediaType, typeof FileText> = {
  article: FileText,
  video: PlayCircle,
  podcast: Podcast,
};

async function loadEntry(slug: string) {
  const localeRaw = await getLocale();
  const locale: ContentLocale = localeRaw === "fr" ? "fr" : "en";
  return getPublishedContent("media", slug, locale);
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(locale === "fr" ? "fr-CA" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await loadEntry(slug);
  if (!doc) return { title: "Not found" };
  return {
    title: doc.title,
    description: doc.summary || undefined,
  };
}

export default async function PressItemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await loadEntry(slug);
  if (!doc) {
    notFound();
  }
  const locale = await getLocale();
  const t = await getTranslations("Press");

  const mediaType: MediaType = doc.mediaType ?? "article";
  const Icon = TYPE_ICON[mediaType];
  const embed = getMediaEmbed(mediaType, doc.mediaUrl);

  return (
    <article className="bg-background">
      <div className="border-b border-border/60 bg-background">
        <div className="container mx-auto px-6 py-3">
          <Link
            href="/medias"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToList")}
          </Link>
        </div>
      </div>

      <header className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto px-6 py-14 md:py-16">
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm">
                <Icon className="h-3.5 w-3.5 text-primary" />
                {t(`type_${mediaType}`)}
              </span>
              {doc.publishedAt ? (
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  {formatDate(doc.publishedAt, locale)}
                </p>
              ) : null}
            </div>
            <h1 className="font-serif text-3xl font-light leading-tight text-foreground md:text-4xl lg:text-5xl">
              {doc.title}
            </h1>
            {doc.summary ? (
              <p className="max-w-3xl text-base text-muted-foreground md:text-lg">
                {doc.summary}
              </p>
            ) : null}

            {/* Hero image for articles (videos/podcasts show their player below) */}
            {mediaType === "article" && doc.iconUrl ? (
              <div className="relative mt-4 aspect-video w-full overflow-hidden rounded-2xl border border-border/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={doc.iconUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-12 md:py-16">
        <div className="mx-auto w-full max-w-3xl space-y-8">
          {/* Inline player for embeddable videos/podcasts */}
          {embed?.kind === "iframe" && embed.aspect === "video" ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border/60 bg-black">
              <iframe
                src={embed.src}
                title={doc.title}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </div>
          ) : null}

          {embed?.kind === "iframe" && embed.aspect === "audio" ? (
            <div className="overflow-hidden rounded-2xl border border-border/60">
              <iframe
                src={embed.src}
                title={doc.title}
                className="w-full"
                height={180}
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
              />
            </div>
          ) : null}

          {/* Native player for direct video files (.mp4/.webm/...) */}
          {embed?.kind === "video-file" ? (
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-black">
              <video
                src={embed.src}
                controls
                playsInline
                preload="metadata"
                poster={mediaType === "video" ? doc.iconUrl : undefined}
                className="aspect-video w-full"
              />
            </div>
          ) : null}

          {/* Native player for direct audio files (.mp3/.m4a/...) */}
          {embed?.kind === "audio-file" ? (
            <div className="rounded-2xl border border-border/60 bg-card p-4">
              <audio src={embed.src} controls preload="metadata" className="w-full" />
            </div>
          ) : null}

          {/* External link fallback (provider not embeddable, or article link) */}
          {embed?.kind === "link" ? (
            <a
              href={embed.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ExternalLink className="h-4 w-4" />
              {t(`externalCta_${mediaType}`)}
            </a>
          ) : null}

          {doc.contentHtml?.trim() ? (
            <div
              className="legal-prose w-full"
              dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
            />
          ) : embed ? null : (
            <div className="rounded-xl border border-dashed border-border/60 p-12 text-center text-muted-foreground">
              <p>{t("emptyContent")}</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/60 bg-accent/20">
        <div className="container mx-auto px-6 py-12">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4">
            <p className="font-serif text-xl text-foreground">{t("ctaTitle")}</p>
            <Link
              href="/medias"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("ctaButton")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

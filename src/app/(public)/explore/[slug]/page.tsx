import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getPublishedContent } from "@/lib/content-entry";
import type { ContentLocale } from "@/models/ContentEntry";

export const dynamic = "force-dynamic";

async function loadEntry(slug: string) {
  const localeRaw = await getLocale();
  const locale: ContentLocale = localeRaw === "fr" ? "fr" : "en";
  return getPublishedContent("problematique", slug, locale);
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

export default async function ExploreProblematiquePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await loadEntry(slug);
  if (!doc) {
    notFound();
  }
  const t = await getTranslations("ExploreProblematique");

  return (
    <article className="bg-background">
      <div className="border-b border-border/60 bg-background">
        <div className="container mx-auto px-6 py-3">
          <Link
            href="/book"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToTopics")}
          </Link>
        </div>
      </div>

      <header className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto px-6 py-16 md:py-20">
          <div className="mx-auto max-w-4xl space-y-6">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              {t("badge")}
            </p>
            <div className="flex flex-wrap items-center gap-5">
              {doc.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={doc.iconUrl}
                  alt=""
                  className="h-16 w-16 rounded-2xl border border-border/60 object-cover md:h-20 md:w-20"
                />
              ) : null}
              <h1 className="font-serif text-3xl font-light leading-tight text-foreground md:text-4xl lg:text-5xl">
                {doc.title}
              </h1>
            </div>
            {doc.summary ? (
              <p className="text-base text-muted-foreground md:text-lg max-w-3xl">
                {doc.summary}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-12 md:py-16">
        {doc.contentHtml?.trim() ? (
          <div
            className="mx-auto w-full max-w-3xl legal-prose"
            dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
          />
        ) : (
          <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-border/60 p-12 text-center text-muted-foreground">
            <p>{t("emptyContent")}</p>
          </div>
        )}
      </div>

      <div className="border-t border-border/60 bg-accent/20">
        <div className="container mx-auto px-6 py-12">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-light text-muted-foreground">
                {t("ctaSubtitle")}
              </p>
              <p className="font-serif text-xl text-foreground">
                {t("ctaTitle")}
              </p>
            </div>
            <Link
              href="/book"
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

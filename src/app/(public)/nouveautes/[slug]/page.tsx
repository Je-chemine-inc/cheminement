import type { Metadata } from "next";
import { contentSocialMetadata } from "@/lib/content-metadata";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { getContentAnyStatus, getPublishedContent } from "@/lib/content-entry";
import { productByline } from "@/lib/products";
import type { ContentLocale } from "@/models/ContentEntry";

export const dynamic = "force-dynamic";

/**
 * A published « nouveauté », or a professional's article. An article not public yet (being written,
 * under review, taken down) is read only by its author and the team, with a preview notice.
 */
async function loadEntry(slug: string) {
  const localeRaw = await getLocale();
  const locale: ContentLocale = localeRaw === "fr" ? "fr" : "en";
  const published = await getPublishedContent("nouveaute", slug, locale);
  if (published) return { doc: published, preview: false };
  const any = await getContentAnyStatus("nouveaute", slug, locale);
  if (!any?.ownerProfessionalId) return null;
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const reader = role === "admin" || (role === "professional" && session?.user?.id === any.ownerProfessionalId);
  return reader ? { doc: any, preview: true } : null;
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
  const loaded = await loadEntry(slug);
  if (!loaded) return { title: "Not found" };
  const { doc, preview } = loaded;
  return {
    title: doc.title,
    description: doc.summary || undefined,
    ...(preview
      ? { robots: { index: false, follow: false } }
      : // Without this the link preview shows the generic site name, not the
        // article name. See contentSocialMetadata.
        contentSocialMetadata(doc)),
  };
}

export default async function NouveautePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const loaded = await loadEntry(slug);
  if (!loaded) {
    notFound();
  }
  const { doc, preview } = loaded;
  const locale = await getLocale();
  const t = await getTranslations("NouveautePage");
  // A professional's article names its author, and links their page while it is public.
  const byline = doc.ownerProfessionalId ? await productByline(doc.ownerProfessionalId) : null;

  return (
    <article className="bg-background">
      {preview ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900" data-article-preview="">
          {t("previewNotice")}
        </div>
      ) : null}
      <div className="border-b border-border/60 bg-background">
        <div className="container mx-auto px-6 py-3">
          <Link
            href="/nouveautes"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToList")}
          </Link>
        </div>
      </div>

      <header className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto px-6 py-16 md:py-20">
          <div className="mx-auto max-w-4xl space-y-6">
            {doc.publishedAt ? (
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                {formatDate(doc.publishedAt, locale)}
              </p>
            ) : null}
            <h1 className="font-serif text-3xl font-light leading-tight text-foreground md:text-4xl lg:text-5xl">
              {doc.title}
            </h1>
            {byline ? (
              <p className="text-sm text-primary" data-article-byline="">
                {byline.pageUrl ? (
                  <a href={byline.pageUrl} className="hover:underline">
                    {t("byline", { name: byline.name })}
                  </a>
                ) : (
                  t("byline", { name: byline.name })
                )}
              </p>
            ) : null}
            {doc.summary ? (
              <p className="max-w-3xl text-base text-muted-foreground md:text-lg">
                {doc.summary}
              </p>
            ) : null}
            {doc.iconUrl ? (
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
        {doc.ownerProfessionalId ? (
          <p
            className="mx-auto mt-10 flex max-w-3xl items-start gap-2 rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground"
            data-article-disclaimer=""
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t("disclaimer")}
          </p>
        ) : null}
      </div>

      <div className="border-t border-border/60 bg-accent/20">
        <div className="container mx-auto px-6 py-12">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4">
            <p className="font-serif text-xl text-foreground">
              {t("ctaTitle")}
            </p>
            <Link
              href="/nouveautes"
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

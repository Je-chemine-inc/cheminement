import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Newspaper } from "lucide-react";
import { listPublishedContent } from "@/lib/content-entry";
import type { ContentLocale } from "@/models/ContentEntry";

export const dynamic = "force-dynamic";

async function loadEntries() {
  const localeRaw = await getLocale();
  const locale: ContentLocale = localeRaw === "fr" ? "fr" : "en";
  return listPublishedContent("nouveaute", locale);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Nouveautes");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
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

export default async function NouveautesListPage() {
  const items = await loadEntries();
  const locale = await getLocale();
  const t = await getTranslations("Nouveautes");

  return (
    <article className="bg-background">
      <header className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto px-6 py-16 md:py-20">
          <div className="mx-auto max-w-4xl space-y-4 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
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
          <div className="mx-auto max-w-2xl rounded-xl border border-dashed border-border/60 p-12 text-center text-muted-foreground">
            <Newspaper className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p>{t("empty")}</p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
            {items.map((item) => (
              <Link
                key={item.slug}
                href={`/nouveautes/${item.slug}`}
                className="group flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl border border-border/40 bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                {item.iconUrl ? (
                  <div className="relative aspect-video w-full overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.iconUrl}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-muted/40 text-muted-foreground">
                    <Newspaper className="h-10 w-10 opacity-40" />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-3 p-5">
                  {item.publishedAt ? (
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {formatDate(item.publishedAt, locale)}
                    </p>
                  ) : null}
                  <h2 className="font-serif text-xl font-light text-foreground line-clamp-2">
                    {item.title}
                  </h2>
                  {item.summary ? (
                    <p className="flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-4">
                      {item.summary}
                    </p>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span className="inline-flex items-center gap-1 text-sm font-light text-primary transition-colors group-hover:text-primary/80">
                    {t("readMore")}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

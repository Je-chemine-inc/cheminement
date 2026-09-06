import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Lock,
  Unlock,
} from "lucide-react";
import { getPublishedContent } from "@/lib/content-entry";
import { getMediaEmbed } from "@/lib/media-embed";
import { isPremiumEntry, stripPremiumPayload } from "@/lib/content-premium";
import { resolveResourceAccess } from "@/lib/resource-access";
import { formatCad } from "@/lib/format-currency";
import { authOptions } from "@/lib/auth";
import StripAccessToken from "@/components/resources/StripAccessToken";
import ResourceBuyButton from "@/components/resources/ResourceBuyButton";
import ResendAccessLinkDialog from "@/components/resources/ResendAccessLinkDialog";
import type { ContentLocale, MediaType } from "@/models/ContentEntry";

/**
 * Reader for a resource on /book#resources.
 *
 * `force-dynamic` is load-bearing, not stylistic: the response varies on the
 * auth cookie AND on ?token=. Any static or ISR caching would hand one buyer's
 * page to every visitor. For the same reason there is no generateStaticParams
 * and no revalidate.
 */
export const dynamic = "force-dynamic";

async function loadEntry(slug: string) {
  const localeRaw = await getLocale();
  const locale: ContentLocale = localeRaw === "fr" ? "fr" : "en";
  return getPublishedContent("resource", slug, locale);
}

/**
 * Runs for crawlers and share-preview bots, so it must be identical for every
 * viewer: no session, no searchParams, and a description taken only from
 * `summary` — the field the admin wrote as public marketing copy. Deriving it
 * from contentHtml or previewHtml would leak paid text into search results.
 */
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
    // With ?token= in the URL, the default policy would ship the access token
    // to every embedded third party in the Referer header.
    referrer: "strict-origin-when-cross-origin",
    openGraph: {
      title: doc.title,
      description: doc.summary || undefined,
      images: doc.iconUrl ? [doc.iconUrl] : undefined,
    },
  };
}

export default async function BookResourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { slug } = await params;
  const { token } = await searchParams;
  const doc = await loadEntry(slug);
  if (!doc) {
    // Covers drafts and unknown slugs alike — an unpublished resource must not
    // announce its own existence.
    notFound();
  }

  const locale = await getLocale();
  const t = await getTranslations("BookResource");

  const premium = isPremiumEntry(doc);
  const access = await resolveResourceAccess(slug, { isPremium: premium, token });
  // Only used to pre-fill the checkout, never to decide access — that is
  // resolveResourceAccess's job and its answer is already in `access`.
  const session = premium && !access.granted ? await getServerSession(authOptions) : null;

  // THE boundary. Everything below renders from `view`, never from `doc`.
  const view = access.granted ? doc : stripPremiumPayload(doc);
  const contentHtml = "contentHtml" in view ? view.contentHtml : "";
  const mediaUrl = "mediaUrl" in view ? view.mediaUrl : undefined;

  const mediaType: MediaType = doc.mediaType ?? "article";
  const embed = getMediaEmbed(mediaType, mediaUrl);
  const locked = premium && !access.granted;

  return (
    <article className="bg-background">
      {token ? <StripAccessToken /> : null}

      <div className="border-b border-border/60 bg-background">
        <div className="container mx-auto px-6 py-3">
          <Link
            href="/book#resources"
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
              {locked ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-100/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  <Lock className="h-3 w-3" />
                  {t("premiumTag")}
                </span>
              ) : premium ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-medium text-green-700 shadow-sm dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("ownedTag")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm">
                  <Unlock className="h-3.5 w-3.5 text-primary" />
                  {t("freeTag")}
                </span>
              )}
            </div>

            <h1 className="font-serif text-3xl font-light leading-tight text-foreground md:text-4xl lg:text-5xl">
              {view.title}
            </h1>

            {view.summary ? (
              <p className="max-w-3xl text-base text-muted-foreground md:text-lg">
                {view.summary}
              </p>
            ) : null}

            {/* Videos and podcasts show their player below instead. */}
            {mediaType === "article" && view.iconUrl ? (
              <div className="relative mt-4 aspect-video w-full overflow-hidden rounded-2xl border border-border/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={view.iconUrl} alt="" className="h-full w-full object-cover" />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-12 md:py-16">
        <div className="mx-auto w-full max-w-3xl space-y-8">
          {access.via === "token" ? (
            <div className="rounded-xl border border-border/60 bg-accent/30 p-4 text-sm text-muted-foreground">
              {t("guestAccessNotice")}{" "}
              <Link href="/signup/member" className="text-primary hover:underline">
                {t("guestAccessCta")}
              </Link>
            </div>
          ) : null}

          {/*
            No player is rendered while locked — `mediaUrl` was stripped, so
            `embed` is null and there is nothing to leak.
          */}
          {embed?.kind === "iframe" && embed.aspect === "video" ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border/60 bg-black">
              <iframe
                src={embed.src}
                title={view.title}
                referrerPolicy="no-referrer"
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
                title={view.title}
                referrerPolicy="no-referrer"
                className="w-full"
                height={180}
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
              />
            </div>
          ) : null}

          {embed?.kind === "video-file" ? (
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-black">
              <video
                src={embed.src}
                controls
                playsInline
                preload="metadata"
                poster={mediaType === "video" ? view.iconUrl : undefined}
                className="aspect-video w-full"
              />
            </div>
          ) : null}

          {embed?.kind === "audio-file" ? (
            <div className="rounded-2xl border border-border/60 bg-card p-4">
              <audio src={embed.src} controls preload="metadata" className="w-full" />
            </div>
          ) : null}

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

          {locked ? (
            <>
              {view.previewHtml?.trim() ? (
                <div className="relative">
                  <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {t("previewLabel")}
                  </p>
                  <div
                    className="legal-prose max-h-[28rem] w-full overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: view.previewHtml }}
                  />
                  {/*
                    Decorative only. It hides nothing that is not already in the
                    DOM, because only previewHtml was ever sent.
                  */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-background to-transparent" />
                </div>
              ) : null}

              <div className="rounded-2xl border border-primary/20 bg-linear-to-br from-primary/10 to-accent/10 p-8 text-center md:p-10">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Lock className="h-8 w-8 text-primary" />
                </div>
                <h2 className="mt-5 font-serif text-2xl font-light text-foreground">
                  {t("paywallTitle")}
                </h2>
                <p className="mx-auto mt-3 max-w-lg font-light text-muted-foreground">
                  {t("paywallBody")}
                </p>

                <p className="mt-6 font-serif text-4xl font-light text-foreground">
                  {formatCad(doc.priceCents, locale)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("priceAllInclusive")}
                </p>

                <ul className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm text-muted-foreground">
                  {([1, 2, 3] as const).map((n) => (
                    <li key={n} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {t(`perk${n}`)}
                    </li>
                  ))}
                </ul>

                <div className="mt-7">
                  <ResourceBuyButton
                    slug={slug}
                    title={doc.title}
                    priceCents={doc.priceCents}
                    isSignedIn={Boolean(session?.user?.id)}
                    signedInEmail={session?.user?.email ?? undefined}
                  />
                </div>

                <p className="mt-4 text-xs text-muted-foreground">
                  {t("alreadyPurchased")}{" "}
                  <Link href="/login" className="text-primary hover:underline">
                    {t("signInLink")}
                  </Link>
                  {" · "}
                  <ResendAccessLinkDialog slug={slug} />
                </p>
              </div>
            </>
          ) : contentHtml.trim() ? (
            <div
              className="legal-prose w-full"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
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
            <p className="font-serif text-xl text-foreground">
              {premium && access.granted ? t("ownedCtaTitle") : t("ctaTitle")}
            </p>
            <Link
              href={premium && access.granted ? "/book#resources" : "/appointment"}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {premium && access.granted ? t("ownedCtaButton") : t("ctaButton")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

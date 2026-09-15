import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import { showcasePageMetadata } from "@/lib/showcase-metadata";
import { findPublishedShowcase, type ShowcaseLookup } from "@/lib/showcase-queries";
import type { ShowcaseLocale } from "@/lib/showcase-public";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { ShowcaseProfileView } from "@/components/showcase/ShowcaseProfileView";
import { ShowcaseProfileJsonLd } from "@/components/showcase/ShowcaseJsonLd";
import { ShowcaseBeacon } from "@/components/showcase/ShowcaseBeacon";
import { listShowcaseProducts } from "@/lib/products";

/**
 * www.jechemine.ca/<slug> — a professional's published page (spec 003).
 *
 * Next serves the site's own routes (/contact, /book…) before this segment,
 * and the slug rules reserve their names (showcase-slug.spec.ts checks every
 * top-level route), so no page can hide one. A former slug answers with a
 * permanent redirect to the current one; while the pages are off, every
 * address here is a 404.
 *
 * ⚠ No loading.tsx or Suspense boundary above or in this tree: a streamed
 * shell turns every notFound() into an HTTP 200 (debt-map 2026-09-07).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ proSlug: string }> };

const loadShowcase = cache(
  async (slug: string, locale: ShowcaseLocale): Promise<ShowcaseLookup> =>
    (await isShowcaseEnabled()) ? findPublishedShowcase(slug, locale) : { kind: "missing" },
);

async function currentLocale(): Promise<ShowcaseLocale> {
  return (await getLocale()) === "en" ? "en" : "fr";
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { proSlug } = await params;
  const locale = await currentLocale();
  const result = await loadShowcase(proSlug, locale);
  if (result.kind !== "found") return {};
  const { profile } = result;
  const t = await getTranslations("Showcase");
  const titleLabel = profile.title.key ? t(`titles.${profile.title.key}`) : profile.title.label;
  const title = titleLabel
    ? t("profile.metaTitle", {
        name: profile.displayName,
        title: titleLabel.toLocaleLowerCase(locale === "en" ? "en-CA" : "fr-CA"),
        city: profile.city.name,
      })
    : t("profile.metaTitleNoTitle", { name: profile.displayName, city: profile.city.name });
  const description = shorten(
    profile.headline ||
      profile.intro[0] ||
      t("profile.metaDescription", {
        name: profile.displayName,
        city: profile.city.name,
        region: profile.city.region,
      }),
    160,
  );
  return showcasePageMetadata({
    path: `/${profile.slug}`,
    title,
    description,
    image: profile.photoUrl ? canonicalSiteUrl(profile.photoUrl) : null,
    type: "profile",
  });
}

export default async function ShowcaseProfessionalPage({ params }: Params) {
  const { proSlug } = await params;
  const result = await loadShowcase(proSlug, await currentLocale());
  if (result.kind === "moved") permanentRedirect(`/${result.slug}`);
  if (result.kind === "missing") notFound();

  // Trainings and products the professional sells (spec 003 phase 5).
  const products = await listShowcaseProducts(result.profile.slug, await currentLocale()).catch((error) => {
    console.error("[showcase] products could not be listed:", error);
    return [];
  });

  return (
    <>
      <ShowcaseProfileJsonLd profile={result.profile} />
      <ShowcaseBeacon city={result.profile.city.key} slug={result.profile.slug} />
      <ShowcaseProfileView profile={result.profile} products={products} />
    </>
  );
}

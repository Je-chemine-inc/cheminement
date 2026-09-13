import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import { showcasePageMetadata } from "@/lib/showcase-metadata";
import { findPublishedShowcase } from "@/lib/showcase-queries";
import type { ShowcaseLocale } from "@/lib/showcase-public";
import { ShowcaseProfileView } from "@/components/showcase/ShowcaseProfileView";
import { ShowcaseProfileJsonLd } from "@/components/showcase/ShowcaseJsonLd";
import { ShowcaseBeacon } from "@/components/showcase/ShowcaseBeacon";
import { listShowcaseProducts } from "@/lib/products";

/**
 * psy<city>.jechemine.ca/<slug> — a professional's published page (spec 003).
 * A former slug, or a page that moved to another city, answers with a
 * permanent redirect to where it lives now. The city layout already sent the
 * visitor to www while the pages are off.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cityKey: string; proSlug: string }> };

const loadShowcase = cache((slug: string, locale: ShowcaseLocale) => findPublishedShowcase(slug, locale));

async function currentLocale(): Promise<ShowcaseLocale> {
  return (await getLocale()) === "en" ? "en" : "fr";
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cityKey, proSlug } = await params;
  const locale = await currentLocale();
  const result = await loadShowcase(proSlug, locale);
  if (result.kind !== "found" || result.profile.city.key !== cityKey) return {};
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
    cityKey,
    path: `/${profile.slug}`,
    title,
    description,
    image: profile.photoUrl ? absoluteShowcaseUrl(cityKey, profile.photoUrl) : null,
    type: "profile",
  });
}

export default async function ShowcaseProfessionalPage({ params }: Params) {
  const { cityKey, proSlug } = await params;
  const result = await loadShowcase(proSlug, await currentLocale());
  if (result.kind === "moved") {
    permanentRedirect(absoluteShowcaseUrl(result.cityKey, `/${result.slug}`));
  }
  if (result.kind === "missing") notFound();
  if (result.profile.city.key !== cityKey) permanentRedirect(result.profile.url);

  // Trainings and products the professional sells (spec 003 phase 5), sold on www.
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

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { showcaseLayoutMetadata } from "@/lib/showcase-metadata";
import { SITE_URL } from "@/lib/site-url";

/**
 * Every page of a city host (spec 003). The middleware rewrites
 * psy<city>.jechemine.ca/<path> to /showcase/<city>/<path>.
 *
 * Header and footer are not here: the city's own pages get Je chemine's in the
 * (city) group, a professional's page draws its own, and not-found.tsx adds
 * the city's for a 404.
 *
 * ⚠ No loading.tsx or Suspense boundary above or in this tree: a streamed
 * shell turns every notFound() into an HTTP 200 (debt-map 2026-09-07).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cityKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cityKey } = await params;
  return findShowcaseCity(cityKey) ? showcaseLayoutMetadata(cityKey) : {};
}

export default async function ShowcaseCityLayout({
  children,
  params,
}: Params & { children: React.ReactNode }) {
  const { cityKey } = await params;
  const city = findShowcaseCity(cityKey);
  if (!city) notFound();
  // Off: the visitor goes to www (307, so nothing is cached as permanent).
  if (!(await isShowcaseEnabled())) redirect(SITE_URL);

  return <>{children}</>;
}

import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site-url";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";

/**
 * Metadata for a professional's page on www (spec 003).
 *
 * openGraph and twitter are replaced wholesale by each level that sets them,
 * and the root's file-based og:image is only re-added where the segment has
 * its own image file. So images are always set explicitly (debt-map
 * 2026-09-07: pages that set openGraph lost their preview image), and so is
 * the canonical, on www.
 */

/** The site-wide preview image (src/app/opengraph-image.tsx), served on www. */
export const DEFAULT_SHOWCASE_IMAGE = `${SITE_URL}/opengraph-image`;

export interface ShowcasePageMetadataInput {
  /** Path on www: "/amel-sassi". */
  path: string;
  title: string;
  description: string;
  /** Absolute URL of the preview image; the site-wide one by default. */
  image?: string | null;
  /** false: served but kept out of search results (noindex, follow). */
  index?: boolean;
  /** "profile" for a professional's page. */
  type?: "website" | "profile";
}

export function showcasePageMetadata(input: ShowcasePageMetadataInput): Metadata {
  const url = canonicalSiteUrl(input.path);
  const images = [input.image || DEFAULT_SHOWCASE_IMAGE];
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      type: input.type === "profile" ? "profile" : "website",
      siteName: "Je chemine",
      locale: "fr_CA",
      url,
      title: input.title,
      description: input.description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images,
    },
    ...(input.index === false ? { robots: { index: false, follow: true } } : {}),
  };
}

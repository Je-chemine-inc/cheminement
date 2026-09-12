import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site-url";
import { absoluteShowcaseUrl, canonicalSiteUrl } from "@/lib/showcase-hosts";

/**
 * Metadata for pages on a city host (psy<city>.jechemine.ca).
 *
 * Two traps this exists to avoid:
 *  - The root layout's canonical is the relative "./", which Next resolves
 *    against the RENDERED path. Under the middleware rewrite that path is
 *    /showcase/<city>/…, so every showcase page must set an ABSOLUTE canonical
 *    on its own host, never one containing /showcase/.
 *  - openGraph and twitter are replaced wholesale by each level that sets
 *    them, and the root's file-based og:image is only re-added where the
 *    segment has its own image file. So images are always set explicitly
 *    (debt-map 2026-09-07: pages that set openGraph lost their preview image).
 */

/** The site-wide preview image (src/app/opengraph-image.tsx), served on www. */
export const DEFAULT_SHOWCASE_IMAGE = `${SITE_URL}/opengraph-image`;

export interface ShowcasePageMetadataInput {
  cityKey: string;
  /** Public path on the city host: "/", "/sassi", "/specialite/anxiete". */
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

/** The city host's base: every relative URL on the page resolves against it. */
export function showcaseLayoutMetadata(cityKey: string): Metadata {
  return {
    metadataBase: new URL(absoluteShowcaseUrl(cityKey, "/")),
  };
}

export function showcasePageMetadata(input: ShowcasePageMetadataInput): Metadata {
  return pageMetadata(absoluteShowcaseUrl(input.cityKey, input.path), input);
}

/**
 * Metadata for the directory pages on www (/psy, /psy/<region>): the same
 * rules — explicit canonical, images always set — on the canonical host.
 */
export function hubPageMetadata(input: Omit<ShowcasePageMetadataInput, "cityKey" | "type">): Metadata {
  return pageMetadata(canonicalSiteUrl(input.path), input);
}

function pageMetadata(
  url: string,
  input: Pick<ShowcasePageMetadataInput, "title" | "description" | "image" | "index" | "type">,
): Metadata {
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

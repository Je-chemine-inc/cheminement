import type { Metadata } from "next";

/**
 * Open Graph + Twitter metadata for a content detail page.
 *
 * The root layout sets a site-wide `openGraph.title` and `twitter.title`, and
 * Next resolves metadata field by field up the tree — so a page that sets only
 * `title` still ships the generic site name to every link preview. Until
 * 2026-09-07 every article shared on Facebook or LinkedIn read
 * "Je chemine - Soins en santé mentale" instead of its own name.
 *
 * BOTH blocks are required. Setting `openGraph` alone leaves `twitter.title`
 * inheriting from the root, which is exactly how /book/[slug] ended up
 * half-fixed — correct Open Graph, generic Twitter card. Call this from every
 * content detail route rather than hand-rolling the object again.
 */
export function contentSocialMetadata(doc: {
  title: string;
  summary?: string | null;
  iconUrl?: string | null;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const description = doc.summary || undefined;
  const images = doc.iconUrl ? [doc.iconUrl] : undefined;
  return {
    openGraph: { title: doc.title, description, images },
    twitter: { title: doc.title, description, images },
  };
}

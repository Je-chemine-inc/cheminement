import type { Metadata } from "next";
import { SITE_OPEN_GRAPH } from "@/lib/site-metadata";

/** Past this, Google cuts a description in the results with an ellipsis. */
export const DESCRIPTION_MAX = 160;

/**
 * A page's description as search results and link previews show it: trimmed, on one line, and cut
 * at a word when it runs past what Google displays — so the result ends on a word the page chose
 * rather than wherever Google's ellipsis falls. Undefined when there is nothing to say.
 */
export function pageDescription(text: string | null | undefined): string | undefined {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  if (flat.length <= DESCRIPTION_MAX) return flat;
  const cut = flat.slice(0, DESCRIPTION_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > DESCRIPTION_MAX - 40 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

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
 *
 * The Open Graph block starts from SITE_OPEN_GRAPH: an openGraph object replaces the layout's
 * wholesale, so without it every article lost its og:site_name (29 pages until 2026-09-18).
 */
export function contentSocialMetadata(doc: {
  title: string;
  summary?: string | null;
  iconUrl?: string | null;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const description = pageDescription(doc.summary);
  const images = doc.iconUrl ? [doc.iconUrl] : undefined;
  return {
    openGraph: { ...SITE_OPEN_GRAPH, title: doc.title, description, images },
    twitter: { title: doc.title, description, images },
  };
}

export type ContentLocale = "fr" | "en";
export type ContentKind =
  | "problematique"
  | "traitement"
  | "nouveaute"
  | "media";
export type ContentStatus = "draft" | "published";

/** Sub-type for the "media" kind (the Médias / press library). */
export type MediaType = "article" | "video" | "podcast";

export const CONTENT_KINDS: ContentKind[] = [
  "problematique",
  "traitement",
  "nouveaute",
  "media",
];

export const MEDIA_TYPES: MediaType[] = ["article", "video", "podcast"];

/** Where each kind's public detail page lives. */
export const CONTENT_KIND_PUBLIC_BASE: Record<ContentKind, string> = {
  problematique: "/explore",
  traitement: "/approaches",
  nouveaute: "/nouveautes",
  media: "/medias",
};

/** Kinds whose listings are ordered by publish date (newest first) rather than sortOrder. */
export const DATE_SORTED_KINDS: ContentKind[] = ["nouveaute", "media"];

export function isDateSortedKind(kind: ContentKind): boolean {
  return DATE_SORTED_KINDS.includes(kind);
}

export function isContentKind(
  value: string | undefined | null,
): value is ContentKind {
  return (
    value === "problematique" ||
    value === "traitement" ||
    value === "nouveaute" ||
    value === "media"
  );
}

export function isMediaType(
  value: string | undefined | null,
): value is MediaType {
  return value === "article" || value === "video" || value === "podcast";
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export type ContentLocale = "fr" | "en";
export type ContentKind = "problematique" | "traitement" | "nouveaute";
export type ContentStatus = "draft" | "published";

export const CONTENT_KINDS: ContentKind[] = [
  "problematique",
  "traitement",
  "nouveaute",
];

/** Where each kind's public detail page lives. */
export const CONTENT_KIND_PUBLIC_BASE: Record<ContentKind, string> = {
  problematique: "/explore",
  traitement: "/approaches",
  nouveaute: "/nouveautes",
};

export function isContentKind(
  value: string | undefined | null,
): value is ContentKind {
  return (
    value === "problematique" ||
    value === "traitement" ||
    value === "nouveaute"
  );
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

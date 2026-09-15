import type { ShowcaseStatus } from "@/lib/showcase-constants";

/**
 * One word for where a showcase page stands (spec 003), shared by the
 * professional's screen (ShowcasePro.status) and the admin screens
 * (ShowcaseAdmin.badges). Client-safe.
 */
export const SHOWCASE_BADGES = [
  "notInvited",
  "invited",
  "draft",
  "published",
  "approvedClosed",
  "unpublished",
] as const;
export type ShowcaseBadge = (typeof SHOWCASE_BADGES)[number];

/** A published page reads « published, pages closed » while the pages are closed to the public. */
export function showcaseBadge(
  page: { status: ShowcaseStatus } | null,
  showcaseEnabled: boolean,
): ShowcaseBadge {
  if (!page) return "notInvited";
  if (page.status === "published") return showcaseEnabled ? "published" : "approvedClosed";
  if (page.status === "unpublished") return "unpublished";
  return page.status === "invited" ? "invited" : "draft";
}

export const SHOWCASE_BADGE_CLASSES: Readonly<Record<ShowcaseBadge, string>> = {
  notInvited: "bg-muted text-muted-foreground",
  invited: "bg-muted text-foreground",
  draft: "bg-sky-100 text-sky-900",
  published: "bg-emerald-100 text-emerald-900",
  approvedClosed: "bg-emerald-100 text-emerald-900",
  unpublished: "bg-rose-100 text-rose-900",
};

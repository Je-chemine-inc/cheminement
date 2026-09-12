import type { ShowcaseReviewState, ShowcaseStatus } from "@/lib/showcase-constants";

/**
 * One word for where a showcase page stands (spec 003), shared by the
 * professional's screen (ShowcasePro.status) and the admin screens
 * (ShowcaseAdmin.badges). Client-safe.
 */
export const SHOWCASE_BADGES = [
  "notInvited",
  "invited",
  "draft",
  "pending",
  "changes_requested",
  "published",
  "approvedClosed",
  "unpublished",
] as const;
export type ShowcaseBadge = (typeof SHOWCASE_BADGES)[number];

/**
 * A review in progress says more than the status; a published page reads
 * « approved » while the pages are closed to the public.
 */
export function showcaseBadge(
  page: { status: ShowcaseStatus; reviewState: ShowcaseReviewState } | null,
  showcaseEnabled: boolean,
): ShowcaseBadge {
  if (!page) return "notInvited";
  if (page.reviewState === "pending") return "pending";
  if (page.reviewState === "changes_requested") return "changes_requested";
  if (page.status === "published") return showcaseEnabled ? "published" : "approvedClosed";
  if (page.status === "unpublished") return "unpublished";
  return page.status === "invited" ? "invited" : "draft";
}

export const SHOWCASE_BADGE_CLASSES: Readonly<Record<ShowcaseBadge, string>> = {
  notInvited: "bg-muted text-muted-foreground",
  invited: "bg-muted text-foreground",
  draft: "bg-muted text-foreground",
  pending: "bg-sky-100 text-sky-900",
  changes_requested: "bg-amber-100 text-amber-900",
  published: "bg-emerald-100 text-emerald-900",
  approvedClosed: "bg-emerald-100 text-emerald-900",
  unpublished: "bg-rose-100 text-rose-900",
};

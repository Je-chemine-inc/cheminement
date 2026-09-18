import "server-only";
import connectToDatabase from "@/lib/mongodb";
import ContentEntry from "@/models/ContentEntry";
import ShowcasePage from "@/models/ShowcasePage";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import type { MediaType } from "@/lib/content-kind";
import type { ShowcaseProductCard, ShowcaseResourceType } from "@/lib/products";

/**
 * Je chemine's own resources on a professional's page (spec 003, owner 2026-09-18: « sometimes we
 * force our resources into their pages »). An admin chooses them, by slug, in
 * `ShowcasePage.teamResourceSlugs`; they show in the page's « Ressources » after the professional's
 * own products, and always — the professional sees them but cannot remove them.
 *
 * A team resource is a published `resource` row with no owner: never another professional's
 * product. Slugs are stable and unique among resources (the kind, slug and locale index).
 */

/** Rows a page may carry: the team's published resources. `null` matches a missing owner too. */
const TEAM_RESOURCE = { kind: "resource", status: "published", ownerProfessionalId: null } as const;

/** As the editors show one: the admin's choice list, and the page's current list. */
export interface TeamResourceView {
  slug: string;
  title: string;
  priceCents: number;
  /** False once the team unpublished or deleted it: the page no longer shows it. */
  available: boolean;
}

export interface TeamResourceOption {
  slug: string;
  title: string;
  priceCents: number;
  mediaType: MediaType | null;
}

type TeamRow = { slug: string; title: string; summary?: string; iconUrl?: string; priceCents?: number; mediaType?: MediaType };

/** The card label a team resource takes on the page, from what it is. */
export function teamResourceCardType(mediaType: MediaType | null | undefined): ShowcaseResourceType {
  if (mediaType === "video") return "video";
  if (mediaType === "podcast") return "audio";
  return "article";
}

const STORED_FILE = /^\/api\/files\/[a-f0-9]{24}$/;
const IMAGE_HOSTS = new Set(["images.unsplash.com", "api.dicebear.com"]);

/**
 * An image address the page's `next/image` accepts: a stored file, or one of the hosts next.config
 * allows. Anything else would break the page, so the card goes without an image instead. (The admin
 * content form does not check the address it saves.)
 */
export function pageImageUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url) return null;
  if (STORED_FILE.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && IMAGE_HOSTS.has(parsed.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Which of these slugs are team resources a page may carry, as found (French rows). */
export async function findTeamResources(slugs: readonly string[]): Promise<Map<string, { title: string; priceCents: number }>> {
  if (slugs.length === 0) return new Map();
  await connectToDatabase();
  const rows = await ContentEntry.find({ ...TEAM_RESOURCE, slug: { $in: [...slugs] }, locale: "fr" })
    .select("slug title priceCents")
    .lean<TeamRow[]>();
  return new Map(rows.map((row) => [row.slug, { title: row.title, priceCents: row.priceCents ?? 0 }]));
}

/** A page's list as the editors show it, in the admin's order, withdrawn ones flagged. */
export async function resolveTeamResources(slugs: readonly unknown[] | null | undefined): Promise<TeamResourceView[]> {
  const clean = (slugs ?? []).filter((slug): slug is string => typeof slug === "string");
  const found = await findTeamResources(clean);
  return clean.map((slug) => {
    const row = found.get(slug);
    return row ? { slug, title: row.title, priceCents: row.priceCents, available: true } : { slug, title: slug, priceCents: 0, available: false };
  });
}

/** Every team resource an admin can place on a page, by title. */
export async function listTeamResourceOptions(): Promise<TeamResourceOption[]> {
  await connectToDatabase();
  const rows = await ContentEntry.find({ ...TEAM_RESOURCE, locale: "fr" })
    .select("slug title priceCents mediaType")
    .lean<TeamRow[]>();
  return rows
    .map((row) => ({ slug: row.slug, title: row.title, priceCents: row.priceCents ?? 0, mediaType: row.mediaType ?? null }))
    .sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

/**
 * The team resources a published page shows, in the visitor's language and the admin's order. One the
 * team unpublished or deleted meanwhile drops out; so does a slug that is not a team resource.
 */
export async function listShowcaseTeamResources(showcaseSlug: string, locale: "fr" | "en"): Promise<ShowcaseProductCard[]> {
  await connectToDatabase();
  const page = await ShowcasePage.findOne({ slug: showcaseSlug, status: "published" })
    .select("teamResourceSlugs")
    .lean<{ teamResourceSlugs?: unknown[] } | null>();
  const slugs = (page?.teamResourceSlugs ?? []).filter((slug): slug is string => typeof slug === "string");
  if (slugs.length === 0) return [];
  const rows = await ContentEntry.find({ ...TEAM_RESOURCE, slug: { $in: slugs }, locale })
    .select("slug title summary iconUrl priceCents mediaType")
    .lean<TeamRow[]>();
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return slugs.flatMap((slug) => {
    const row = bySlug.get(slug);
    if (!row) return [];
    return [
      {
        slug,
        type: teamResourceCardType(row.mediaType),
        title: row.title,
        summary: row.summary ?? "",
        iconUrl: pageImageUrl(row.iconUrl),
        priceCents: row.priceCents ?? 0,
        webinarStartsAt: null,
        url: canonicalSiteUrl(`/book/${slug}`),
        source: "jechemine" as const,
      },
    ];
  });
}

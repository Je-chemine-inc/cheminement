import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import type { IProCatalogItem } from "@/models/ProCatalogItem";
import { slugify } from "@/lib/content-kind";

/** Same `manageContent` gate the Motif admin routes use. */
export async function requireContentAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  await connectToDatabase();
  const permissions = await getActiveAdminPermissions(session.user.id);
  if (!permissions?.manageContent) {
    return {
      error: NextResponse.json(
        { error: "Forbidden - missing permission: manageContent" },
        { status: 403 },
      ),
    };
  }
  return { session };
}

export function normalizeAliases(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function serializeCatalogItem(
  d: Pick<
    IProCatalogItem,
    "category" | "labelFr" | "labelEn" | "aliases" | "active" | "createdAt" | "updatedAt"
  > & { _id: unknown; showcase?: boolean; slug?: string; descriptionFr?: string; descriptionEn?: string },
) {
  return {
    id: String(d._id),
    category: d.category,
    labelFr: d.labelFr,
    labelEn: d.labelEn || "",
    aliases: d.aliases || [],
    active: d.active !== false,
    showcase: d.showcase === true,
    slug: d.slug || "",
    descriptionFr: d.descriptionFr || "",
    descriptionEn: d.descriptionEn || "",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** How long a theme's description may be. Long enough for a short paragraph, short enough to read. */
export const PRO_CATALOG_DESCRIPTION_MAX = 600;

/**
 * What a theme covers, as the catalogue stores it: one paragraph, so runs of whitespace and line
 * breaks collapse to single spaces, cut at a word rather than mid-word when it is too long. Anything
 * that is not a string is nothing to say.
 */
export function catalogDescription(input: unknown): string {
  if (typeof input !== "string") return "";
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length <= PRO_CATALOG_DESCRIPTION_MAX) return text;
  const cut = text.slice(0, PRO_CATALOG_DESCRIPTION_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > PRO_CATALOG_DESCRIPTION_MAX - 60 ? cut.slice(0, space) : cut).trimEnd();
}

const CATALOG_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The URL segment of an expertise's showcase pages (spec 003): the one asked
 * for, or one made from the French label. Null when neither is usable.
 */
export function catalogSlug(requested: unknown, labelFr: string): string | null {
  const raw =
    typeof requested === "string" && requested.trim()
      ? requested.trim().toLowerCase()
      : slugify(labelFr).replace(/^-+|-+$/g, "");
  return raw.length >= 2 && raw.length <= 60 && CATALOG_SLUG_RE.test(raw) ? raw : null;
}

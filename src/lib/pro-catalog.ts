import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import type { IProCatalogItem } from "@/models/ProCatalogItem";

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
  > & { _id: unknown },
) {
  return {
    id: String(d._id),
    category: d.category,
    labelFr: d.labelFr,
    labelEn: d.labelEn || "",
    aliases: d.aliases || [],
    active: d.active !== false,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

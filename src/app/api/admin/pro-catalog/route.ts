import { NextRequest, NextResponse } from "next/server";
import ProCatalogItem, {
  PRO_CATALOG_CATEGORIES,
  type ProCatalogCategory,
} from "@/models/ProCatalogItem";
import {
  requireContentAdmin,
  normalizeAliases,
  serializeCatalogItem,
} from "@/lib/pro-catalog";

// GET /api/admin/pro-catalog — full list (active + inactive), all categories.
export async function GET() {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const docs = await ProCatalogItem.find({})
      .sort({ category: 1, labelFr: 1 })
      .select("category labelFr labelEn aliases active createdAt updatedAt")
      .lean();
    return NextResponse.json({ items: docs.map(serializeCatalogItem) });
  } catch (error) {
    console.error("Admin list pro-catalog error:", error);
    return NextResponse.json({ error: "Failed to load catalog" }, { status: 500 });
  }
}

// POST /api/admin/pro-catalog — create (category + FR + EN required).
export async function POST(req: NextRequest) {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const category = body?.category as ProCatalogCategory;
    const labelFr = typeof body?.labelFr === "string" ? body.labelFr.trim() : "";
    const labelEn = typeof body?.labelEn === "string" ? body.labelEn.trim() : "";
    const aliases = normalizeAliases(body?.aliases);
    const active = body?.active !== false;

    if (!PRO_CATALOG_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (!labelFr) {
      return NextResponse.json({ error: "labelFr is required" }, { status: 400 });
    }
    if (!labelEn) {
      return NextResponse.json(
        { error: "labelEn is required for new items" },
        { status: 400 },
      );
    }

    const duplicate = await ProCatalogItem.findOne({ category, labelFr })
      .select("_id")
      .lean();
    if (duplicate) {
      return NextResponse.json(
        { error: "Un élément avec ce libellé français existe déjà dans cette catégorie" },
        { status: 409 },
      );
    }

    const created = await ProCatalogItem.create({
      category,
      labelFr,
      labelEn,
      aliases,
      active,
      createdBy: auth.session!.user.id,
      updatedBy: auth.session!.user.id,
    });

    return NextResponse.json({ item: serializeCatalogItem(created) }, { status: 201 });
  } catch (error) {
    console.error("Admin create pro-catalog error:", error);
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 });
  }
}

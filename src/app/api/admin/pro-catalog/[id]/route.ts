import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import ProCatalogItem from "@/models/ProCatalogItem";
import {
  requireContentAdmin,
  normalizeAliases,
  serializeCatalogItem,
} from "@/lib/pro-catalog";

// PATCH /api/admin/pro-catalog/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json();
    const update: Record<string, unknown> = { updatedBy: auth.session!.user.id };

    if (typeof body?.labelFr === "string") {
      const v = body.labelFr.trim();
      if (!v) {
        return NextResponse.json({ error: "labelFr cannot be empty" }, { status: 400 });
      }
      update.labelFr = v;
    }
    if (typeof body?.labelEn === "string") {
      const v = body.labelEn.trim();
      if (!v) {
        return NextResponse.json({ error: "labelEn cannot be empty" }, { status: 400 });
      }
      update.labelEn = v;
    }
    if (body?.aliases !== undefined) {
      update.aliases = normalizeAliases(body.aliases);
    }
    if (typeof body?.active === "boolean") {
      update.active = body.active;
    }

    // Uniqueness is per-category, so check against the existing item's category.
    if (update.labelFr) {
      const current = await ProCatalogItem.findById(id).select("category").lean();
      if (current) {
        const duplicate = await ProCatalogItem.findOne({
          _id: { $ne: new mongoose.Types.ObjectId(id) },
          category: current.category,
          labelFr: update.labelFr,
        })
          .select("_id")
          .lean();
        if (duplicate) {
          return NextResponse.json(
            { error: "Un autre élément de cette catégorie utilise déjà ce libellé" },
            { status: 409 },
          );
        }
      }
    }

    const updated = await ProCatalogItem.findByIdAndUpdate(id, update, {
      new: true,
    }).lean();
    if (!updated) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json({ item: serializeCatalogItem(updated) });
  } catch (error) {
    console.error("Admin update pro-catalog error:", error);
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }
}

// DELETE /api/admin/pro-catalog/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const deleted = await ProCatalogItem.findByIdAndDelete(id).lean();
    if (!deleted) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete pro-catalog error:", error);
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 });
  }
}

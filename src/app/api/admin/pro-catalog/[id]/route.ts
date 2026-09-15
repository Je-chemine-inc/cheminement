import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import ProCatalogItem from "@/models/ProCatalogItem";
import {
  requireContentAdmin,
  normalizeAliases,
  serializeCatalogItem,
  catalogSlug,
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

    // Spec 003: only an expertise can be offered on showcase pages. Its URL
    // segment is made from the label the first time it is offered, and kept
    // when it stops being offered (its pages may come back).
    if (typeof body?.showcase === "boolean" || typeof body?.slug === "string") {
      const current = await ProCatalogItem.findById(id).select("category labelFr slug").lean();
      if (!current) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      if (current.category !== "expertise") {
        return NextResponse.json(
          { error: "Seules les expertises peuvent figurer sur les pages vitrines" },
          { status: 400 },
        );
      }
      if (typeof body.showcase === "boolean") update.showcase = body.showcase;
      const requested =
        typeof body.slug === "string" && body.slug.trim() ? body.slug : undefined;
      if (requested !== undefined || (body.showcase === true && !current.slug)) {
        const candidate = catalogSlug(
          requested,
          typeof update.labelFr === "string" ? update.labelFr : current.labelFr,
        );
        if (!candidate) {
          return NextResponse.json({ error: "Segment d'adresse invalide" }, { status: 400 });
        }
        const slugTaken = await ProCatalogItem.findOne({
          _id: { $ne: new mongoose.Types.ObjectId(id) },
          category: "expertise",
          slug: candidate,
        })
          .select("_id")
          .lean();
        if (slugTaken) {
          return NextResponse.json(
            { error: "Ce segment d'adresse est déjà utilisé par une autre expertise" },
            { status: 409 },
          );
        }
        update.slug = candidate;
      }
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

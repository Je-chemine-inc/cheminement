import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import { Resource } from "@/models/Resource";

const VALID_TYPES = ["ebook", "video", "course", "worksheet", "guide", "tool"] as const;

async function requireContentAdmin() {
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

function normalizeTags(input: unknown): string[] {
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid resource id" }, { status: 400 });
    }

    const body = await req.json();
    const update: Record<string, unknown> = {};

    if (typeof body?.title === "string") {
      const v = body.title.trim();
      if (!v) {
        return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      }
      update.title = v;
    }
    if (typeof body?.description === "string") {
      const v = body.description.trim();
      if (!v) {
        return NextResponse.json({ error: "description cannot be empty" }, { status: 400 });
      }
      update.description = v;
    }
    if (typeof body?.type === "string" && VALID_TYPES.includes(body.type as never)) {
      update.type = body.type;
    }
    if (typeof body?.category === "string") {
      const v = body.category.trim();
      if (!v) {
        return NextResponse.json({ error: "category cannot be empty" }, { status: 400 });
      }
      update.category = v;
    }
    if (Number.isFinite(body?.price)) {
      const p = Number(body.price);
      if (p < 0) {
        return NextResponse.json({ error: "price must be non-negative" }, { status: 400 });
      }
      update.price = p;
    }
    if (typeof body?.currency === "string" && body.currency.trim()) {
      update.currency = body.currency.trim();
    }
    if (typeof body?.fileUrl === "string") {
      update.fileUrl = body.fileUrl.trim();
    }
    if (typeof body?.contentUrl === "string") {
      update.contentUrl = body.contentUrl.trim();
    }
    if (typeof body?.previewUrl === "string") {
      update.previewUrl = body.previewUrl.trim();
    }
    if (body?.tags !== undefined) {
      update.tags = normalizeTags(body.tags);
    }
    if (typeof body?.isActive === "boolean") {
      update.isActive = body.isActive;
    }

    const updated = await Resource.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!updated) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }

    return NextResponse.json({
      resource: {
        id: String(updated._id),
        title: updated.title,
        description: updated.description,
        type: updated.type,
        category: updated.category,
        price: updated.price,
        currency: updated.currency,
        fileUrl: updated.fileUrl ?? "",
        contentUrl: updated.contentUrl ?? "",
        previewUrl: updated.previewUrl ?? "",
        tags: updated.tags ?? [],
        isActive: updated.isActive,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Admin update resource error:", error);
    return NextResponse.json(
      { error: "Failed to update resource" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid resource id" }, { status: 400 });
    }
    const deleted = await Resource.findByIdAndDelete(id).lean();
    if (!deleted) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete resource error:", error);
    return NextResponse.json(
      { error: "Failed to delete resource" },
      { status: 500 },
    );
  }
}

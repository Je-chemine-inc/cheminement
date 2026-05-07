import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import Faq, { type FaqAudience } from "@/models/Faq";

const AUDIENCES: FaqAudience[] = ["all", "client", "professional"];

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid FAQ id" }, { status: 400 });
    }

    const body = await req.json();
    const update: Record<string, unknown> = {
      updatedBy: auth.session!.user.id,
    };

    if (typeof body?.questionFr === "string") {
      const v = body.questionFr.trim();
      if (!v)
        return NextResponse.json(
          { error: "questionFr cannot be empty" },
          { status: 400 },
        );
      update.questionFr = v;
    }
    if (typeof body?.questionEn === "string") {
      const v = body.questionEn.trim();
      if (!v)
        return NextResponse.json(
          { error: "questionEn cannot be empty" },
          { status: 400 },
        );
      update.questionEn = v;
    }
    if (typeof body?.answerFr === "string") {
      const v = body.answerFr.trim();
      if (!v)
        return NextResponse.json(
          { error: "answerFr cannot be empty" },
          { status: 400 },
        );
      update.answerFr = v;
    }
    if (typeof body?.answerEn === "string") {
      const v = body.answerEn.trim();
      if (!v)
        return NextResponse.json(
          { error: "answerEn cannot be empty" },
          { status: 400 },
        );
      update.answerEn = v;
    }
    if (typeof body?.audience === "string" && AUDIENCES.includes(body.audience)) {
      update.audience = body.audience;
    }
    if (Number.isFinite(body?.order)) {
      update.order = Number(body.order);
    }
    if (typeof body?.enabled === "boolean") {
      update.enabled = body.enabled;
    }

    const updated = await Faq.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!updated) {
      return NextResponse.json({ error: "FAQ not found" }, { status: 404 });
    }

    return NextResponse.json({
      faq: {
        id: String(updated._id),
        questionFr: updated.questionFr,
        questionEn: updated.questionEn,
        answerFr: updated.answerFr,
        answerEn: updated.answerEn,
        audience: updated.audience,
        order: updated.order,
        enabled: updated.enabled,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Admin update FAQ error:", error);
    return NextResponse.json(
      { error: "Failed to update FAQ" },
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
      return NextResponse.json({ error: "Invalid FAQ id" }, { status: 400 });
    }
    const deleted = await Faq.findByIdAndDelete(id).lean();
    if (!deleted) {
      return NextResponse.json({ error: "FAQ not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete FAQ error:", error);
    return NextResponse.json(
      { error: "Failed to delete FAQ" },
      { status: 500 },
    );
  }
}

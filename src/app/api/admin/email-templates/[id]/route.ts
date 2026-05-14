import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import EmailTemplate from "@/models/EmailTemplate";
import { getDefinition } from "@/lib/email-template-registry";

async function requireContentAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return { error: "Unauthorized", status: 401 as const };
  }
  await connectToDatabase();
  const admin = await Admin.findOne({
    userId: session.user.id,
    isActive: true,
  });
  if (!admin?.permissions?.manageContent) {
    return { error: "Insufficient permissions", status: 403 as const };
  }
  return { userId: session.user.id };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const tpl = await EmailTemplate.findById(id);
    if (!tpl) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const def = getDefinition(tpl.templateKey);
    return NextResponse.json({
      id: tpl._id.toString(),
      templateKey: tpl.templateKey,
      locale: tpl.locale,
      subject: tpl.subject,
      title: tpl.title,
      subtitle: tpl.subtitle,
      bodyHtml: tpl.bodyHtml,
      ctaText: tpl.ctaText,
      updatedAt: tpl.updatedAt,
      definition: def
        ? {
            key: def.key,
            labelFr: def.labelFr,
            labelEn: def.labelEn,
            descriptionFr: def.descriptionFr,
            descriptionEn: def.descriptionEn,
            placeholders: def.placeholders,
          }
        : undefined,
    });
  } catch (error) {
    console.error("Get email template error:", error);
    return NextResponse.json(
      { error: "Failed to load template" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await req.json();
    const { subject, title, subtitle, bodyHtml, ctaText } = body as {
      subject?: string;
      title?: string;
      subtitle?: string;
      bodyHtml?: string;
      ctaText?: string;
    };

    const tpl = await EmailTemplate.findById(id);
    if (!tpl) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (typeof subject === "string" && subject.trim()) {
      tpl.subject = subject.trim();
    }
    if (typeof title === "string" && title.trim()) {
      tpl.title = title.trim();
    }
    if (typeof subtitle === "string") {
      tpl.subtitle = subtitle.trim() || undefined;
    }
    if (typeof bodyHtml === "string") {
      tpl.bodyHtml = bodyHtml;
    }
    if (typeof ctaText === "string") {
      tpl.ctaText = ctaText.trim() || undefined;
    }

    tpl.updatedBy = new mongoose.Types.ObjectId(auth.userId);
    await tpl.save();

    return NextResponse.json({
      id: tpl._id.toString(),
      templateKey: tpl.templateKey,
      locale: tpl.locale,
      subject: tpl.subject,
      title: tpl.title,
      subtitle: tpl.subtitle,
      bodyHtml: tpl.bodyHtml,
      ctaText: tpl.ctaText,
      updatedAt: tpl.updatedAt,
    });
  } catch (error) {
    console.error("Update email template error:", error);
    return NextResponse.json(
      { error: "Failed to save template" },
      { status: 500 },
    );
  }
}

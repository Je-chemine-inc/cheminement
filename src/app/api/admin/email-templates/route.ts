import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import {
  EMAIL_TEMPLATE_DEFINITIONS,
  listEmailTemplates,
} from "@/lib/email-template-registry";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.user.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();
    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });
    if (!admin?.permissions?.manageContent) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const templates = await listEmailTemplates();
    return NextResponse.json({
      templates,
      definitions: EMAIL_TEMPLATE_DEFINITIONS.map((d) => ({
        key: d.key,
        labelFr: d.labelFr,
        labelEn: d.labelEn,
        descriptionFr: d.descriptionFr,
        descriptionEn: d.descriptionEn,
      })),
    });
  } catch (error) {
    console.error("List email templates error:", error);
    return NextResponse.json(
      { error: "Failed to load templates" },
      { status: 500 },
    );
  }
}

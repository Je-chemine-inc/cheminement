import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import ExternalMessage from "@/models/ExternalMessage";

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
  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const source = url.searchParams.get("source");
    const status = url.searchParams.get("status");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {};
    if (source && ["contact", "school-manager", "enterprise"].includes(source)) {
      filter.source = source;
    }
    if (status && ["new", "read", "archived"].includes(status)) {
      filter.status = status;
    }

    const messages = await ExternalMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return NextResponse.json(
      messages.map((m) => ({
        id: m._id.toString(),
        source: m.source,
        locale: m.locale,
        senderName: m.senderName,
        senderEmail: m.senderEmail,
        senderPhone: m.senderPhone,
        subject: m.subject,
        message: m.message,
        metadata: m.metadata,
        status: m.status,
        createdAt: m.createdAt,
      })),
    );
  } catch (error) {
    console.error("List external messages error:", error);
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 },
    );
  }
}

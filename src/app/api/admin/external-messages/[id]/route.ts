import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
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
  return { userId: session.user.id };
}

function serialize(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  m: any,
) {
  return {
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
    adminNotes: m.adminNotes,
    readAt: m.readAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
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
    const msg = await ExternalMessage.findById(id);
    if (!msg) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Auto-mark as read on first open
    if (msg.status === "new") {
      msg.status = "read";
      msg.readBy = new mongoose.Types.ObjectId(auth.userId);
      msg.readAt = new Date();
      await msg.save();
    }

    return NextResponse.json(serialize(msg));
  } catch (error) {
    console.error("Get external message error:", error);
    return NextResponse.json(
      { error: "Failed to load message" },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
    const { status, adminNotes } = body as {
      status?: string;
      adminNotes?: string;
    };

    const msg = await ExternalMessage.findById(id);
    if (!msg) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (
      typeof status === "string" &&
      ["new", "read", "archived"].includes(status)
    ) {
      msg.status = status as "new" | "read" | "archived";
    }
    if (typeof adminNotes === "string") {
      msg.adminNotes = adminNotes;
    }
    await msg.save();
    return NextResponse.json(serialize(msg));
  } catch (error) {
    console.error("Update external message error:", error);
    return NextResponse.json(
      { error: "Failed to update message" },
      { status: 500 },
    );
  }
}

export async function DELETE(
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
    const deleted = await ExternalMessage.findByIdAndDelete(id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete external message error:", error);
    return NextResponse.json(
      { error: "Failed to delete message" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import {
  SUPPORT_RECIPIENT_ID,
  getActiveAdminIds,
  getAllowedRecipientIds,
} from "@/lib/messaging-permissions";

// GET /api/messages — list my conversations (inbox)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const userId = new mongoose.Types.ObjectId(session.user.id);

  const conversations = await Conversation.find({ participants: userId })
    .sort({ lastMessageAt: -1 })
    .limit(50)
    .populate("participants", "firstName lastName role")
    .lean();

  const viewerRole = session.user.role as string;

  const result = conversations.map((conv) => {
    const others = (
      conv.participants as unknown as Array<{
        _id: mongoose.Types.ObjectId;
        firstName: string;
        lastName: string;
        role: string;
      }>
    ).filter((p) => p._id.toString() !== session.user.id);

    // Collapse multi-admin "Support" threads into a single Support label for
    // clients so the inbox never exposes individual admin identities.
    const allAdmins =
      others.length > 0 && others.every((p) => p.role === "admin");
    const displayParticipants =
      viewerRole === "client" && allAdmins
        ? [{ id: SUPPORT_RECIPIENT_ID, name: "Support", role: "support" }]
        : others.map((p) => ({
            id: p._id,
            name: `${p.firstName} ${p.lastName}`,
            role: p.role,
          }));

    // `.lean()` may return the Map field as a Map or a plain object depending
    // on the driver/version — read it robustly either way.
    const rawCounts = conv.unreadCounts as unknown;
    const unread =
      rawCounts instanceof Map
        ? (rawCounts.get(session.user.id) ?? 0)
        : ((rawCounts as Record<string, number> | undefined)?.[
            session.user.id
          ] ?? 0);

    return {
      id: conv._id,
      subject: conv.subject,
      lastMessageAt: conv.lastMessageAt,
      lastMessagePreview: conv.lastMessagePreview,
      unread,
      participants: displayParticipants,
    };
  });

  return NextResponse.json({ conversations: result });
}

// POST /api/messages — start new conversation
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { recipientId, subject, message } = body as {
    recipientId: string;
    subject: string;
    message: string;
  };

  if (!recipientId || !subject?.trim() || !message?.trim()) {
    return NextResponse.json({ error: "recipientId, subject and message are required" }, { status: 400 });
  }

  await connectToDatabase();

  const senderId = new mongoose.Types.ObjectId(session.user.id);

  // "Support" sentinel — clients write to the entire active admin group.
  if (recipientId === SUPPORT_RECIPIENT_ID) {
    if (session.user.role !== "client") {
      return NextResponse.json(
        { error: "Support recipient is reserved for clients" },
        { status: 403 },
      );
    }
    const adminIds = await getActiveAdminIds();
    if (adminIds.length === 0) {
      return NextResponse.json(
        { error: "No support recipient available" },
        { status: 503 },
      );
    }
    const participantIds = [session.user.id, ...adminIds];
    const unreadCounts: Record<string, number> = {};
    adminIds.forEach((id) => {
      unreadCounts[id] = 1;
    });

    const conversation = await Conversation.create({
      participants: participantIds.map(
        (id) => new mongoose.Types.ObjectId(id),
      ),
      subject: subject.trim(),
      lastMessageAt: new Date(),
      lastMessagePreview: message.trim().slice(0, 300),
      unreadCounts,
    });

    await Message.create({
      conversationId: conversation._id,
      senderId,
      body: message.trim(),
      readBy: [senderId],
    });

    return NextResponse.json(
      { conversationId: conversation._id },
      { status: 201 },
    );
  }

  if (!mongoose.Types.ObjectId.isValid(recipientId)) {
    return NextResponse.json({ error: "Invalid recipient" }, { status: 400 });
  }

  const recipient = await User.findById(recipientId).select("_id").lean();
  if (!recipient) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  const allowedIds = await getAllowedRecipientIds(
    session.user.id,
    session.user.role as string,
  );
  if (!allowedIds.has(recipientId)) {
    return NextResponse.json(
      { error: "You are not allowed to message this recipient" },
      { status: 403 },
    );
  }

  const recipientObjId = new mongoose.Types.ObjectId(recipientId);

  const conversation = await Conversation.create({
    participants: [senderId, recipientObjId],
    subject: subject.trim(),
    lastMessageAt: new Date(),
    lastMessagePreview: message.trim().slice(0, 300),
    unreadCounts: { [recipientId]: 1 },
  });

  await Message.create({
    conversationId: conversation._id,
    senderId,
    body: message.trim(),
    readBy: [senderId],
  });

  return NextResponse.json({ conversationId: conversation._id }, { status: 201 });
}

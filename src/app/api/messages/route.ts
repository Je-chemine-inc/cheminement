import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";

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

  const result = conversations.map((conv) => ({
    id: conv._id,
    subject: conv.subject,
    lastMessageAt: conv.lastMessageAt,
    lastMessagePreview: conv.lastMessagePreview,
    unread: (conv.unreadCounts as Record<string, number>)?.[session.user.id] ?? 0,
    participants: (conv.participants as unknown as Array<{ _id: mongoose.Types.ObjectId; firstName: string; lastName: string; role: string }>).filter(
      (p) => p._id.toString() !== session.user.id,
    ).map((p) => ({
      id: p._id,
      name: `${p.firstName} ${p.lastName}`,
      role: p.role,
    })),
  }));

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

  const recipient = await User.findById(recipientId).select("_id").lean();
  if (!recipient) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  const senderId = new mongoose.Types.ObjectId(session.user.id);
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

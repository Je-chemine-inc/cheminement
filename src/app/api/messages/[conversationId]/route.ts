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
  getHiddenProfessionalIds,
} from "@/lib/messaging-permissions";

// GET /api/messages/[conversationId] — fetch thread messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;
  await connectToDatabase();

  const userId = new mongoose.Types.ObjectId(session.user.id);
  const conv = await Conversation.findOne({
    _id: conversationId,
    participants: userId,
  })
    .populate("participants", "firstName lastName role")
    .lean();

  if (!conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await Message.find({ conversationId })
    .sort({ createdAt: 1 })
    .populate("senderId", "firstName lastName role")
    .lean();

  // Mark conversation as read for this user
  await Conversation.updateOne(
    { _id: conversationId },
    { $set: { [`unreadCounts.${session.user.id}`]: 0 } },
  );

  // Mark all unread messages as read
  await Message.updateMany(
    { conversationId, readBy: { $ne: userId } },
    { $addToSet: { readBy: userId } },
  );

  const viewerRole = session.user.role as string;
  const rawParticipants = conv.participants as unknown as Array<{
    _id: mongoose.Types.ObjectId;
    firstName: string;
    lastName: string;
    role: string;
  }>;
  const others = rawParticipants.filter(
    (p) => p._id.toString() !== session.user.id,
  );
  const allAdmins =
    others.length > 0 && others.every((p) => p.role === "admin");
  const displayParticipants =
    viewerRole === "client" && allAdmins
      ? [{ id: SUPPORT_RECIPIENT_ID, name: "Support", role: "support" }]
      : rawParticipants.map((p) => ({
          id: p._id,
          name: `${p.firstName} ${p.lastName}`,
          role: p.role,
        }));

  return NextResponse.json({
    conversation: {
      id: conv._id,
      subject: conv.subject,
      participants: displayParticipants,
    },
    messages: messages.map((m) => {
      const sender = m.senderId as unknown as {
        _id: mongoose.Types.ObjectId;
        firstName: string;
        lastName: string;
        role: string;
      };
      const senderName =
        viewerRole === "client" && sender.role === "admin"
          ? "Support"
          : `${sender.firstName} ${sender.lastName}`;
      return {
        id: m._id,
        body: m.body,
        createdAt: m.createdAt,
        isOwn: sender._id.toString() === session.user.id,
        senderName,
      };
    }),
  });
}

// POST /api/messages/[conversationId] — reply in thread
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;
  const { message } = (await req.json()) as { message: string };

  if (!message?.trim()) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  await connectToDatabase();
  const userId = new mongoose.Types.ObjectId(session.user.id);

  const conv = await Conversation.findOne({
    _id: conversationId,
    participants: userId,
  });

  if (!conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Peer-to-peer visibility gate on replies. If this is a pro↔pro thread and
  // either side has turned themselves invisible to professionals, the thread is
  // frozen for further peer replies (matching the "receive messages or not"
  // rule). Pro↔client and pro↔admin threads are unaffected.
  if (session.user.role === "professional") {
    const otherParticipantIds = conv.participants
      .map((p) => p.toString())
      .filter((id) => id !== session.user.id);

    const otherUsers = await User.find({ _id: { $in: otherParticipantIds } })
      .select("_id role")
      .lean<{ _id: mongoose.Types.ObjectId; role: string }[]>();

    const involvesAnotherPro = otherUsers.some(
      (u) => u.role === "professional",
    );

    if (involvesAnotherPro) {
      const hiddenProIds = await getHiddenProfessionalIds();
      const senderHidden = hiddenProIds.has(session.user.id);
      const anyOtherProHidden = otherUsers.some(
        (u) => u.role === "professional" && hiddenProIds.has(u._id.toString()),
      );
      if (senderHidden || anyOtherProHidden) {
        return NextResponse.json(
          {
            error: "This professional is not available for internal messaging.",
          },
          { status: 403 },
        );
      }
    }
  }

  const newMessage = await Message.create({
    conversationId,
    senderId: userId,
    body: message.trim(),
    readBy: [userId],
  });

  // Increment unread counts for other participants
  const unreadUpdates: Record<string, number> = {};
  for (const participantId of conv.participants) {
    if (participantId.toString() !== session.user.id) {
      unreadUpdates[`unreadCounts.${participantId}`] =
        ((conv.unreadCounts as Map<string, number>)?.get(participantId.toString()) ?? 0) + 1;
    }
  }

  await Conversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        lastMessageAt: new Date(),
        lastMessagePreview: message.trim().slice(0, 300),
        ...unreadUpdates,
      },
    },
  );

  return NextResponse.json({ messageId: newMessage._id }, { status: 201 });
}

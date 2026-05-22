import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import User from "@/models/User";
import ExternalMessage from "@/models/ExternalMessage";
import { sendAdminComposedEmail } from "@/lib/notifications";

// SMTP send can be slow on cold start.
export const maxDuration = 30;

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

export async function GET(req: NextRequest) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const source = url.searchParams.get("source");
    const status = url.searchParams.get("status");
    const direction = url.searchParams.get("direction");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {};
    if (
      source &&
      ["contact", "school-manager", "enterprise", "compose", "email"].includes(
        source,
      )
    ) {
      filter.source = source;
    }
    if (status && ["new", "read", "archived"].includes(status)) {
      filter.status = status;
    }
    if (direction && ["inbound", "outbound"].includes(direction)) {
      filter.direction = direction;
    } else {
      // Default: only show inbound in the main list. Outbound is opt-in via
      // ?direction=outbound so legacy callers keep their behavior.
      filter.direction = "inbound";
    }

    const messages = await ExternalMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return NextResponse.json(
      messages.map((m) => ({
        id: m._id.toString(),
        source: m.source,
        direction: m.direction ?? "inbound",
        locale: m.locale,
        senderName: m.senderName,
        senderEmail: m.senderEmail,
        senderPhone: m.senderPhone,
        recipientEmail: m.recipientEmail,
        recipientName: m.recipientName,
        subject: m.subject,
        message: m.message,
        metadata: m.metadata,
        status: m.status,
        sentAt: m.sentAt,
        createdAt: m.createdAt,
        emailMessageId: m.emailMessageId,
        emailInReplyTo: m.emailInReplyTo,
        parentMessageId: m.parentMessageId?.toString(),
        userId: m.userId?.toString(),
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const {
      to,
      recipientName,
      subject,
      message,
      locale,
      inReplyToId,
    } = body as {
      to?: string;
      recipientName?: string;
      subject?: string;
      message?: string;
      locale?: string;
      /** Optional ExternalMessage id this reply threads under. */
      inReplyToId?: string;
    };

    const trimmedTo = typeof to === "string" ? to.trim().toLowerCase() : "";
    const trimmedSubject = typeof subject === "string" ? subject.trim() : "";
    const trimmedMessage = typeof message === "string" ? message.trim() : "";

    if (!trimmedTo || !EMAIL_RE.test(trimmedTo)) {
      return NextResponse.json({ error: "Invalid recipient email" }, { status: 400 });
    }
    if (!trimmedSubject) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }
    if (!trimmedMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const admin = await User.findById(auth.userId)
      .select("firstName lastName email")
      .lean();
    const adminName = admin
      ? `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() || "Admin"
      : "Admin";
    const adminEmail = admin?.email;

    const langValue: "fr" | "en" = locale === "en" ? "en" : "fr";

    // If this is a reply to an existing thread, look up the parent so we can
    // chain Message-Id / References headers. Without this the recipient's
    // mail client won't render the reply in the same conversation.
    let parent: {
      _id: mongoose.Types.ObjectId;
      emailMessageId?: string;
      emailReferences?: string;
      userId?: mongoose.Types.ObjectId;
    } | null = null;
    if (
      typeof inReplyToId === "string" &&
      mongoose.Types.ObjectId.isValid(inReplyToId)
    ) {
      const parentDoc = await ExternalMessage.findById(inReplyToId)
        .select("emailMessageId emailReferences userId")
        .lean();
      if (parentDoc) {
        parent = {
          _id: parentDoc._id,
          emailMessageId: parentDoc.emailMessageId,
          emailReferences: parentDoc.emailReferences,
          userId: parentDoc.userId,
        };
      }
    }

    const referencesChain = parent?.emailMessageId
      ? [parent.emailReferences, parent.emailMessageId]
          .filter(Boolean)
          .join(" ")
      : undefined;

    const sendResult = await sendAdminComposedEmail({
      to: trimmedTo,
      subject: trimmedSubject,
      body: trimmedMessage,
      // Reply-To now defaults to the shared support inbox inside
      // sendAdminComposedEmail so replies are captured by the platform
      // webhook, not the admin's personal inbox.
      recipientName: recipientName?.trim() || undefined,
      locale: langValue,
      inReplyTo: parent?.emailMessageId,
      references: referencesChain,
    });

    if (!sendResult.sent) {
      return NextResponse.json(
        {
          error: "Failed to send email — check SMTP configuration",
        },
        { status: 502 },
      );
    }

    const record = await ExternalMessage.create({
      source: parent ? "email" : "compose",
      direction: "outbound",
      locale: langValue,
      // For outbound, "sender" is the admin/platform; "recipient" is the external destination.
      senderName: adminName,
      senderEmail: adminEmail ?? process.env.MAIL_FROM ?? "support@jechemine.ca",
      recipientEmail: trimmedTo,
      recipientName: recipientName?.trim() || undefined,
      subject: trimmedSubject,
      message: trimmedMessage,
      // Outbound is implicitly "read" by the admin who just sent it.
      status: "read",
      sentBy: auth.userId,
      sentAt: new Date(),
      readAt: new Date(),
      emailMessageId: sendResult.messageId ?? undefined,
      emailInReplyTo: parent?.emailMessageId,
      emailReferences: referencesChain,
      parentMessageId: parent?._id,
      userId: parent?.userId,
    });

    return NextResponse.json(
      {
        id: record._id.toString(),
        sent: true,
        messageId: sendResult.messageId,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Compose external message error:", error);
    return NextResponse.json(
      {
        error: "Failed to send email",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

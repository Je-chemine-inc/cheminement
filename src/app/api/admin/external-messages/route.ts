import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
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
    if (source && ["contact", "school-manager", "enterprise", "compose"].includes(source)) {
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
    } = body as {
      to?: string;
      recipientName?: string;
      subject?: string;
      message?: string;
      locale?: string;
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

    const sent = await sendAdminComposedEmail({
      to: trimmedTo,
      subject: trimmedSubject,
      body: trimmedMessage,
      replyTo: adminEmail,
      recipientName: recipientName?.trim() || undefined,
      locale: langValue,
    });

    if (!sent) {
      // SMTP failed or is disabled. Don't persist a record that suggests we
      // emailed the recipient when we didn't.
      return NextResponse.json(
        {
          error: "Failed to send email — check SMTP configuration",
        },
        { status: 502 },
      );
    }

    const record = await ExternalMessage.create({
      source: "compose",
      direction: "outbound",
      locale: langValue,
      // For outbound, "sender" is the admin/platform; "recipient" is the external destination.
      senderName: adminName,
      senderEmail: adminEmail ?? process.env.SMTP_USER ?? "noreply@jechemine.ca",
      recipientEmail: trimmedTo,
      recipientName: recipientName?.trim() || undefined,
      subject: trimmedSubject,
      message: trimmedMessage,
      // Outbound is implicitly "read" by the admin who just sent it.
      status: "read",
      sentBy: auth.userId,
      sentAt: new Date(),
      readAt: new Date(),
    });

    return NextResponse.json(
      {
        id: record._id.toString(),
        sent: true,
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

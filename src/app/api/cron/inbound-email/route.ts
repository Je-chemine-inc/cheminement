import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import ExternalMessage from "@/models/ExternalMessage";
import User from "@/models/User";
import {
  normalizeInboundEmail,
  parseReferenceIds,
  isAutomatedEmail,
  type RawInboundEmail,
} from "@/lib/inbound-email";

/**
 * Inbound-email ingestion. The on-box IMAP fetcher
 * (scripts/inbound-email-sync.mjs) pulls new messages from the support@ mailbox,
 * parses them, and POSTs them here as JSON. We create one `inbound` / `email`
 * ExternalMessage per message so client emails/replies surface in the admin
 * "Courriels externes → Réception" panel alongside website-form submissions.
 *
 *   Authorization: Bearer <CRON_SECRET>
 *   Body: { emails: RawInboundEmail[] }
 *
 * Idempotent: messages already stored (matched by Message-Id) are skipped, so
 * the fetcher can safely re-send a rolling window on every run.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let emails: RawInboundEmail[] = [];
  try {
    const body = (await req.json().catch(() => ({}))) as {
      emails?: RawInboundEmail[];
    };
    emails = Array.isArray(body.emails) ? body.emails : [];
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (emails.length === 0) {
    return NextResponse.json({ ok: true, created: 0, skipped: 0, total: 0 });
  }

  try {
    await connectToDatabase();

    let created = 0;
    let skipped = 0;
    let filtered = 0;

    for (const raw of emails) {
      // Drop machine-generated mail (bounces / auto-replies) — keep the panel
      // to real people. The app already logs sends, so delivery info isn't lost.
      if (isAutomatedEmail(raw)) {
        filtered++;
        continue;
      }

      const n = normalizeInboundEmail(raw);
      if (!n) {
        skipped++;
        continue;
      }

      // Idempotency: never store the same email twice.
      const exists = await ExternalMessage.exists({ emailMessageId: n.messageId });
      if (exists) {
        skipped++;
        continue;
      }

      // Thread resolution: find the newest stored message whose Message-Id is
      // referenced by this reply (In-Reply-To first, then the References chain).
      const refIds = parseReferenceIds(raw.inReplyTo, raw.references);
      let parent = null as null | {
        _id: unknown;
        userId?: unknown;
        emailReferences?: string;
        emailMessageId?: string;
      };
      if (refIds.length > 0) {
        parent = await ExternalMessage.findOne({
          emailMessageId: { $in: refIds },
        })
          .sort({ createdAt: -1 })
          .select("_id userId emailReferences emailMessageId")
          .lean();
      }

      // Link the sender to a platform user (by email) for faster admin triage —
      // fall back to whatever user the parent thread was linked to.
      const matchedUser = await User.findOne({ email: n.senderEmail })
        .select("_id")
        .lean();
      const userId =
        (matchedUser?._id as unknown) ?? (parent?.userId as unknown) ?? undefined;

      await ExternalMessage.create({
        source: "email",
        direction: "inbound",
        locale: "fr",
        senderName: n.senderName,
        senderEmail: n.senderEmail,
        subject: n.subject,
        message: n.message,
        htmlBody: n.htmlBody,
        metadata: Object.keys(n.metadata).length ? n.metadata : undefined,
        status: "new",
        emailMessageId: n.messageId,
        emailInReplyTo: n.inReplyTo,
        emailReferences: n.references,
        parentMessageId: parent?._id ?? undefined,
        userId,
      });
      created++;
    }

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      filtered,
      total: emails.length,
    });
  } catch (e: unknown) {
    console.error("[inbound-email] ingestion failed:", e);
    return NextResponse.json(
      { error: "Failed", details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

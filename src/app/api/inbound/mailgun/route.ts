/**
 * Mailgun inbound email webhook.
 *
 * Mailgun's "Routes" feature forwards incoming mail to support@jechemine.ca
 * by POST-ing a multipart/form-data payload to this endpoint. Each delivery
 * is signed; we verify the signature, parse the message, and persist it as
 * an ExternalMessage so admins see replies in /admin/dashboard/external-messages.
 *
 * --- DNS / Mailgun setup required (one-time) ---
 *  1. Create Mailgun account, add domain `jechemine.ca`.
 *  2. Add the DKIM TXT, SPF TXT, and tracking CNAME records Mailgun lists.
 *  3. Set MX records on jechemine.ca:
 *        10 mxa.mailgun.org
 *        10 mxb.mailgun.org
 *  4. In Mailgun > Receiving > Create Route:
 *        - Filter expression: match_recipient("support@jechemine.ca")
 *        - Action: forward("https://<your-prod-host>/api/inbound/mailgun")
 *        - Action: store()  (optional, keeps a copy for reprocessing)
 *  5. Copy the "HTTP webhook signing key" from Mailgun and set
 *     MAILGUN_WEBHOOK_SIGNING_KEY in the deployment env.
 *
 * Without those records, Mailgun will not RECEIVE mail for the domain and
 * this endpoint will never fire. The platform-side plumbing is otherwise
 * complete — flipping the DNS switch is the only remaining step.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ExternalMessage from "@/models/ExternalMessage";
import User from "@/models/User";

// Mailgun POSTs multipart form data; let the Next runtime handle large bodies.
export const maxDuration = 60;

const NAME_FROM_EMAIL_RE = /^"?([^"<]+?)"?\s*<[^>]+>$/;

function verifyMailgunSignature(params: {
  timestamp: string | null;
  token: string | null;
  signature: string | null;
}): boolean {
  const { timestamp, token, signature } = params;
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;

  if (!signingKey) {
    // In dev we tolerate missing key + reject the webhook, since accepting
    // unsigned POSTs would be a spam funnel. Operators must set the env var
    // before pointing Mailgun at the prod URL.
    console.warn("[mailgun-inbound] MAILGUN_WEBHOOK_SIGNING_KEY not set");
    return false;
  }
  if (!timestamp || !token || !signature) return false;

  // Reject replays older than 15 minutes (Mailgun recommendation).
  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - tsSeconds);
  if (ageSec > 15 * 60) return false;

  const computed = crypto
    .createHmac("sha256", signingKey)
    .update(timestamp + token)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

function parseSenderName(fromHeader: string, fallbackEmail: string): string {
  const match = NAME_FROM_EMAIL_RE.exec(fromHeader.trim());
  if (match?.[1]) return match[1].trim();
  // No display name in From — derive from email local-part.
  return fallbackEmail.split("@")[0] || fallbackEmail;
}

function detectLocale(text: string, htmlBody: string): "fr" | "en" {
  // Cheap heuristic: count common French accents / words vs English. Defaults
  // to "fr" since the platform is primarily French-speaking.
  const sample = `${text} ${htmlBody}`.slice(0, 2000).toLowerCase();
  const frHits = (sample.match(/[éèêàçâîôû]|bonjour|merci|cordialement/g) ?? [])
    .length;
  const enHits = (sample.match(/\bthe\b|\band\b|hello|regards|thanks/g) ?? [])
    .length;
  return frHits > enHits ? "fr" : "en";
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    console.error("[mailgun-inbound] Could not parse form data:", error);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const get = (key: string): string | null => {
    const v = form.get(key);
    return typeof v === "string" ? v : null;
  };

  // Mailgun's signature trio. Some Mailgun configs nest these under
  // signature[*] when posting JSON, but for form-encoded the keys are flat.
  if (
    !verifyMailgunSignature({
      timestamp: get("timestamp"),
      token: get("token"),
      signature: get("signature"),
    })
  ) {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 },
    );
  }

  const sender = (get("sender") || "").trim().toLowerCase();
  const recipient = (get("recipient") || "").trim().toLowerCase();
  const fromHeader = (get("from") || sender || "").trim();
  const subject = (get("subject") || "(no subject)").trim();
  const bodyPlain = (get("body-plain") || "").trim();
  const strippedText = (get("stripped-text") || "").trim();
  const bodyHtml = get("body-html") || undefined;
  const messageId = get("Message-Id") || get("message-id");
  const inReplyTo = get("In-Reply-To") || get("in-reply-to");
  const references = get("References") || get("references");

  if (!sender) {
    return NextResponse.json(
      { error: "Missing sender" },
      { status: 400 },
    );
  }

  // Use the stripped reply body if available so we don't store the entire
  // quoted history every time. Fall back to body-plain.
  const messageBody = strippedText || bodyPlain || "(empty body)";

  try {
    await connectToDatabase();

    // Try to associate the inbound email with a known platform user.
    const matchedUser = await User.findOne({ email: sender })
      .select("_id firstName lastName")
      .lean();

    // Try to find the parent in our outbound history via In-Reply-To.
    let parentId: mongoose.Types.ObjectId | undefined;
    if (inReplyTo) {
      const parent = await ExternalMessage.findOne({
        emailMessageId: inReplyTo,
      })
        .select("_id")
        .lean();
      if (parent) {
        parentId = parent._id;
      }
    }

    const senderName = matchedUser
      ? `${matchedUser.firstName ?? ""} ${matchedUser.lastName ?? ""}`.trim() ||
        parseSenderName(fromHeader, sender)
      : parseSenderName(fromHeader, sender);

    const record = await ExternalMessage.create({
      source: "email",
      direction: "inbound",
      locale: detectLocale(messageBody, bodyHtml ?? ""),
      senderName,
      senderEmail: sender,
      recipientEmail: recipient || undefined,
      subject,
      message: messageBody,
      htmlBody: bodyHtml,
      status: "new",
      metadata: {
        // Persist a handful of useful headers without bloating the doc.
        mailgunFrom: fromHeader,
        spamScore: get("X-Mailgun-Sflag")
          ? `flag=${get("X-Mailgun-Sflag")}`
          : undefined,
        attachmentCount: get("attachment-count") ?? undefined,
      },
      emailMessageId: messageId ?? undefined,
      emailInReplyTo: inReplyTo ?? undefined,
      emailReferences: references ?? undefined,
      parentMessageId: parentId,
      userId: matchedUser?._id,
    });

    console.log(
      `[mailgun-inbound] Stored inbound email from ${sender} (id=${record._id})` +
        (parentId ? ` parent=${parentId}` : "") +
        (matchedUser ? ` user=${matchedUser._id}` : ""),
    );

    return NextResponse.json({ ok: true, id: record._id.toString() });
  } catch (error) {
    console.error("[mailgun-inbound] Failed to persist email:", error);
    // Returning 500 makes Mailgun retry — preferable to silently dropping.
    return NextResponse.json(
      { error: "Failed to persist email" },
      { status: 500 },
    );
  }
}

// Mailgun does NOT GET this URL; reply 405 to make smoke tests obvious.
export function GET() {
  return NextResponse.json(
    { error: "Method not allowed; use POST from Mailgun routes" },
    { status: 405 },
  );
}

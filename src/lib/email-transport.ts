/**
 * Unified outbound email transport.
 *
 * Two backends:
 *   1. Mailgun HTTP API — used when MAILGUN_API_KEY + MAILGUN_DOMAIN are set.
 *      This is the production path. Mailgun handles SPF/DKIM signing for the
 *      jechemine.ca domain and routes inbound replies back to our webhook.
 *   2. Nodemailer SMTP fallback — used in dev when no Mailgun creds are
 *      configured. Keeps `npm run dev` working with a Gmail app-password.
 *
 * Public surface: `sendMail()` always resolves with a `messageId` (or null if
 * the send was silently skipped because email is globally disabled / not
 * configured at all). That id is what callers persist so inbound replies can
 * be threaded via In-Reply-To.
 */

import nodemailer from "nodemailer";

export type EmailAddress = string;

export interface OutboundAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface OutboundEmail {
  from?: string;
  to: EmailAddress | EmailAddress[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** RFC Message-Id this email is replying to (with angle brackets). */
  inReplyTo?: string;
  /** Full References chain (space-separated <id> tokens) for proper threading. */
  references?: string;
  /** Free-form tags surfaced to Mailgun dashboards / SMTP X-Headers. */
  tags?: string[];
  attachments?: OutboundAttachment[];
}

export interface SendResult {
  /** Always normalized with angle brackets: `<id@domain>` */
  messageId: string | null;
  backend: "mailgun" | "smtp" | "skipped";
}

const MAILGUN_API_BASE: Record<"us" | "eu", string> = {
  us: "https://api.mailgun.net/v3",
  eu: "https://api.eu.mailgun.net/v3",
};

function isMailgunConfigured(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
}

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

/**
 * The canonical "from" address. Reads in this priority order:
 *   1. Explicit `from` on the email
 *   2. MAIL_FROM env (display-name format ok: `"JeChemine" <support@jechemine.ca>`)
 *   3. Default to support@jechemine.ca with the platform name from MAIL_FROM_NAME
 *   4. Last resort: the SMTP user (legacy behavior — only used in dev)
 */
export function resolveFromAddress(
  explicit?: string,
  companyName?: string,
): string {
  if (explicit) return explicit;
  if (process.env.MAIL_FROM) {
    // If MAIL_FROM is "name <email>" already, return as-is. Otherwise wrap.
    if (process.env.MAIL_FROM.includes("<")) return process.env.MAIL_FROM;
    const name = process.env.MAIL_FROM_NAME || companyName || "JeChemine";
    return `"${name}" <${process.env.MAIL_FROM}>`;
  }
  const fallbackEmail =
    process.env.SUPPORT_EMAIL || "support@jechemine.ca";
  const name = process.env.MAIL_FROM_NAME || companyName || "JeChemine";
  if (isMailgunConfigured()) {
    return `"${name}" <${fallbackEmail}>`;
  }
  // SMTP dev fallback — Gmail rejects From spoofing so we use SMTP_USER.
  return `"${name}" <${process.env.SMTP_USER || fallbackEmail}>`;
}

/**
 * Send via Mailgun's HTTP API. Returns the raw Message-Id (with angle
 * brackets). Throws on non-2xx so callers can fall back to SMTP if desired.
 */
async function sendViaMailgun(email: OutboundEmail): Promise<string> {
  const domain = process.env.MAILGUN_DOMAIN!;
  const apiKey = process.env.MAILGUN_API_KEY!;
  const region = process.env.MAILGUN_REGION?.toLowerCase() === "eu" ? "eu" : "us";

  const form = new FormData();
  form.append("from", email.from ?? resolveFromAddress());
  const toList = Array.isArray(email.to) ? email.to : [email.to];
  for (const addr of toList) form.append("to", addr);
  form.append("subject", email.subject);
  form.append("html", email.html);
  form.append("text", email.text);

  if (email.replyTo) form.append("h:Reply-To", email.replyTo);
  if (email.inReplyTo) form.append("h:In-Reply-To", email.inReplyTo);
  if (email.references) form.append("h:References", email.references);
  if (email.tags?.length) {
    for (const tag of email.tags.slice(0, 3)) form.append("o:tag", tag);
  }

  if (email.attachments?.length) {
    for (const att of email.attachments) {
      const blob = new Blob([new Uint8Array(att.content)], {
        type: att.contentType || "application/octet-stream",
      });
      form.append("attachment", blob, att.filename);
    }
  }

  const auth = Buffer.from(`api:${apiKey}`).toString("base64");
  const res = await fetch(`${MAILGUN_API_BASE[region]}/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mailgun send failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { id?: string; message?: string };
  if (!data.id) {
    throw new Error(`Mailgun response missing id: ${data.message ?? "unknown"}`);
  }
  // Mailgun returns the Message-Id with surrounding angle brackets already.
  return data.id.startsWith("<") ? data.id : `<${data.id}>`;
}

let cachedSmtpTransporter: nodemailer.Transporter | null = null;
function getSmtpTransporter(): nodemailer.Transporter {
  if (cachedSmtpTransporter) return cachedSmtpTransporter;
  cachedSmtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return cachedSmtpTransporter;
}

export function clearSmtpTransporterCache(): void {
  cachedSmtpTransporter = null;
}

async function sendViaSmtp(email: OutboundEmail): Promise<string> {
  const transporter = getSmtpTransporter();
  const info = await transporter.sendMail({
    from: email.from ?? resolveFromAddress(),
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: email.replyTo,
    inReplyTo: email.inReplyTo,
    references: email.references,
    attachments: email.attachments,
  });
  if (!info.messageId) {
    throw new Error("SMTP send returned no messageId");
  }
  return info.messageId.startsWith("<") ? info.messageId : `<${info.messageId}>`;
}

export async function sendMail(email: OutboundEmail): Promise<SendResult> {
  // Mailgun first — production path.
  if (isMailgunConfigured()) {
    const messageId = await sendViaMailgun(email);
    return { messageId, backend: "mailgun" };
  }

  // SMTP fallback for dev environments.
  if (isSmtpConfigured()) {
    const messageId = await sendViaSmtp(email);
    return { messageId, backend: "smtp" };
  }

  // No transport configured — log and skip. Callers treat this as success
  // for parity with previous behavior where missing SMTP creds short-circuited.
  console.log("[email-transport] No transport configured; skipping send:", {
    to: email.to,
    subject: email.subject,
  });
  return { messageId: null, backend: "skipped" };
}

export function emailTransportStatus(): {
  configured: boolean;
  backend: "mailgun" | "smtp" | "none";
} {
  if (isMailgunConfigured()) return { configured: true, backend: "mailgun" };
  if (isSmtpConfigured()) return { configured: true, backend: "smtp" };
  return { configured: false, backend: "none" };
}

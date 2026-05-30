/**
 * Outbound email transport via Nodemailer SMTP.
 *
 * Public surface: `sendMail()` always resolves with a `messageId` (or null if
 * the send was silently skipped because no transport is configured).
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
  /** Free-form tags (currently only logged; no-op for SMTP). */
  tags?: string[];
  attachments?: OutboundAttachment[];
}

export interface SendResult {
  /** Always normalized with angle brackets: `<id@domain>` */
  messageId: string | null;
  backend: "smtp" | "skipped";
}

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

/**
 * The canonical "from" address.
 *
 * IMPORTANT (Gmail SMTP): Gmail rejects sends where the From address doesn't
 * match the authenticated SMTP_USER unless that account has a verified
 * "Send mail as" alias for the target address. Either keep MAIL_FROM ===
 * SMTP_USER, or configure the alias in the Gmail account first.
 */
export function resolveFromAddress(
  explicit?: string,
  companyName?: string,
): string {
  if (explicit) return explicit;
  if (process.env.MAIL_FROM) {
    if (process.env.MAIL_FROM.includes("<")) return process.env.MAIL_FROM;
    const name = process.env.MAIL_FROM_NAME || companyName || "Je chemine";
    return `"${name}" <${process.env.MAIL_FROM}>`;
  }
  const fallbackEmail =
    process.env.SUPPORT_EMAIL || process.env.SMTP_USER || "support@jechemine.ca";
  const name = process.env.MAIL_FROM_NAME || companyName || "Je chemine";
  return `"${name}" <${fallbackEmail}>`;
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
  if (isSmtpConfigured()) {
    const messageId = await sendViaSmtp(email);
    return { messageId, backend: "smtp" };
  }

  console.log("[email-transport] No transport configured; skipping send:", {
    to: email.to,
    subject: email.subject,
  });
  return { messageId: null, backend: "skipped" };
}

export function emailTransportStatus(): {
  configured: boolean;
  backend: "smtp" | "none";
} {
  if (isSmtpConfigured()) return { configured: true, backend: "smtp" };
  return { configured: false, backend: "none" };
}

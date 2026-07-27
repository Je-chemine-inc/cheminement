/**
 * Inbound-email ingestion helpers (pure). Turns a parsed IMAP message (fetched
 * by scripts/inbound-email-sync.mjs from the support@ mailbox) into the shape we
 * store as an `inbound` / `email` ExternalMessage, and resolves the RFC threading
 * ids so a client reply lands under the admin message it answers.
 *
 * Kept dependency-free so it can be unit-tested and imported by the cron route
 * WITHOUT pulling any IMAP/MIME library into the Next.js server bundle.
 */

const MAX_NAME = 200;
const MAX_SUBJECT = 500;
const MAX_MESSAGE = 50_000;
const MAX_HTML = 200_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Raw email as produced by the on-box IMAP fetch script (mailparser output). */
export interface RawInboundEmail {
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
  from?: { name?: string; email?: string };
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  /** ISO date string of the original message. */
  date?: string;
  /** Which platform mailbox this arrived in (e.g. support@ vs paiement@). */
  mailbox?: string;
  // ----- Signals used to detect automated mail (bounces / auto-replies) -----
  /** RFC 3834 Auto-Submitted header value ("auto-replied", "auto-generated", …). */
  autoSubmitted?: string;
  /** Full Content-Type header incl. params (to spot delivery-status reports). */
  contentType?: string;
  /** Return-Path header — "<>" is the classic bounce envelope. */
  returnPath?: string;
  /** Precedence header ("auto_reply", "bulk", …). */
  precedence?: string;
}

const AUTOMATED_SENDER_RE = /(^|<)(mailer-daemon|mail-daemon|postmaster)@/i;

/**
 * True when a message is machine-generated — a delivery bounce (DSN) or an
 * auto-reply (out-of-office) — rather than a real person writing to support.
 * We skip these so the Réception panel shows people, not notifications. Uses
 * only high-confidence signals so genuine client mail is never dropped.
 */
export function isAutomatedEmail(raw: RawInboundEmail): boolean {
  const from = (raw.from?.email ?? "").trim().toLowerCase();
  if (AUTOMATED_SENDER_RE.test(from)) return true;

  // RFC 3834: any value other than "no" marks auto-generated / auto-replied mail.
  const autoSubmitted = (raw.autoSubmitted ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;

  // Empty return-path envelope = bounce.
  if ((raw.returnPath ?? "").trim() === "<>") return true;

  // Standard Delivery Status Notification format.
  const ct = (raw.contentType ?? "").toLowerCase();
  if (ct.includes("multipart/report") && ct.includes("delivery-status")) {
    return true;
  }

  if ((raw.precedence ?? "").trim().toLowerCase() === "auto_reply") return true;

  return false;
}

export interface NormalizedInboundEmail {
  messageId: string;
  inReplyTo?: string;
  /** Space-separated <id> chain, normalized. */
  references?: string;
  senderName: string;
  senderEmail: string;
  subject?: string;
  message: string;
  htmlBody?: string;
  metadata: Record<string, string>;
}

/** Wrap a bare message-id in angle brackets and trim; returns "" if empty. */
function normalizeId(id: string | undefined | null): string {
  const t = (id ?? "").trim();
  if (!t) return "";
  const bare = t.replace(/^<|>$/g, "").trim();
  if (!bare) return "";
  return `<${bare}>`;
}

/**
 * Collect the ordered, de-duplicated list of `<message-id>` tokens referenced by
 * an inbound reply (from its In-Reply-To + References headers). The cron route
 * matches these against stored `emailMessageId`s to find the parent thread.
 */
export function parseReferenceIds(
  inReplyTo?: string,
  references?: string | string[],
): string[] {
  const tokens: string[] = [];
  const push = (raw: string) => {
    const id = normalizeId(raw);
    if (id && !tokens.includes(id)) tokens.push(id);
  };

  const refList = Array.isArray(references)
    ? references
    : typeof references === "string"
      ? references.split(/\s+/)
      : [];
  for (const r of refList) push(r);
  // In-Reply-To is the most direct parent — check it last so, when we later
  // scan newest-first, it's still present; order here is references then IRT.
  if (inReplyTo) push(inReplyTo);
  return tokens;
}

/** Collapse HTML to a plain-text fallback when a message has no text/plain part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Validate + normalize a raw inbound email into the fields we persist. Returns
 * null when the message can't be threaded/stored safely (no Message-Id or no
 * usable sender address) so the caller can skip it without failing the batch.
 */
export function normalizeInboundEmail(
  raw: RawInboundEmail,
): NormalizedInboundEmail | null {
  const messageId = normalizeId(raw.messageId);
  if (!messageId) return null;

  const senderEmail = (raw.from?.email ?? "").trim().toLowerCase();
  if (!senderEmail || !EMAIL_RE.test(senderEmail)) return null;

  const senderName =
    (raw.from?.name ?? "").trim().slice(0, MAX_NAME) ||
    senderEmail.split("@")[0];

  const text = (raw.text ?? "").trim();
  const html = (raw.html ?? "").trim();
  const message = (text || (html ? htmlToText(html) : "")).slice(0, MAX_MESSAGE);

  const inReplyTo = normalizeId(raw.inReplyTo) || undefined;
  const refs = parseReferenceIds(raw.inReplyTo, raw.references);
  const references = refs.length ? refs.join(" ") : undefined;

  const metadata: Record<string, string> = {};
  if (raw.to?.trim()) metadata.to = raw.to.trim().slice(0, 500);
  if (raw.date?.trim()) metadata.date = raw.date.trim().slice(0, 60);
  if (raw.mailbox?.trim()) metadata.mailbox = raw.mailbox.trim().slice(0, 200);

  return {
    messageId,
    inReplyTo,
    references,
    senderName,
    senderEmail,
    subject: raw.subject?.trim().slice(0, MAX_SUBJECT) || undefined,
    // A body is required by the schema — fall back to the subject or a marker
    // so a legitimate empty-body email still surfaces in the panel.
    message: message || raw.subject?.trim()?.slice(0, MAX_MESSAGE) || "(sans contenu)",
    htmlBody: html ? html.slice(0, MAX_HTML) : undefined,
    metadata,
  };
}

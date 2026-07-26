#!/usr/bin/env node
/**
 * Inbound-email sync (runs on the WHC VPS via cron; NOT part of the Next bundle).
 *
 * Connects to the support@ mailbox over IMAP (mailpro5), pulls messages from a
 * rolling recent window, parses them, and POSTs them to the app's ingestion
 * route (/api/cron/inbound-email). The route de-dupes by Message-Id, so we can
 * safely re-send the same window every run — nothing is marked read/moved, so
 * webmail is left untouched.
 *
 * Deps (imapflow, mailparser) are installed in an ISOLATED node_modules next to
 * this script on the server, exactly like the sharp bundle trick — this keeps
 * MIME/IMAP libraries out of the Next.js server chunks.
 *
 * Env (loaded via `node --env-file=/root/jechemine.env`):
 *   IMAP_HOST   (default mailpro5.whc.ca)   IMAP_PORT (default 993)
 *   IMAP_USER   (default SMTP_USER)          IMAP_PASS (default SMTP_PASS)
 *   CRON_SECRET (required)                   INBOUND_SYNC_URL (default http://127.0.0.1:3000)
 *   INBOUND_SYNC_DAYS (default 3)
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const HOST = process.env.IMAP_HOST || "mailpro5.whc.ca";
const PORT = parseInt(process.env.IMAP_PORT || "993", 10);
const USER = process.env.IMAP_USER || process.env.SMTP_USER;
const PASS = process.env.IMAP_PASS || process.env.SMTP_PASS;
const SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.INBOUND_SYNC_URL || "http://127.0.0.1:3000";
const DAYS = parseInt(process.env.INBOUND_SYNC_DAYS || "3", 10);

function fail(msg) {
  console.error(`[inbound-email-sync] ${msg}`);
  process.exit(1);
}
if (!USER || !PASS) fail("IMAP_USER / IMAP_PASS (or SMTP_USER / SMTP_PASS) not set");
if (!SECRET) fail("CRON_SECRET not set");

const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

const client = new ImapFlow({
  host: HOST,
  port: PORT,
  secure: true,
  auth: { user: USER, pass: PASS },
  logger: false,
});

const emails = [];

try {
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    // Fetch the source of every message received in the recent window.
    for await (const msg of client.fetch({ since }, { source: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        const fromAddr = parsed.from?.value?.[0];
        emails.push({
          messageId: parsed.messageId || "",
          inReplyTo: parsed.inReplyTo || undefined,
          references: parsed.references || undefined,
          from: { name: fromAddr?.name || "", email: fromAddr?.address || "" },
          to: parsed.to?.text || undefined,
          subject: parsed.subject || undefined,
          text: parsed.text || undefined,
          html: typeof parsed.html === "string" ? parsed.html : undefined,
          date: parsed.date ? parsed.date.toISOString() : undefined,
        });
      } catch (e) {
        console.error("[inbound-email-sync] parse error:", e?.message || e);
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();
} catch (e) {
  fail(`IMAP error: ${e?.message || e}`);
}

if (emails.length === 0) {
  console.log("[inbound-email-sync] no messages in window; nothing to send.");
  process.exit(0);
}

try {
  const res = await fetch(`${APP_URL}/api/cron/inbound-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify({ emails }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) fail(`ingestion route returned HTTP ${res.status}: ${JSON.stringify(json)}`);
  console.log(
    `[inbound-email-sync] fetched=${emails.length} created=${json.created ?? "?"} skipped=${json.skipped ?? "?"}`,
  );
} catch (e) {
  fail(`POST to ingestion route failed: ${e?.message || e}`);
}

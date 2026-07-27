#!/usr/bin/env node
/**
 * Inbound-email sync (runs on the WHC VPS via cron; NOT part of the Next bundle).
 *
 * Connects to one or more @jechemine.ca mailboxes over IMAP (mailpro5), pulls
 * messages from a rolling recent window, parses them, and POSTs them to the
 * app's ingestion route (/api/cron/inbound-email). Each message is tagged with
 * the mailbox it arrived in (support@ vs paiement@) so the admin Réception panel
 * can tell them apart. The route de-dupes by Message-Id, so re-sending the same
 * window every run is safe — nothing is marked read/moved, webmail is untouched.
 *
 * Deps (imapflow, mailparser) live in an ISOLATED node_modules next to this
 * script on the server (the sharp-bundle trick) — keeps MIME/IMAP libs out of
 * the Next.js server chunks.
 *
 * Env (loaded via `node --env-file=/root/jechemine.env`):
 *   IMAP_HOST (default mailpro5.whc.ca)   IMAP_PORT (default 993)
 *   CRON_SECRET (required)                INBOUND_SYNC_URL (default http://127.0.0.1:3000)
 *   INBOUND_SYNC_DAYS (default 3)
 *   Mailboxes — either:
 *     INBOUND_MAILBOXES = JSON array, e.g. [{"user":"support@jechemine.ca","pass":"…"},{"user":"paiement@jechemine.ca","pass":"…"}]
 *   or (single-mailbox fallback):
 *     IMAP_USER / IMAP_PASS  (default SMTP_USER / SMTP_PASS)
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const HOST = process.env.IMAP_HOST || "mailpro5.whc.ca";
const PORT = parseInt(process.env.IMAP_PORT || "993", 10);
const SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.INBOUND_SYNC_URL || "http://127.0.0.1:3000";
const DAYS = parseInt(process.env.INBOUND_SYNC_DAYS || "3", 10);

function fail(msg) {
  console.error(`[inbound-email-sync] ${msg}`);
  process.exit(1);
}
if (!SECRET) fail("CRON_SECRET not set");

// Resolve the list of mailboxes to sync.
let accounts = [];
if (process.env.INBOUND_MAILBOXES) {
  try {
    accounts = JSON.parse(process.env.INBOUND_MAILBOXES);
  } catch {
    fail("INBOUND_MAILBOXES is not valid JSON");
  }
} else {
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  if (user && pass) accounts = [{ user, pass }];
}
accounts = accounts.filter((a) => a && a.user && a.pass);
if (accounts.length === 0) fail("no mailboxes configured (INBOUND_MAILBOXES or IMAP_USER/PASS)");

const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

/** Fetch + parse the recent window from one mailbox; returns tagged emails. */
async function fetchMailbox(user, pass) {
  const out = [];
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    for await (const msg of client.fetch({ since }, { source: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        const fromAddr = parsed.from?.value?.[0];
        const rawHeader = (key) => {
          const line = (parsed.headerLines || []).find((h) => h.key === key);
          return line
            ? line.line.replace(new RegExp("^" + key + ":\\s*", "i"), "").trim()
            : undefined;
        };
        const ctObj = parsed.headers?.get("content-type");
        const contentType = ctObj
          ? typeof ctObj === "string"
            ? ctObj
            : [
                ctObj.value,
                ...Object.entries(ctObj.params || {}).map(([k, v]) => `${k}=${v}`),
              ].join("; ")
          : undefined;

        out.push({
          mailbox: user, // which inbox this arrived in (support@ vs paiement@)
          messageId: parsed.messageId || "",
          inReplyTo: parsed.inReplyTo || undefined,
          references: parsed.references || undefined,
          from: { name: fromAddr?.name || "", email: fromAddr?.address || "" },
          to: parsed.to?.text || undefined,
          subject: parsed.subject || undefined,
          text: parsed.text || undefined,
          html: typeof parsed.html === "string" ? parsed.html : undefined,
          date: parsed.date ? parsed.date.toISOString() : undefined,
          autoSubmitted: rawHeader("auto-submitted"),
          contentType,
          returnPath: rawHeader("return-path"),
          precedence: rawHeader("precedence"),
        });
      } catch (e) {
        console.error("[inbound-email-sync] parse error:", e?.message || e);
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return out;
}

const emails = [];
for (const { user, pass } of accounts) {
  try {
    const got = await fetchMailbox(user, pass);
    console.log(`[inbound-email-sync] ${user}: fetched ${got.length}`);
    emails.push(...got);
  } catch (e) {
    // One bad mailbox shouldn't block the others.
    console.error(`[inbound-email-sync] ${user}: IMAP error: ${e?.message || e}`);
  }
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
    `[inbound-email-sync] total=${emails.length} created=${json.created ?? "?"} skipped=${json.skipped ?? "?"} filtered=${json.filtered ?? "?"}`,
  );
} catch (e) {
  fail(`POST to ingestion route failed: ${e?.message || e}`);
}

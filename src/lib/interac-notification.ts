/**
 * Parse an Interac e-Transfer autodeposit notification.
 *
 * The `paiement@jechemine.ca` mailbox already receives these — the on-box IMAP
 * fetcher stores them as inbound `ExternalMessage`s — but nothing read them, so
 * every transfer was reconciled by hand. This turns one notification into the
 * facts needed to match it against an invoice.
 *
 * Shape of a real notification (French, Desjardins autodeposit):
 *
 *     Bonjour JE CHEMINE INC.,
 *     Les fonds ont été déposés!
 *     175,00 $
 *     ...
 *     Précisions sur le virement
 *
 *     Message :
 *     Élorie Braën INT-9126-0AE49D
 *
 *     Date : 31 août 2026
 *     Numéro de référence : C1AVzjTtqRCM
 *     Envoyé par : ELORIE BRAEN
 *     Montant : 25,00 $ (CAD)
 *
 * The `Message :` block is the sender's free-text memo and is ABSENT when they
 * did not write one — a real and common case. `Numéro de référence` is Interac's
 * own transaction id, unique per transfer, which makes it the natural
 * idempotency key.
 *
 * Deliberately pure and total: it never throws, and returns null for anything
 * that is not a genuine Interac deposit notification.
 */

import { readLabelledField } from "@/lib/interac-field";

/** Only these senders are trusted. Anyone can forge a body; the mailbox is the gate. */
const INTERAC_SENDER_RE = /@payments\.interac\.ca$/i;

/** The platform's own per-appointment reference, e.g. INT-9126-0AE49D. */
export const REFERENCE_CODE_RE = /INT-[0-9A-F]{4}-[0-9A-F]{6}/i;

export interface RawInteracEmail {
  from?: string | null;
  subject?: string | null;
  text?: string | null;
}

export interface ParsedInteracNotification {
  /** Amount deposited, in CAD. */
  amountCad: number;
  /** Interac's own transaction reference — unique per transfer. */
  interacTransactionRef: string | null;
  /** Name on the sending bank account. */
  payerName: string | null;
  /** The sender's free-text memo, when they wrote one. */
  memo: string | null;
  /** Our INT- code, if the memo (or anywhere in the mail) carries it. */
  referenceCode: string | null;
}

const clean = (v: string | null | undefined): string =>
  typeof v === "string" ? v.trim() : "";

/**
 * Read a French money amount: "175,00 $", "1 234,56 $", "25,00 $ (CAD)".
 * Thousands separators may be a normal space, a non-breaking space, or a thin
 * space depending on the mail client that rendered it.
 */
export function parseFrenchAmount(value: string | null | undefined): number | null {
  const raw = clean(value);
  if (!raw) return null;
  const m = raw.match(/(\d[\d\s\u00a0\u202f]*(?:,\d{1,2})?)\s*\$/);
  if (!m) return null;
  const normalized = m[1].replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** True when the mail genuinely comes from Interac's notification service. */
export function isInteracNotificationSender(from: string | null | undefined): boolean {
  const f = clean(from).toLowerCase();
  // Tolerate a full "Name <addr>" header as well as a bare address.
  const addr = f.includes("<") ? f.slice(f.lastIndexOf("<") + 1, f.lastIndexOf(">")) : f;
  return INTERAC_SENDER_RE.test(clean(addr));
}

/**
 * Parse a notification, or return null when this is not a deposit advice we
 * understand. A funds-deposited notification always carries an amount; without
 * one there is nothing to reconcile against.
 */
export function parseInteracNotification(
  raw: RawInteracEmail,
): ParsedInteracNotification | null {
  if (!isInteracNotificationSender(raw.from)) return null;

  const text = clean(raw.text);
  const subject = clean(raw.subject);
  if (!text && !subject) return null;

  // Prefer the explicit "Montant :" line; fall back to the subject, which reads
  // "Vous avez reçu 175,00 $ de <name>".
  const amountCad =
    parseFrenchAmount(readLabelledField(text, "Montant")) ?? parseFrenchAmount(subject);
  if (amountCad === null) return null;

  const memoMatch = text.match(/^\s*Message\s*:\s*$\r?\n([\s\S]*?)(?=\r?\n\s*\r?\n|\r?\n\s*Date\s*:)/im);
  const inlineMemo = readLabelledField(text, "Message");
  const memo = clean(memoMatch ? memoMatch[1] : inlineMemo) || null;

  // The code normally lives in the memo. Fall back to the whole body so a
  // client who wrote it somewhere unexpected is still matched — the code itself
  // is specific enough that a stray occurrence is not a realistic risk.
  const codeMatch = (memo ?? "").match(REFERENCE_CODE_RE) ?? text.match(REFERENCE_CODE_RE);

  return {
    amountCad,
    interacTransactionRef: readLabelledField(text, "Numéro de référence"),
    payerName: readLabelledField(text, "Envoyé par"),
    memo,
    referenceCode: codeMatch ? codeMatch[0].toUpperCase() : null,
  };
}

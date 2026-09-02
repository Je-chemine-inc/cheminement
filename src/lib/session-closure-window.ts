/**
 * When may a session be closed as "completed"?
 *
 * Closing a session is the moment money moves: it stamps `sessionCompletedAt`,
 * issues an invoice number, creates the client receipt and starts the dunning
 * clock (H+12 / H+36 reminders, H+48 → "overdue" + admin alert). Nothing
 * checked that the session had actually happened.
 *
 * Live consequence (JC-2026-000014): a session booked for **9 September** was
 * closed as completed on **31 August**, three hours after it was created and
 * nine days before it was due. The client was invoiced $175 and chased through
 * the full reminder cascade for a session she had not yet attended — while the
 * session she *had* attended was separately invoiced and paid. From her side it
 * looked like the platform kept dunning an invoice she had already settled.
 *
 * The rule: a session may be closed from shortly before its start onwards.
 * The grace window is deliberately generous — a professional legitimately
 * closes a no-show or wraps up paperwork around the start time, and clock skew
 * should never block a real closure — but it is nowhere near wide enough to let
 * a session days away be closed.
 *
 * An appointment with no resolvable start (still awaiting scheduling) is left
 * to the caller's other guards: this rule has nothing to say about it, and
 * refusing here would break manual invoicing.
 */

/** How long before its start a session may already be closed. */
export const EARLY_CLOSURE_GRACE_MS = 2 * 60 * 60 * 1000;

export interface ClosureWindowVerdict {
  closable: boolean;
  /** Milliseconds until closing becomes allowed (0 once it is). */
  waitMs: number;
}

export function sessionClosureWindow(
  startAt: Date | null | undefined,
  nowMs: number = Date.now(),
): ClosureWindowVerdict {
  if (!startAt) return { closable: true, waitMs: 0 };
  const start = startAt.getTime();
  if (Number.isNaN(start)) return { closable: true, waitMs: 0 };

  const opensAt = start - EARLY_CLOSURE_GRACE_MS;
  if (nowMs >= opensAt) return { closable: true, waitMs: 0 };
  return { closable: false, waitMs: opensAt - nowMs };
}

/** Convenience predicate for call sites that do not need the countdown. */
export function canCloseSession(
  startAt: Date | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return sessionClosureWindow(startAt, nowMs).closable;
}

/**
 * iCalendar (RFC 5545) feed builder for the professional calendar-sync feature.
 *
 * Pure + framework-agnostic so it can be unit-tested. The HTTP route selects the
 * appointments and supplies already-localized text (summary/description); this
 * module only turns events into a valid `.ics` payload — escaping, 75-octet line
 * folding, CRLF endings, and a bundled `America/Toronto` VTIMEZONE so wall-clock
 * appointment times land correctly across DST without any offset math here.
 */

export const APPOINTMENT_TZID = "America/Toronto";

export type IcsEvent = {
  /** Stable unique id (the appointment id); becomes the VEVENT UID. */
  uid: string;
  /** Calendar day (stored UTC-noon-anchored — only its Y/M/D are read). */
  date: Date | string;
  /** Local wall-clock start, "HH:mm" (Montréal time). */
  time: string;
  /** Length in minutes; end = start + duration (rolls past midnight safely). */
  durationMinutes: number;
  /** Pre-localized one-line title. */
  summary: string;
  /** Pre-localized multi-line description (optional). */
  description?: string;
  /** Join URL or physical address (optional). */
  location?: string;
  /** Defaults to "confirmed". A cancelled event keeps the slot tombstoned. */
  status?: "confirmed" | "cancelled";
  /** Drives LAST-MODIFIED so subscribers pick up edits. */
  lastModified?: Date | string | null;
};

// Canonical America/Toronto zone (US/Canada Eastern DST rules). Bundling it makes
// the feed RFC-compliant; Google/Apple/Outlook all honour TZID with this block.
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${APPOINTMENT_TZID}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Escape TEXT values per RFC 5545 §3.3.11 (backslash, semicolon, comma, NL). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line to ≤75 octets (RFC 5545 §3.1): continuation lines start
 * with a single space. Counts UTF-8 bytes and never splits a multibyte char.
 */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    // 73 keeps a margin under 75 for the leading space on continuations.
    if (bytes + chBytes > 73) {
      out.push(current);
      current = " " + ch; // continuation marker
      bytes = 1 + chBytes;
    } else {
      current += ch;
      bytes += chBytes;
    }
  }
  if (current) out.push(current);
  return out.join("\r\n");
}

/** UTC stamp "YYYYMMDDTHHMMSSZ". */
function utcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Floating local stamp "YYYYMMDDTHHMMSS" (paired with TZID). */
function localStamp(parts: {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}): string {
  return (
    `${parts.y}${pad(parts.mo)}${pad(parts.d)}` +
    `T${pad(parts.h)}${pad(parts.mi)}00`
  );
}

/**
 * Resolve an event's start/end wall-clock components. The date is only mined for
 * Y/M/D via UTC getters (it is stored anchored at UTC noon, so those are the
 * intended calendar day regardless of server timezone); the time string gives
 * the local hour/minute. Arithmetic is done in a UTC "math space" purely to roll
 * the end past midnight — the TZID label, not these numbers, applies the zone.
 */
function resolveStartEnd(ev: IcsEvent): {
  start: { y: number; mo: number; d: number; h: number; mi: number };
  end: { y: number; mo: number; d: number; h: number; mi: number };
} | null {
  const date = ev.date instanceof Date ? ev.date : new Date(ev.date);
  if (Number.isNaN(date.getTime())) return null;
  const [hStr, mStr] = (ev.time || "").split(":");
  const h = Number.parseInt(hStr, 10);
  const mi = Number.parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(mi)) return null;

  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth(); // 0-based for Date.UTC
  const d = date.getUTCDate();
  const dayBase = Date.UTC(y, mo, d);
  const startMs = dayBase + (h * 60 + mi) * 60_000;
  const dur = Number.isFinite(ev.durationMinutes) ? ev.durationMinutes : 60;
  const endMs = startMs + Math.max(1, dur) * 60_000;
  const read = (ms: number) => {
    const x = new Date(ms);
    return {
      y: x.getUTCFullYear(),
      mo: x.getUTCMonth() + 1,
      d: x.getUTCDate(),
      h: x.getUTCHours(),
      mi: x.getUTCMinutes(),
    };
  };
  return { start: read(startMs), end: read(endMs) };
}

/**
 * Build a complete VCALENDAR string from the events. Skips any event whose
 * date/time cannot be parsed (rather than emitting a broken VEVENT).
 */
export function buildProfessionalCalendarIcs(
  events: IcsEvent[],
  opts: { calendarName: string; now?: Date; tzid?: string },
): string {
  const now = opts.now ?? new Date();
  const dtstamp = utcStamp(now);
  const tzid = opts.tzid ?? APPOINTMENT_TZID;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Je chemine//Calendar Feed//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    `X-WR-TIMEZONE:${tzid}`,
    ...VTIMEZONE,
  ];

  for (const ev of events) {
    const se = resolveStartEnd(ev);
    if (!se) continue;
    const lastMod = ev.lastModified
      ? ev.lastModified instanceof Date
        ? ev.lastModified
        : new Date(ev.lastModified)
      : null;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}@jechemine.ca`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=${tzid}:${localStamp(se.start)}`);
    lines.push(`DTEND;TZID=${tzid}:${localStamp(se.end)}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    lines.push(`STATUS:${ev.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`);
    if (lastMod && !Number.isNaN(lastMod.getTime())) {
      lines.push(`LAST-MODIFIED:${utcStamp(lastMod)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

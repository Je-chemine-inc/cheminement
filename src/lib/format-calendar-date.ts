/**
 * Format a date for display without the day sliding backwards.
 *
 * `new Date("2026-09-04")` — a date-ONLY ISO string — is parsed by JS as **UTC
 * midnight**, and `toLocaleDateString()` then renders it in the viewer's zone.
 * In Montréal (UTC−4/−5) that is 20:00 the *previous* day, so a session on
 * 4 September was displayed, invoiced and exported as **3 September**.
 *
 * Appointment dates are stored anchored at UTC noon (see `parseAppointmentDate`)
 * precisely so they survive this, but several API routes serialize them with
 * `.toISOString().split("T")[0]`, handing the UI a bare calendar day again — and
 * the bug comes back at the display layer.
 *
 * A calendar day is not an instant. This formats it as the day it says, while
 * still rendering genuine timestamps (createdAt, paidAt) in local time, so one
 * helper can safely serve call sites that receive a mix of both.
 */

/** A bare calendar day, e.g. "2026-09-04" — no time, therefore no timezone. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && DATE_ONLY_RE.test(value.trim());
}

/**
 * @param value   a calendar day ("2026-09-04"), an ISO timestamp, or a Date
 * @param locale  BCP-47 tag, e.g. "fr-CA"
 * @param options Intl options; `timeZone` is forced to UTC for a calendar day
 *                and must not be overridden for one.
 */
export function formatCalendarDate(
  value: string | Date | null | undefined,
  locale = "fr-CA",
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
  },
): string {
  if (value === null || value === undefined || value === "") return "—";

  if (isDateOnly(value)) {
    // Read it back at UTC noon so no zone on earth can shift the day.
    const [y, m, d] = value.trim().split("-").map(Number);
    const at = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    if (isNaN(at.getTime())) return "—";
    return at.toLocaleDateString(locale, { ...options, timeZone: "UTC" });
  }

  const at = value instanceof Date ? value : new Date(value);
  if (isNaN(at.getTime())) return "—";

  // A UTC-noon anchored Date is safe in any zone within ±12h, so a genuine
  // timestamp and a stored appointment date both render as the intended day.
  return at.toLocaleDateString(locale, options);
}

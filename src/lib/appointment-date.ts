/**
 * Appointment calendar-day handling.
 *
 * Appointments store a `date` (the calendar day) and a separate `time`
 * ("HH:MM"). A bare `new Date("2026-05-30")` parses to UTC **midnight**, which
 * renders as the PREVIOUS day for any negative-UTC viewer (e.g. May 29 in
 * Montreal, UTC-4/-5) — the systematic "24h shift" bug.
 *
 * Fix: anchor the stored date at UTC **noon**. Noon ± any North-American offset
 * (indeed any zone within ~±11h of UTC) stays on the same calendar day, so
 * client-side display via local getters / toLocaleDateString lands on the day
 * the appointment was actually booked for — with no per-display-site changes.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a calendar-day input into a Date anchored at UTC noon of that day.
 * - "YYYY-MM-DD" (from <input type="date">) → that day at 12:00:00 UTC.
 * - A full datetime string (with "T") or a Date → returned as-is (it already
 *   carries an instant).
 * Returns null for empty / unparseable input.
 */
export function parseAppointmentDate(
  input: string | Date | undefined | null,
): Date | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const s = String(input).trim();
  const m = DATE_ONLY.exec(s);
  if (m) {
    const d = new Date(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calendar-day key ("YYYY-MM-DD") for a stored appointment date, read from UTC
 * parts so it always reflects the booked day regardless of viewer timezone.
 * (Pairs with the UTC-noon anchor; also correct for legacy UTC-midnight rows.)
 */
export function appointmentDayKey(
  date: Date | string | undefined | null,
): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

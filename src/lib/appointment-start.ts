/**
 * Date/heure de début réelle (instant UTC) du rendez-vous — utilisée pour les
 * fenêtres H-72 / H-48 et autres calculs « heures avant le RDV ».
 */

const APPOINTMENT_TZ = "America/Toronto";

/**
 * Minutes by which America/Toronto is offset from UTC at the given instant
 * (e.g. -240 in EDT, -300 in EST). Uses Intl so DST is handled correctly.
 */
function torontoOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: APPOINTMENT_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  }
  const wallAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return (wallAsUtc - at.getTime()) / 60000;
}

export function getAppointmentStartAt(apt: {
  date?: Date;
  time?: string;
  scheduledStartAt?: Date;
}): Date | null {
  if (apt.scheduledStartAt) {
    const d = new Date(apt.scheduledStartAt);
    return isNaN(d.getTime()) ? null : d;
  }
  if (!apt.date) return null;
  const base =
    apt.date instanceof Date ? new Date(apt.date) : new Date(apt.date as Date);
  if (isNaN(base.getTime())) return null;
  const [hoursStr, minutesStr] = (apt.time || "00:00").split(":");
  const hours = parseInt(hoursStr || "0", 10);
  const minutes = parseInt(minutesStr || "0", 10);

  // The date is stored anchored at UTC noon, so its calendar day is read via the
  // UTC getters (stable regardless of server timezone). The time string is the
  // local wall-clock time in Montréal (America/Toronto) — convert it to the real
  // UTC instant. The old code used `base.setHours()`, which interprets the time
  // in the SERVER's zone (UTC on Vercel), landing every start 4–5h early and
  // shifting the reminder windows + the 48h cancellation boundary.
  const asUtcWall = Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate(),
    hours,
    minutes,
    0,
    0,
  );
  const offsetMin = torontoOffsetMinutes(new Date(asUtcWall));
  return new Date(asUtcWall - offsetMin * 60000);
}

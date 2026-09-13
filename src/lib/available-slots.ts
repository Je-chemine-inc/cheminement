import { APPOINTMENT_TZ } from "@/lib/appointment-start";

/**
 * A professional's free times (spec 003 phase 3), as pure functions. The weekly
 * grid comes from `Profile.availability`; whatever is busy — a session, a slot
 * held for a request — removes every grid time it overlaps. The public page,
 * the booking intake that re-checks a chosen time and the professional's own
 * scheduling modal all compute slots here, so they cannot disagree.
 *
 * Days ("YYYY-MM-DD") and times ("HH:mm") are Montréal wall-clock values, the
 * way appointments store them. Instants use Montréal's real offset, daylight
 * saving included; the server's own time zone never enters.
 */

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const DEFAULT_SESSION_MINUTES = 60;
export const DEFAULT_BREAK_MINUTES = 15;

export interface WeeklyAvailability {
  days?: ReadonlyArray<{
    day?: string | null;
    isWorkDay?: boolean | null;
    startTime?: string | null;
    endTime?: string | null;
  } | null> | null;
  sessionDurationMinutes?: number | null;
  breakDurationMinutes?: number | null;
}

/** Time already taken: a session, or a slot held for a request. */
export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface FreeSlotDay {
  day: string;
  slots: string[];
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLOT_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const pad = (value: number) => String(value).padStart(2, "0");

function dayParts(dayKey: string): [number, number, number] | null {
  const match = DAY_KEY.exec(dayKey);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function requireDayParts(dayKey: string): [number, number, number] {
  const parts = dayParts(dayKey);
  if (!parts) throw new Error(`Invalid day key: ${dayKey}`);
  return parts;
}

/** A real calendar day written "YYYY-MM-DD". */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = dayParts(value);
  if (!parts) return false;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return (
    date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2]
  );
}

/** A start time written "HH:mm", 00:00 to 23:59. */
export function isSlotTime(value: unknown): value is string {
  return typeof value === "string" && SLOT_TIME.test(value);
}

/** "9:05" or "09:05" to "09:05"; null for anything that is not a time of day. */
export function normalizeClock(value: string | null | undefined): string | null {
  const match = CLOCK.exec(value?.trim() ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? `${pad(hours)}:${pad(minutes)}` : null;
}

/** Minutes since midnight of a working-hours bound; "24:00" closes a day. */
function clockMinutes(value: string | null | undefined): number | null {
  const match = CLOCK.exec(value?.trim() ?? "");
  if (!match) return null;
  const minutes = Number(match[2]);
  const total = Number(match[1]) * 60 + minutes;
  return minutes < 60 && total <= 24 * 60 ? total : null;
}

/** The calendar day `days` after `dayKey` (before it when negative). */
export function addDays(dayKey: string, days: number): string {
  const [year, month, day] = requireDayParts(dayKey);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Whole days from one day to another: 0 for the same day, negative when `to` comes first. */
export function daysBetween(from: string, to: string): number {
  const a = requireDayParts(from);
  const b = requireDayParts(to);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY_MS);
}

/** The weekday of a calendar day, as `Profile.availability.days` names it. */
export function weekdayOf(dayKey: string): Weekday {
  const [year, month, day] = requireDayParts(dayKey);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()];
}

const montrealClock = new Intl.DateTimeFormat("en-US", {
  timeZone: APPOINTMENT_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function wallClockAt(at: Date) {
  const parts: Record<string, number> = {};
  for (const part of montrealClock.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

function offsetMinutesAt(at: Date): number {
  const wall = wallClockAt(at);
  return Math.round(
    (Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - at.getTime()) / MINUTE_MS,
  );
}

/** Montréal's calendar day at an instant. */
export function torontoDayKey(at: Date): string {
  const wall = wallClockAt(at);
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/**
 * The instant a Montréal wall-clock time starts, or null when that time does
 * not exist — the hour the clocks skip in spring. In the autumn hour that
 * happens twice, the first one.
 */
export function slotStartsAt(dayKey: string, time: string): Date | null {
  const day = dayParts(dayKey);
  const clock = SLOT_TIME.exec(time);
  if (!day || !clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const wall = Date.UTC(day[0], day[1] - 1, day[2], hour, minute);
  // The offset depends on the instant being computed: guess, then correct once.
  let instant = wall - offsetMinutesAt(new Date(wall)) * MINUTE_MS;
  instant = wall - offsetMinutesAt(new Date(instant)) * MINUTE_MS;
  const check = wallClockAt(new Date(instant));
  const exists =
    check.year === day[0] &&
    check.month === day[1] &&
    check.day === day[2] &&
    check.hour === hour &&
    check.minute === minute;
  return exists ? new Date(instant) : null;
}

/**
 * The session length and the break after each session. A break of 0 is a real
 * setting — back-to-back sessions — and is kept; the legacy route's `|| 15`
 * turned it into 15.
 */
export function slotGridOf(availability: WeeklyAvailability | null | undefined): {
  sessionMinutes: number;
  breakMinutes: number;
} {
  const session = availability?.sessionDurationMinutes;
  const pause = availability?.breakDurationMinutes;
  return {
    sessionMinutes:
      typeof session === "number" && Number.isFinite(session) && session >= 5 && session <= 480
        ? Math.round(session)
        : DEFAULT_SESSION_MINUTES,
    breakMinutes:
      typeof pause === "number" && Number.isFinite(pause) && pause >= 0 && pause <= 240
        ? Math.round(pause)
        : DEFAULT_BREAK_MINUTES,
  };
}

/** A day's working hours, or null when the professional does not work that day. */
export function workingHoursOf(
  availability: WeeklyAvailability | null | undefined,
  dayKey: string,
): { startTime: string; endTime: string } | null {
  if (!isDayKey(dayKey)) return null;
  const weekday = weekdayOf(dayKey);
  const entry = availability?.days?.find((candidate) => candidate?.day === weekday);
  if (!entry?.isWorkDay || !entry.startTime || !entry.endTime) return null;
  return { startTime: entry.startTime, endTime: entry.endTime };
}

/**
 * The start times of a working day: a session, a break, and again while a
 * whole session still fits before the end.
 */
export function generateTimeSlots(
  startTime: string,
  endTime: string,
  sessionMinutes: number,
  breakMinutes: number,
): string[] {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  if (start === null || end === null || !(sessionMinutes > 0) || !(breakMinutes >= 0)) return [];
  const slots: string[] = [];
  for (let current = start; current + sessionMinutes <= end; current += sessionMinutes + breakMinutes) {
    slots.push(`${pad(Math.floor(current / 60))}:${pad(current % 60)}`);
  }
  return slots;
}

/**
 * Free start times, day by day from `fromDay`: the working grid, minus times
 * that start too soon and times whose consultation would overlap something
 * busy. Every day of the range is returned, empty ones included.
 */
export function computeFreeSlots(input: {
  availability: WeeklyAvailability | null | undefined;
  fromDay: string;
  days: number;
  now: Date;
  /** Nothing starts sooner than this after `now`; 0 still means strictly later. */
  minLeadMinutes: number;
  /** The consultation's length; the grid's session length by default. */
  durationMinutes?: number;
  busy: readonly BusyInterval[];
}): FreeSlotDay[] {
  if (!isDayKey(input.fromDay)) return [];
  const grid = slotGridOf(input.availability);
  const duration =
    typeof input.durationMinutes === "number" && input.durationMinutes > 0
      ? input.durationMinutes
      : grid.sessionMinutes;
  const earliest = input.now.getTime() + Math.max(0, input.minLeadMinutes) * MINUTE_MS;

  const result: FreeSlotDay[] = [];
  for (let offset = 0; offset < input.days; offset++) {
    const day = addDays(input.fromDay, offset);
    const hours = workingHoursOf(input.availability, day);
    const slots: string[] = [];
    if (hours) {
      for (const time of generateTimeSlots(hours.startTime, hours.endTime, grid.sessionMinutes, grid.breakMinutes)) {
        const startsAt = slotStartsAt(day, time);
        if (!startsAt || startsAt.getTime() <= earliest) continue;
        const start = startsAt.getTime();
        const end = start + duration * MINUTE_MS;
        const taken = input.busy.some(
          (interval) => start < interval.endsAt.getTime() && interval.startsAt.getTime() < end,
        );
        if (!taken) slots.push(time);
      }
    }
    result.push({ day, slots });
  }
  return result;
}

import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import SlotHold from "@/models/SlotHold";
import { appointmentDayKey } from "@/lib/appointment-date";
import {
  addDays,
  isDayKey,
  normalizeClock,
  slotStartsAt,
  type BusyInterval,
} from "@/lib/available-slots";

/**
 * What already occupies a professional's time (spec 003 phase 3): sessions
 * scheduled or under way, and slots held for a request. It feeds the free-slot
 * computation, and the check a route makes before it gives a time away.
 */

/** A session in these statuses takes up its time. */
export const OCCUPYING_STATUSES = ["scheduled", "ongoing"] as const;

const MINUTE_MS = 60 * 1000;
const DEFAULT_SESSION_MINUTES = 60;

export interface OccupiedInterval extends BusyInterval {
  kind: "session" | "hold";
  id: string;
}

export type SlotCollisionCode = "SLOT_CONFLICT" | "SLOT_HELD";

type SessionRow = { _id: unknown; date?: Date | null; time?: string | null; duration?: number | null };
type HoldRow = { _id: unknown; startsAt: Date; durationMinutes: number };

function objectId(id: string | undefined): mongoose.Types.ObjectId | null {
  return id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function utcMidnight(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** A session's interval from its stored day, Montréal time and length; null when it cannot be placed. */
export function sessionInterval(row: {
  date?: Date | string | null;
  time?: string | null;
  duration?: number | null;
}): BusyInterval | null {
  const time = normalizeClock(row.time);
  const dayKey = appointmentDayKey(row.date);
  const startsAt = time && dayKey ? slotStartsAt(dayKey, time) : null;
  if (!startsAt) return null;
  const minutes = typeof row.duration === "number" && row.duration > 0 ? row.duration : DEFAULT_SESSION_MINUTES;
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * MINUTE_MS) };
}

/**
 * A professional's sessions and live holds between two Montréal days,
 * inclusive. A day is read on either side: stored dates are anchored at UTC
 * noon (older rows at midnight), and a late session can run past midnight.
 */
export async function loadOccupiedIntervals(input: {
  professionalId: string;
  fromDay: string;
  toDay: string;
  now?: Date;
  /** Leave this request out: it never collides with itself. */
  exceptAppointmentId?: string;
  /** Leave this hold out: a waitlist offer being claimed holds the very time it asks for. */
  exceptHoldId?: string;
}): Promise<OccupiedInterval[]> {
  const professionalId = objectId(input.professionalId);
  if (!professionalId || !isDayKey(input.fromDay) || !isDayKey(input.toDay)) return [];
  await connectToDatabase();
  const except = objectId(input.exceptAppointmentId);
  const exceptHold = objectId(input.exceptHoldId);
  const sessionFilter: Record<string, unknown> = {
    professionalId,
    status: { $in: OCCUPYING_STATUSES },
    date: { $gte: utcMidnight(addDays(input.fromDay, -1)), $lt: utcMidnight(addDays(input.toDay, 2)) },
  };
  const holdFilter: Record<string, unknown> = {
    professionalId,
    dayKey: { $gte: addDays(input.fromDay, -1), $lte: addDays(input.toDay, 1) },
    expiresAt: { $gt: input.now ?? new Date() },
  };
  if (except) {
    sessionFilter._id = { $ne: except };
    holdFilter.appointmentId = { $ne: except };
  }
  if (exceptHold) holdFilter._id = { $ne: exceptHold };
  const [sessions, holds] = await Promise.all([
    Appointment.find(sessionFilter).select("date time duration").lean<SessionRow[]>(),
    SlotHold.find(holdFilter).select("startsAt durationMinutes").lean<HoldRow[]>(),
  ]);

  const occupied: OccupiedInterval[] = [];
  for (const session of sessions) {
    const interval = sessionInterval(session);
    if (interval) occupied.push({ ...interval, kind: "session", id: String(session._id) });
  }
  for (const hold of holds) {
    const startsAt = new Date(hold.startsAt);
    occupied.push({
      startsAt,
      endsAt: new Date(startsAt.getTime() + hold.durationMinutes * MINUTE_MS),
      kind: "hold",
      id: String(hold._id),
    });
  }
  return occupied;
}

/**
 * What a consultation at this Montréal time would collide with — a session
 * before a hold — or null. `holdsOnly` is for the routes that already check
 * sessions their own way and only need to respect a pending request.
 */
export async function findSlotCollision(input: {
  professionalId: string;
  dayKey: string;
  time: string;
  durationMinutes: number;
  now?: Date;
  exceptAppointmentId?: string;
  holdsOnly?: boolean;
}): Promise<OccupiedInterval | null> {
  const time = normalizeClock(input.time);
  const startsAt = time && isDayKey(input.dayKey) ? slotStartsAt(input.dayKey, time) : null;
  if (!startsAt) return null;
  const start = startsAt.getTime();
  const minutes = input.durationMinutes > 0 ? input.durationMinutes : DEFAULT_SESSION_MINUTES;
  const end = start + minutes * MINUTE_MS;
  const occupied = await loadOccupiedIntervals({
    professionalId: input.professionalId,
    fromDay: input.dayKey,
    toDay: input.dayKey,
    now: input.now,
    exceptAppointmentId: input.exceptAppointmentId,
  });
  const overlapping = occupied.filter(
    (interval) =>
      (!input.holdsOnly || interval.kind === "hold") &&
      start < interval.endsAt.getTime() &&
      interval.startsAt.getTime() < end,
  );
  return overlapping.find((interval) => interval.kind === "session") ?? overlapping[0] ?? null;
}

/** The 409 body for a collision. */
export function slotCollisionError(collision: OccupiedInterval): { error: string; code: SlotCollisionCode } {
  return collision.kind === "session"
    ? { error: "This time slot is already booked", code: "SLOT_CONFLICT" }
    : { error: "This time slot is held for a pending request", code: "SLOT_HELD" };
}

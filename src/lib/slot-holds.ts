import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import SlotHold, { type SlotHoldKind } from "@/models/SlotHold";

/**
 * Holding a professional's slot (spec 003 phase 3). A hold is the single lock
 * a booking path takes before it may use a slot: the unique index on
 * professional, day and time makes the first insert win. A hold past its
 * `expiresAt` is free even before MongoDB's TTL collects it, and is taken over
 * atomically.
 */

export type SlotKey = {
  professionalId: string;
  /** Montréal calendar day, "YYYY-MM-DD". */
  dayKey: string;
  /** Montréal wall-clock start, "HH:mm". */
  time: string;
};

export type AcquireSlotHoldResult = { ok: true; holdId: string } | { ok: false; code: "SLOT_TAKEN" };

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

function keyFilter(key: SlotKey) {
  return {
    professionalId: new mongoose.Types.ObjectId(key.professionalId),
    dayKey: key.dayKey,
    time: key.time,
  };
}

export async function acquireSlotHold(
  input: SlotKey & {
    startsAt: Date;
    durationMinutes: number;
    kind: SlotHoldKind;
    expiresAt: Date;
    appointmentId?: string;
    waitlistEntryId?: string;
    now?: Date;
  },
): Promise<AcquireSlotHoldResult> {
  await connectToDatabase();
  const key = keyFilter(input);
  const fields: Record<string, unknown> = {
    startsAt: input.startsAt,
    durationMinutes: input.durationMinutes,
    kind: input.kind,
    expiresAt: input.expiresAt,
  };
  if (input.appointmentId) fields.appointmentId = input.appointmentId;
  if (input.waitlistEntryId) fields.waitlistEntryId = input.waitlistEntryId;

  try {
    const created = await SlotHold.create({ ...key, ...fields });
    return { ok: true, holdId: String(created._id) };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }

  // Somebody holds it. A hold already past its expiry is free: take it over,
  // conditionally on still being expired, so two takers cannot both win.
  const unset: Record<string, ""> = {};
  if (!input.appointmentId) unset.appointmentId = "";
  if (!input.waitlistEntryId) unset.waitlistEntryId = "";
  const update: Record<string, unknown> = { $set: fields };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  const taken = await SlotHold.findOneAndUpdate(
    { ...key, expiresAt: { $lte: input.now ?? new Date() } },
    update,
    { new: true },
  )
    .select("_id")
    .lean();
  return taken ? { ok: true, holdId: String(taken._id) } : { ok: false, code: "SLOT_TAKEN" };
}

/** Records which request holds the slot, once the request exists — only on a hold nobody claimed. */
export async function attachSlotHoldToAppointment(holdId: string, appointmentId: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(holdId)) return false;
  await connectToDatabase();
  const res = await SlotHold.updateOne(
    { _id: holdId, appointmentId: { $exists: false } },
    { $set: { appointmentId } },
  );
  return res.modifiedCount === 1;
}

/**
 * Frees a slot. With an owner, only while that owner still holds it — never
 * a hold someone took over after this one expired.
 */
export async function releaseSlotHold(
  holdId: string,
  owner: { appointmentId?: string; waitlistEntryId?: string } = {},
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(holdId)) return false;
  await connectToDatabase();
  const filter: Record<string, unknown> = { _id: holdId };
  if (owner.appointmentId) filter.appointmentId = owner.appointmentId;
  if (owner.waitlistEntryId) filter.waitlistEntryId = owner.waitlistEntryId;
  const res = await SlotHold.deleteOne(filter);
  return res.deletedCount === 1;
}

/** The live hold on a slot, if any. */
export async function findLiveSlotHold(
  key: SlotKey,
  now: Date = new Date(),
): Promise<{ holdId: string; kind: SlotHoldKind; appointmentId: string | null } | null> {
  if (!mongoose.Types.ObjectId.isValid(key.professionalId)) return null;
  await connectToDatabase();
  const hold = await SlotHold.findOne({ ...keyFilter(key), expiresAt: { $gt: now } })
    .select("_id kind appointmentId")
    .lean();
  return hold
    ? { holdId: String(hold._id), kind: hold.kind, appointmentId: hold.appointmentId ? String(hold.appointmentId) : null }
    : null;
}

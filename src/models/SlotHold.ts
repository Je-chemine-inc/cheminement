import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * A professional's time slot held for a request (spec 003 phase 3) — the one
 * lock every booking path takes before it may use a slot. The unique index on
 * professional, day and time means two requests can never hold the same slot,
 * and the hold's length blocks every other time it overlaps.
 *
 * `expiresAt` carries a TTL index for garbage collection only: MongoDB deletes
 * expired documents about once a minute, so the code treats a hold past
 * `expiresAt` as free and takes it over atomically instead of waiting.
 */
export const SLOT_HOLD_KINDS = ["direct_request", "waitlist_offer"] as const;
export type SlotHoldKind = (typeof SLOT_HOLD_KINDS)[number];

export interface ISlotHold {
  professionalId: Types.ObjectId;
  /** Montréal calendar day, "YYYY-MM-DD". */
  dayKey: string;
  /** Montréal wall-clock start, "HH:mm". */
  time: string;
  /** The instant the slot starts. */
  startsAt: Date;
  /** How long the consultation it is held for lasts. */
  durationMinutes: number;
  kind: SlotHoldKind;
  /** The request holding the slot, once it exists. */
  appointmentId?: Types.ObjectId;
  /** The waitlist entry an offer was made to (phase 4). */
  waitlistEntryId?: Types.ObjectId;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SlotHoldSchema = new Schema<ISlotHold>(
  {
    professionalId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dayKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    time: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    startsAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 5, max: 480 },
    kind: { type: String, enum: SLOT_HOLD_KINDS, required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
    waitlistEntryId: { type: Schema.Types.ObjectId },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

SlotHoldSchema.index({ professionalId: 1, dayKey: 1, time: 1 }, { unique: true });
SlotHoldSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SlotHoldSchema.index({ appointmentId: 1 }, { sparse: true });

const SlotHold: Model<ISlotHold> =
  (mongoose.models.SlotHold as Model<ISlotHold> | undefined) ||
  mongoose.model<ISlotHold>("SlotHold", SlotHoldSchema);

export default SlotHold;

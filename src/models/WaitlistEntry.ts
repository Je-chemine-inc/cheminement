import mongoose, { Schema, type Model, type Types } from "mongoose";
import { attachContactStringEncryption } from "@/lib/mongoose-contact-encryption";
import { DIRECT_REQUEST_SERVICES, type DirectRequestService } from "@/lib/direct-request-rules";
import {
  WAITLIST_MODALITIES,
  WAITLIST_OFFER_OUTCOMES,
  WAITLIST_PERIODS,
  WAITLIST_REMOVAL_REASONS,
  WAITLIST_STATUSES,
  WAITLIST_WEEKDAYS,
  type WaitlistModality,
  type WaitlistOfferOutcome,
  type WaitlistPeriod,
  type WaitlistRemovalReason,
  type WaitlistStatus,
  type WaitlistWeekday,
} from "@/lib/waitlist-rules";

/**
 * A person waiting for a time with one professional, from the professional's
 * showcase page (spec 003 phase 4). Rules in lib/waitlist-rules.ts, offers in
 * lib/waitlist-offers.ts, claims in lib/waitlist-entries.ts.
 *
 * Also the record of the visitor's consent, so it is not deleted on a TTL:
 * a closed entry is purged WAITLIST_CLOSED_RETENTION_DAYS after `closedAt`.
 * The position in the queue is never stored: it is the order of `createdAt`
 * among open entries.
 */

export interface IWaitlistOffer {
  _id?: Types.ObjectId;
  dayKey: string;
  time: string;
  startsAt: Date;
  durationMinutes: number;
  holdId: Types.ObjectId;
  /** sha256 of the link token. The token itself is only ever in the email and text message. */
  tokenHash: string;
  sentAt: Date;
  expiresAt: Date;
  channels: ("email" | "sms")[];
  outcome: WaitlistOfferOutcome;
  claimingAt?: Date;
  appointmentId?: Types.ObjectId;
}

export interface IWaitlistEntry {
  _id: Types.ObjectId;
  professionalId: Types.ObjectId;
  /** The page and the name shown when the person joined, for the emails. */
  showcaseSlug: string;
  cityKey: string;
  professionalName: string;
  /** The account the entry became a request for, once claimed. */
  userId?: Types.ObjectId;
  firstName: string;
  lastName: string;
  /** Lowercase, plaintext like User.email. */
  email: string;
  /** Encrypted at rest. */
  phone?: string;
  locale: "fr" | "en";
  service: DirectRequestService;
  modality: WaitlistModality;
  motifs: string[];
  preferredPeriods: WaitlistPeriod[];
  preferredDays: WaitlistWeekday[];
  consent: { at: Date; version: string; ip?: string };
  smsConsent: { given: boolean; at?: Date; version?: string };
  status: WaitlistStatus;
  /** True while active or offered — the key of the one-open-entry-per-email index. */
  isOpen: boolean;
  offers: IWaitlistOffer[];
  missedOffers: number;
  removedReason?: WaitlistRemovalReason;
  leaveTokenHash?: string;
  /** The entry leaves the list after this, if still waiting. */
  expiresAt: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WaitlistOfferSchema = new Schema<IWaitlistOffer>({
  dayKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  time: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  startsAt: { type: Date, required: true },
  durationMinutes: { type: Number, required: true },
  holdId: { type: Schema.Types.ObjectId, required: true },
  tokenHash: { type: String, required: true },
  sentAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  channels: [{ type: String, enum: ["email", "sms"] }],
  outcome: { type: String, enum: WAITLIST_OFFER_OUTCOMES, required: true },
  claimingAt: Date,
  appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
});

const WaitlistEntrySchema = new Schema<IWaitlistEntry>(
  {
    professionalId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    showcaseSlug: { type: String, required: true },
    cityKey: { type: String, required: true },
    professionalName: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    firstName: { type: String, required: true, maxlength: 60 },
    lastName: { type: String, required: true, maxlength: 60 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String },
    locale: { type: String, enum: ["fr", "en"], default: "fr" },
    service: { type: String, enum: DIRECT_REQUEST_SERVICES, required: true },
    modality: { type: String, enum: WAITLIST_MODALITIES, required: true },
    motifs: [{ type: String, maxlength: 120 }],
    preferredPeriods: [{ type: String, enum: WAITLIST_PERIODS }],
    preferredDays: [{ type: String, enum: WAITLIST_WEEKDAYS }],
    consent: {
      type: new Schema(
        { at: { type: Date, required: true }, version: { type: String, required: true }, ip: String },
        { _id: false },
      ),
      required: true,
    },
    smsConsent: {
      type: new Schema({ given: { type: Boolean, default: false }, at: Date, version: String }, { _id: false }),
      default: () => ({ given: false }),
    },
    status: { type: String, enum: WAITLIST_STATUSES, required: true },
    isOpen: { type: Boolean, required: true },
    offers: { type: [WaitlistOfferSchema], default: [] },
    missedOffers: { type: Number, default: 0 },
    removedReason: { type: String, enum: WAITLIST_REMOVAL_REASONS },
    leaveTokenHash: { type: String },
    expiresAt: { type: Date, required: true },
    closedAt: Date,
  },
  { timestamps: true },
);

// One open entry per person per professional; closed entries do not count.
WaitlistEntrySchema.index(
  { professionalId: 1, email: 1 },
  { unique: true, partialFilterExpression: { isOpen: true }, name: "one_open_entry_per_email" },
);
WaitlistEntrySchema.index({ professionalId: 1, status: 1, createdAt: 1 });
WaitlistEntrySchema.index({ "offers.tokenHash": 1 });
WaitlistEntrySchema.index({ status: 1, "offers.expiresAt": 1 });
WaitlistEntrySchema.index({ leaveTokenHash: 1 }, { sparse: true });
WaitlistEntrySchema.index({ isOpen: 1, expiresAt: 1 });
WaitlistEntrySchema.index({ isOpen: 1, closedAt: 1 });

attachContactStringEncryption(WaitlistEntrySchema, ["phone"]);

const WaitlistEntry: Model<IWaitlistEntry> =
  (mongoose.models.WaitlistEntry as Model<IWaitlistEntry> | undefined) ||
  mongoose.model<IWaitlistEntry>("WaitlistEntry", WaitlistEntrySchema);

export default WaitlistEntry;

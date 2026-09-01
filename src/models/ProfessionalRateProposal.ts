import mongoose, { Schema, Document, Model } from "mongoose";
import { THERAPY_TYPES } from "@/lib/professional-pricing";

/**
 * A professional's request to change their own rate.
 *
 * Pricing is admin-controlled — `pricing`/`rates` are not in the
 * `PUT /api/profile` allowlist — so a professional cannot change what they are
 * paid. This is how they ask. Submitting changes nothing: the live rate in
 * `Profile.rates` stands until an admin accepts, and accepting only affects
 * future bookings (existing appointments are re-priced separately and
 * deliberately).
 *
 * A separate collection rather than a field on `Profile` so the history is an
 * audit trail — who asked for what, when, and who decided.
 */
export type RateProposalStatus = "pending" | "accepted" | "rejected";

export interface IProfessionalRateProposal extends Document {
  /** The professional making the request (User id). */
  professionalId: mongoose.Types.ObjectId;
  therapyType: "solo" | "couple" | "group";
  /** The rate they are asking for. */
  proposedRate: number;
  /** Their rate at the moment of submission, for context in the admin queue. */
  currentRate?: number;
  /** Optional justification from the professional. */
  note?: string;
  status: RateProposalStatus;
  /** Admin who decided (User id). */
  decidedBy?: mongoose.Types.ObjectId;
  decidedAt?: Date;
  /** Optional reason shown to the professional on rejection. */
  decisionNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProfessionalRateProposalSchema = new Schema<IProfessionalRateProposal>(
  {
    professionalId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    therapyType: {
      type: String,
      enum: [...THERAPY_TYPES],
      required: true,
    },
    proposedRate: { type: Number, required: true, min: 0 },
    currentRate: { type: Number },
    note: { type: String, maxlength: 1000 },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      required: true,
    },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    decisionNote: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
);

// The admin queue reads pending proposals oldest-first.
ProfessionalRateProposalSchema.index({ status: 1, createdAt: 1 });
// A professional may have at most ONE pending proposal per therapy type —
// otherwise a pro could queue a dozen requests and an admin accepting the wrong
// one would silently change what they are paid.
ProfessionalRateProposalSchema.index(
  { professionalId: 1, therapyType: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);

const ProfessionalRateProposal: Model<IProfessionalRateProposal> =
  mongoose.models.ProfessionalRateProposal ||
  mongoose.model<IProfessionalRateProposal>(
    "ProfessionalRateProposal",
    ProfessionalRateProposalSchema,
  );

export default ProfessionalRateProposal;

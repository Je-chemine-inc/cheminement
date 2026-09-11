import mongoose, { Schema, Document, Model } from "mongoose";

/** Ligne du grand livre : crédit (séance) ou débit (versement plateforme → pro). */
export interface IProfessionalLedgerEntry extends Document {
  professionalId: mongoose.Types.ObjectId;
  entryKind: "credit" | "debit";
  /** Regroupement bihebdomadaire (affichage solde / historique). */
  cycleKey: string;
  appointmentId?: mongoose.Types.ObjectId;
  sessionActNature?: string;
  grossAmountCad: number;
  platformFeeCad: number;
  netToProfessionalCad: number;
  paymentChannel: "stripe" | "transfer" | "none" | "organization";
  /** Spec 002: what each side was billed when an organization paid part or all. */
  clientAmountCad?: number;
  orgAmountCad?: number;
  /** Set on an ADJUSTMENT row (no appointmentId: that one is unique per credit). */
  adjustsAppointmentId?: mongoose.Types.ObjectId;
  note?: string;
  /** Débit : montant versé au professionnel. */
  payoutAmountCad?: number;
  payoutReference?: string;
  payoutNotes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const ProfessionalLedgerEntrySchema = new Schema<IProfessionalLedgerEntry>(
  {
    professionalId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    entryKind: {
      type: String,
      enum: ["credit", "debit"],
      default: "credit",
      index: true,
    },
    cycleKey: {
      type: String,
      index: true,
    },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      sparse: true,
      unique: true,
    },
    sessionActNature: String,
    grossAmountCad: { type: Number, default: 0 },
    platformFeeCad: { type: Number, default: 0 },
    netToProfessionalCad: { type: Number, default: 0 },
    paymentChannel: {
      type: String,
      enum: ["stripe", "transfer", "none", "organization"],
      default: "none",
    },
    clientAmountCad: Number,
    orgAmountCad: Number,
    adjustsAppointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      index: true,
    },
    note: String,
    payoutAmountCad: { type: Number },
    payoutReference: String,
    payoutNotes: String,
  },
  { timestamps: true },
);

ProfessionalLedgerEntrySchema.index({ professionalId: 1, createdAt: -1 });
ProfessionalLedgerEntrySchema.index({ professionalId: 1, cycleKey: 1 });

const ProfessionalLedgerEntry: Model<IProfessionalLedgerEntry> =
  mongoose.models.ProfessionalLedgerEntry ||
  mongoose.model<IProfessionalLedgerEntry>(
    "ProfessionalLedgerEntry",
    ProfessionalLedgerEntrySchema,
  );

export default ProfessionalLedgerEntry;

import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * One organization's authorization to pay for one patient's sessions (spec 002).
 *
 * Looked up at session closure from (clientId, beneficiaryKey) — never pinned on
 * appointments — so the ~6 appointment-creation paths need no change.
 *
 * `beneficiaryKey` separates the people one account books for: "self", or
 * `loved-one:<normalized name>` for a relative booked through the guardian's
 * account, so a parent's own sessions are never billed to a child's PAE.
 *
 * The session cap (`maxSessions`) is enforced by an atomic `$addToSet` on
 * `consumedAppointmentIds` — see src/lib/organization-coverage.ts. It is a set
 * of appointment ids, not a counter, so a closure retry can never count twice.
 */

export const COVERAGE_MODES = ["full", "split", "per_session", "external"] as const;
export type CoverageModeValue = (typeof COVERAGE_MODES)[number];

export const COVERAGE_STATUSES = ["active", "exhausted", "ended"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const CONSENT_METHODS = [
  "online_checkbox",
  "written",
  "verbal",
  "form_on_file",
] as const;

/** Bump when the consent wording shown to clients changes (Loi 25 audit trail). */
export const ORG_BILLING_CONSENT_VERSION = "org-billing-2026-09";

export interface ICoverageSplit {
  type: "fixed" | "percent";
  /** Cents when fixed; 1–100 when percent. */
  value: number;
}

export interface ICoverageConsent {
  status: "none" | "given" | "withdrawn";
  recordedAt?: Date;
  source?: "client_booking" | "admin_recorded";
  recordedBy?: mongoose.Types.ObjectId;
  method?: (typeof CONSENT_METHODS)[number];
  textVersion?: string;
  note?: string;
  withdrawnAt?: Date;
}

export interface IOrganizationCoverage extends Document {
  clientId: mongoose.Types.ObjectId;
  beneficiaryKey: string;
  beneficiaryName?: string;
  organizationId: mongoose.Types.ObjectId;
  caseNumber?: string;
  mode: CoverageModeValue;
  split?: ICoverageSplit;
  maxSessions?: number;
  consumedAppointmentIds: mongoose.Types.ObjectId[];
  rateCentsOverride?: number;
  validFrom?: Date;
  validUntil?: Date;
  status: CoverageStatus;
  endedAt?: Date;
  endReason?: string;
  exhaustedNotifiedAt?: Date;
  lastSessionWarningSentAt?: Date;
  consent: ICoverageConsent;
  sourceAppointmentId?: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SplitSchema = new Schema<ICoverageSplit>(
  {
    type: { type: String, enum: ["fixed", "percent"], required: true },
    value: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ConsentSchema = new Schema<ICoverageConsent>(
  {
    status: {
      type: String,
      enum: ["none", "given", "withdrawn"],
      default: "none",
    },
    recordedAt: Date,
    source: { type: String, enum: ["client_booking", "admin_recorded"] },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
    method: { type: String, enum: CONSENT_METHODS },
    textVersion: String,
    note: { type: String, maxlength: 2000 },
    withdrawnAt: Date,
  },
  { _id: false },
);

const OrganizationCoverageSchema = new Schema<IOrganizationCoverage>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    beneficiaryKey: { type: String, required: true, default: "self", trim: true },
    beneficiaryName: { type: String, trim: true, maxlength: 160 },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    caseNumber: { type: String, trim: true, maxlength: 60 },
    mode: { type: String, enum: COVERAGE_MODES, required: true, default: "full" },
    split: { type: SplitSchema, required: false },
    maxSessions: {
      type: Number,
      min: 1,
      validate: {
        validator: (v: number | undefined | null) =>
          v === undefined || v === null || Number.isInteger(v),
        message: "maxSessions must be a whole number",
      },
    },
    consumedAppointmentIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Appointment" }],
      default: [],
    },
    rateCentsOverride: { type: Number, min: 0 },
    validFrom: Date,
    validUntil: Date,
    status: { type: String, enum: COVERAGE_STATUSES, default: "active" },
    endedAt: Date,
    endReason: { type: String, maxlength: 500 },
    exhaustedNotifiedAt: Date,
    lastSessionWarningSentAt: Date,
    consent: { type: ConsentSchema, default: () => ({ status: "none" }) },
    sourceAppointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// At most ONE active coverage per person. Equality-only partial filter, which
// every MongoDB version supports. Exhausted / ended coverages don't count, so a
// renewal can be created once the previous one has run out.
OrganizationCoverageSchema.index(
  { clientId: 1, beneficiaryKey: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);
OrganizationCoverageSchema.index({ organizationId: 1, status: 1 });

const OrganizationCoverage: Model<IOrganizationCoverage> =
  mongoose.models.OrganizationCoverage ||
  mongoose.model<IOrganizationCoverage>(
    "OrganizationCoverage",
    OrganizationCoverageSchema,
  );

export default OrganizationCoverage;

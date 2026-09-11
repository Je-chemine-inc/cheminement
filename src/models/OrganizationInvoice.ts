import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * An invoice to an organization: one session, or a periodic statement grouping
 * several (spec 002). Separate from Appointment.payment, which stays the
 * client's account.
 *
 * `lines` are a SNAPSHOT frozen when the invoice is sent — a sent document never
 * changes because a professional later edits their title. They carry only what
 * the owner approved for disclosure: patient name, the organization's case
 * number, the professional's name/title/licence, date, duration and amount.
 * Never the motif, the nature of the act, or the therapy type (Loi 25).
 *
 * `number` is allocated at SEND time (series JCO-YYYY-…), so discarded drafts
 * never burn one. `sendLog` is the record of every disclosure.
 *
 * Unique optional fields use partial indexes on `$type: "string"`, not `sparse`:
 * a sparse index still indexes an explicit `null`, and two nulls collide.
 */

export const ORGANIZATION_INVOICE_STATUSES = [
  "draft",
  "issuing",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "refunded",
] as const;
export type OrganizationInvoiceStatus =
  (typeof ORGANIZATION_INVOICE_STATUSES)[number];

export const ORGANIZATION_PAYMENT_METHODS = [
  "card",
  "interac",
  "cheque",
  "eft",
  "portal",
  "other",
] as const;

export interface IOrganizationInvoiceLine {
  appointmentId: mongoose.Types.ObjectId;
  coverageId?: mongoose.Types.ObjectId;
  sessionDate: Date;
  patientFullName: string;
  caseNumber?: string;
  professionalName: string;
  professionalTitle?: string;
  professionalLicence?: string;
  durationMinutes?: number;
  amountCents: number;
}

export interface IOrganizationInvoicePayment {
  amountCents: number;
  method: (typeof ORGANIZATION_PAYMENT_METHODS)[number];
  reference?: string;
  receivedAt: Date;
  source: "stripe" | "interac_reconciler" | "admin";
  /** Stripe intent id, Interac transfer id… — makes a replayed settlement a no-op. */
  externalRef?: string;
  /** Card payments only: how much of it Stripe has refunded so far (cents). */
  refundedCents?: number;
  recordedBy?: mongoose.Types.ObjectId;
}

/**
 * Something about the money on this invoice a person should look at: an
 * overpayment, money received on a void invoice, a refund, a chargeback.
 * Recorded as it happens; the admin is emailed each time.
 */
export interface IOrganizationInvoicePaymentEvent {
  at: Date;
  kind: "overpaid" | "not_payable" | "refund" | "dispute";
  detail: string;
}

export interface IOrganizationInvoiceSendLogEntry {
  at: Date;
  to: string[];
  byUserId?: mongoose.Types.ObjectId;
  kind: "sent" | "resent" | "reminder" | "payment_received";
}

export interface IOrganizationInvoice extends Document {
  kind: "session" | "statement";
  organizationId: mongoose.Types.ObjectId;
  draftKey: string;
  number?: string;
  periodKey?: string;
  periodStart?: Date;
  periodEnd?: Date;
  status: OrganizationInvoiceStatus;
  lines: IOrganizationInvoiceLine[];
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  billTo?: {
    name: string;
    emails: string[];
    contactName?: string;
    addressLines?: string[];
  };
  issuedAt?: Date;
  dueAt?: Date;
  paymentTermsDays?: number;
  /**
   * The organization's pay link (/org-pay?token=…), minted when the invoice is
   * issued. Good for as long as the invoice is awaiting payment; the page shows
   * no patient's name. `payTokenExpiresAt` is not used.
   */
  payToken?: string;
  payTokenExpiresAt?: Date;
  /** The latest card payment started from the pay link. */
  stripePaymentIntentId?: string;
  /**
   * Not used: an organization writes the invoice NUMBER (JCO-…) on an Interac
   * transfer — the reference the PDF already asks for — so there is one
   * reference per invoice, not two.
   */
  interacReferenceCode?: string;
  payments: IOrganizationInvoicePayment[];
  reminders?: {
    dueSentAt?: Date;
    followUpSentAt?: Date;
    overdueAlertSentAt?: Date;
  };
  reviewAlertSentAt?: Date;
  paymentEvents: IOrganizationInvoicePaymentEvent[];
  sendLog: IOrganizationInvoiceSendLogEntry[];
  internalNotes?: string;
  printedNote?: string;
  attachmentFileId?: mongoose.Types.ObjectId;
  voidedAt?: Date;
  voidedBy?: mongoose.Types.ObjectId;
  voidReason?: string;
  disputed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LineSchema = new Schema<IOrganizationInvoiceLine>(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment", required: true },
    coverageId: { type: Schema.Types.ObjectId, ref: "OrganizationCoverage" },
    sessionDate: { type: Date, required: true },
    patientFullName: { type: String, required: true },
    caseNumber: String,
    professionalName: { type: String, required: true },
    professionalTitle: String,
    professionalLicence: String,
    durationMinutes: Number,
    amountCents: { type: Number, required: true, min: 0 },
  },
  { _id: false, strict: "throw" },
);

const PaymentSchema = new Schema<IOrganizationInvoicePayment>(
  {
    amountCents: { type: Number, required: true },
    method: { type: String, enum: ORGANIZATION_PAYMENT_METHODS, required: true },
    reference: String,
    receivedAt: { type: Date, required: true },
    source: {
      type: String,
      enum: ["stripe", "interac_reconciler", "admin"],
      required: true,
    },
    externalRef: String,
    refundedCents: { type: Number, min: 0 },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const PaymentEventSchema = new Schema<IOrganizationInvoicePaymentEvent>(
  {
    at: { type: Date, required: true },
    kind: {
      type: String,
      enum: ["overpaid", "not_payable", "refund", "dispute"],
      required: true,
    },
    detail: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const SendLogSchema = new Schema<IOrganizationInvoiceSendLogEntry>(
  {
    at: { type: Date, required: true },
    to: { type: [String], default: [] },
    byUserId: { type: Schema.Types.ObjectId, ref: "User" },
    kind: {
      type: String,
      enum: ["sent", "resent", "reminder", "payment_received"],
      required: true,
    },
  },
  { _id: false },
);

const OrganizationInvoiceSchema = new Schema<IOrganizationInvoice>(
  {
    kind: { type: String, enum: ["session", "statement"], required: true },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    draftKey: { type: String, required: true },
    number: String,
    periodKey: String,
    periodStart: Date,
    periodEnd: Date,
    status: {
      type: String,
      enum: ORGANIZATION_INVOICE_STATUSES,
      default: "draft",
    },
    // `strict: "throw"` on the line schema: a stray field (a motif, an act) is
    // an error, not silently dropped — the allow-list is enforced at write time.
    lines: { type: [LineSchema], default: [] },
    totalCents: { type: Number, default: 0, min: 0 },
    paidCents: { type: Number, default: 0 },
    balanceCents: { type: Number, default: 0 },
    billTo: {
      name: String,
      emails: [String],
      contactName: String,
      addressLines: [String],
    },
    issuedAt: Date,
    dueAt: Date,
    paymentTermsDays: Number,
    payToken: String,
    payTokenExpiresAt: Date,
    stripePaymentIntentId: String,
    interacReferenceCode: String,
    payments: { type: [PaymentSchema], default: [] },
    reminders: {
      dueSentAt: Date,
      followUpSentAt: Date,
      overdueAlertSentAt: Date,
    },
    reviewAlertSentAt: Date,
    paymentEvents: { type: [PaymentEventSchema], default: [] },
    sendLog: { type: [SendLogSchema], default: [] },
    internalNotes: { type: String, maxlength: 4000 },
    printedNote: { type: String, maxlength: 1000 },
    attachmentFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    voidedAt: Date,
    voidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    voidReason: { type: String, maxlength: 500 },
    disputed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const whenString = (field: string) => ({
  unique: true,
  partialFilterExpression: { [field]: { $type: "string" } },
});
OrganizationInvoiceSchema.index({ draftKey: 1 }, { unique: true });
OrganizationInvoiceSchema.index({ number: 1 }, whenString("number"));
OrganizationInvoiceSchema.index({ payToken: 1 }, whenString("payToken"));
OrganizationInvoiceSchema.index(
  { stripePaymentIntentId: 1 },
  whenString("stripePaymentIntentId"),
);
OrganizationInvoiceSchema.index(
  { interacReferenceCode: 1 },
  whenString("interacReferenceCode"),
);
// Refund and dispute webhooks find the invoice by the card payment's intent id.
OrganizationInvoiceSchema.index({ "payments.externalRef": 1 });
OrganizationInvoiceSchema.index({ organizationId: 1, status: 1, issuedAt: -1 });
OrganizationInvoiceSchema.index({ status: 1, dueAt: 1 });

const OrganizationInvoice: Model<IOrganizationInvoice> =
  mongoose.models.OrganizationInvoice ||
  mongoose.model<IOrganizationInvoice>(
    "OrganizationInvoice",
    OrganizationInvoiceSchema,
  );

export default OrganizationInvoice;

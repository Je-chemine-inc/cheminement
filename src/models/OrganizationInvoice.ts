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
  /**
   * The row's own id, so a refund can name it. Set explicitly when the row is
   * written — never a schema default, which would invent a different id each
   * time a row without one is loaded.
   */
  paymentId?: mongoose.Types.ObjectId;
  amountCents: number;
  method: (typeof ORGANIZATION_PAYMENT_METHODS)[number];
  reference?: string;
  receivedAt: Date;
  source: "stripe" | "interac_reconciler" | "admin";
  /** Stripe intent id, Interac transfer id… — makes a replayed settlement a no-op. */
  externalRef?: string;
  /**
   * How much of it went back (cents): Stripe's cumulative refunded amount for a
   * Stripe payment, the sum of the refunds recorded by hand otherwise.
   */
  refundedCents?: number;
  recordedBy?: mongoose.Types.ObjectId;
}

/**
 * A refund an admin made from the invoice screen (organization billing).
 * Through Stripe for a Stripe payment; recorded by hand ("outside") for
 * Interac, cheque, EFT. `creditCents` is the part the organization no longer
 * owes (« plus dû »); the rest, when there is a rest, is owed again
 * (« toujours dû »). The part that only returned an overpayment is neither.
 */
export interface IOrganizationInvoiceRefund {
  refundId: mongoose.Types.ObjectId;
  paymentId: mongoose.Types.ObjectId;
  amountCents: number;
  creditCents: number;
  /** Absent when there was no choice to make (overpayment, void invoice). */
  owed?: "still" | "no_longer";
  via: "stripe" | "outside";
  /** How the money went back, for a refund made outside the platform. */
  method?: "interac" | "cheque" | "eft" | "other";
  reference?: string;
  /** Internal: why. Never sent to the organization. */
  reason: string;
  /**
   * requested — written before Stripe is asked, so a crash leaves a trace;
   * pending — Stripe accepted it, the money is on its way (bank debits);
   * succeeded / failed — final (a card refund can still fail after success).
   */
  status: "requested" | "pending" | "succeeded" | "failed";
  failureReason?: string;
  /** From the admin's dialog: the same click twice refunds once. */
  requestKey: string;
  stripeRefundId?: string;
  refundedAt: Date;
  at: Date;
  byUserId: mongoose.Types.ObjectId;
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

/**
 * The organization's own claim form (spec 002, phase 7): one PDF the admin
 * filled in by hand, sent with the invoice. `linesFingerprint` is the lines as
 * they were when it was attached — if they change, the form no longer matches
 * and sending is refused until it is attached again. The file is a
 * StoredFile of kind "organization-form", never served by /api/files.
 */
export interface IOrganizationInvoiceAttachment {
  fileId: mongoose.Types.ObjectId;
  /** The uploaded name, for the admin screens only — never emailed. */
  fileName: string;
  size: number;
  sha256: string;
  scanStatus: "clean" | "skipped";
  linesFingerprint: string;
  uploadedAt: Date;
  /** Who attached it — and confirmed it holds no reason for consultation. */
  uploadedBy?: mongoose.Types.ObjectId;
}

export interface IOrganizationInvoiceSendLogEntry {
  at: Date;
  to: string[];
  byUserId?: mongoose.Types.ObjectId;
  kind: "sent" | "resent" | "reminder" | "payment_received" | "refund_notice";
  /** The organization's form as it went out, under its outgoing name. */
  attachment?: {
    fileId: mongoose.Types.ObjectId;
    fileName: string;
    size: number;
    sha256: string;
  };
  /** Sent without the form the organization requires: an admin's decision. */
  withoutOwnForm?: boolean;
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
  /**
   * What the organization no longer owes after refunds marked « plus dû ».
   * Always recomputed from `refunds`, never incremented. The single rule:
   * balanceCents = totalCents − creditedCents − paidCents.
   */
  creditedCents: number;
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
  refunds: IOrganizationInvoiceRefund[];
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
  attachment?: IOrganizationInvoiceAttachment;
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
    // No default: see the interface.
    paymentId: { type: Schema.Types.ObjectId },
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

const RefundSchema = new Schema<IOrganizationInvoiceRefund>(
  {
    refundId: { type: Schema.Types.ObjectId, required: true },
    paymentId: { type: Schema.Types.ObjectId, required: true },
    amountCents: { type: Number, required: true, min: 1 },
    creditCents: { type: Number, required: true, min: 0 },
    owed: { type: String, enum: ["still", "no_longer"] },
    via: { type: String, enum: ["stripe", "outside"], required: true },
    method: { type: String, enum: ["interac", "cheque", "eft", "other"] },
    reference: { type: String, maxlength: 120 },
    reason: { type: String, required: true, maxlength: 500 },
    status: {
      type: String,
      enum: ["requested", "pending", "succeeded", "failed"],
      required: true,
    },
    failureReason: { type: String, maxlength: 200 },
    requestKey: { type: String, required: true },
    stripeRefundId: String,
    refundedAt: { type: Date, required: true },
    at: { type: Date, required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
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

const AttachmentSchema = new Schema<IOrganizationInvoiceAttachment>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: "StoredFile", required: true },
    fileName: { type: String, required: true, maxlength: 200 },
    size: { type: Number, required: true, min: 0 },
    sha256: { type: String, required: true },
    scanStatus: { type: String, enum: ["clean", "skipped"], required: true },
    linesFingerprint: { type: String, required: true },
    uploadedAt: { type: Date, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const SentAttachmentSchema = new Schema(
  {
    fileId: { type: Schema.Types.ObjectId, ref: "StoredFile", required: true },
    fileName: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { _id: false },
);

// Strict like every schema here: a key missing below is dropped silently from
// a $push — which would erase the record of what went out.
const SendLogSchema = new Schema<IOrganizationInvoiceSendLogEntry>(
  {
    at: { type: Date, required: true },
    to: { type: [String], default: [] },
    byUserId: { type: Schema.Types.ObjectId, ref: "User" },
    kind: {
      type: String,
      enum: ["sent", "resent", "reminder", "payment_received", "refund_notice"],
      required: true,
    },
    attachment: { type: SentAttachmentSchema, default: undefined },
    withoutOwnForm: Boolean,
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
    creditedCents: { type: Number, default: 0, min: 0 },
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
    refunds: { type: [RefundSchema], default: [] },
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
    attachment: { type: AttachmentSchema, default: undefined },
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

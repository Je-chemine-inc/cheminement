import mongoose, { Schema, Document, Model } from "mongoose";

export type ExternalMessageSource =
  | "contact"
  | "school-manager"
  | "enterprise"
  | "compose"
  | "email";

export type ExternalMessageStatus = "new" | "read" | "archived";

export type ExternalMessageDirection = "inbound" | "outbound";

export interface IExternalMessage extends Document {
  source: ExternalMessageSource;
  /**
   * Message direction. "inbound" = received via a public form OR an inbound
   * email webhook. "outbound" = composed and sent by an admin (or as an
   * automated reply) from the platform.
   */
  direction: ExternalMessageDirection;
  /** Public-facing locale at submission time (UI language). */
  locale: "fr" | "en";
  senderName: string;
  senderEmail: string;
  senderPhone?: string;
  /** Destination email for outbound messages. Empty for inbound. */
  recipientEmail?: string;
  recipientName?: string;
  /** Admin who composed the outbound message. */
  sentBy?: mongoose.Types.ObjectId;
  sentAt?: Date;
  /** Free-text body of the message (always present). For inbound emails this is the stripped reply body when available, otherwise body-plain. */
  message: string;
  /** Original HTML body for inbound emails (sanitized client-side at render). */
  htmlBody?: string;
  /** Optional subject line — only set for forms that expose one, and always set for emails. */
  subject?: string;
  /**
   * Source-specific structured payload (school name, role, service type for
   * school managers; company / position / coordinates for enterprises;
   * email headers / spam-score for inbound emails; etc.).
   */
  metadata?: Record<string, string | undefined>;
  status: ExternalMessageStatus;
  /** Admin-only internal notes — never shown to the sender. */
  adminNotes?: string;
  readBy?: mongoose.Types.ObjectId;
  readAt?: Date;
  // ----- Email threading -----
  /** RFC Message-Id of THIS message, with angle brackets. Used to match future inbound replies. */
  emailMessageId?: string;
  /** RFC In-Reply-To header — Message-Id of the parent message this is a reply to. */
  emailInReplyTo?: string;
  /** Full References header chain (space-separated <id> tokens). */
  emailReferences?: string;
  /** Resolved parent ExternalMessage in the same thread (computed at insert time from emailInReplyTo). */
  parentMessageId?: mongoose.Types.ObjectId;
  /** Linked platform user if we matched the sender by email — speeds up admin triage. */
  userId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExternalMessageSchema = new Schema<IExternalMessage>(
  {
    source: {
      type: String,
      enum: ["contact", "school-manager", "enterprise", "compose", "email"],
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      default: "inbound",
      index: true,
    },
    locale: { type: String, enum: ["fr", "en"], default: "fr" },
    senderName: { type: String, required: true, trim: true },
    senderEmail: { type: String, required: true, trim: true, lowercase: true },
    senderPhone: { type: String, trim: true },
    recipientEmail: { type: String, trim: true, lowercase: true },
    recipientName: { type: String, trim: true },
    sentBy: { type: Schema.Types.ObjectId, ref: "User" },
    sentAt: { type: Date },
    message: { type: String, required: true },
    htmlBody: { type: String },
    subject: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: ["new", "read", "archived"],
      default: "new",
      index: true,
    },
    adminNotes: { type: String },
    readBy: { type: Schema.Types.ObjectId, ref: "User" },
    readAt: { type: Date },
    emailMessageId: { type: String, trim: true, index: true },
    emailInReplyTo: { type: String, trim: true, index: true },
    emailReferences: { type: String, trim: true },
    parentMessageId: {
      type: Schema.Types.ObjectId,
      ref: "ExternalMessage",
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  },
  { timestamps: true },
);

ExternalMessageSchema.index({ createdAt: -1 });

const ExternalMessage: Model<IExternalMessage> =
  mongoose.models.ExternalMessage ||
  mongoose.model<IExternalMessage>("ExternalMessage", ExternalMessageSchema);

export default ExternalMessage;

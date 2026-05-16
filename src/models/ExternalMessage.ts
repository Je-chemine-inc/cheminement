import mongoose, { Schema, Document, Model } from "mongoose";

export type ExternalMessageSource =
  | "contact"
  | "school-manager"
  | "enterprise"
  | "compose";

export type ExternalMessageStatus = "new" | "read" | "archived";

export type ExternalMessageDirection = "inbound" | "outbound";

export interface IExternalMessage extends Document {
  source: ExternalMessageSource;
  /**
   * Message direction. "inbound" = received via a public form (contact / school /
   * enterprise). "outbound" = composed and sent by an admin from the dashboard.
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
  /** Free-text body of the message (always present). */
  message: string;
  /** Optional subject line — only set for forms that expose one. */
  subject?: string;
  /**
   * Source-specific structured payload (school name, role, service type for
   * school managers; company / position / coordinates for enterprises; etc.).
   * Stored verbatim so the admin can see every captured field.
   */
  metadata?: Record<string, string | undefined>;
  status: ExternalMessageStatus;
  /** Admin-only internal notes — never shown to the sender. */
  adminNotes?: string;
  readBy?: mongoose.Types.ObjectId;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ExternalMessageSchema = new Schema<IExternalMessage>(
  {
    source: {
      type: String,
      enum: ["contact", "school-manager", "enterprise", "compose"],
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
  },
  { timestamps: true },
);

ExternalMessageSchema.index({ createdAt: -1 });

const ExternalMessage: Model<IExternalMessage> =
  mongoose.models.ExternalMessage ||
  mongoose.model<IExternalMessage>("ExternalMessage", ExternalMessageSchema);

export default ExternalMessage;

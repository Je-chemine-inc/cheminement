import mongoose, { Schema, Document, Model } from "mongoose";

export type ExternalMessageSource =
  | "contact"
  | "school-manager"
  | "enterprise";

export type ExternalMessageStatus = "new" | "read" | "archived";

export interface IExternalMessage extends Document {
  source: ExternalMessageSource;
  /** Public-facing locale at submission time (UI language). */
  locale: "fr" | "en";
  senderName: string;
  senderEmail: string;
  senderPhone?: string;
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
      enum: ["contact", "school-manager", "enterprise"],
      required: true,
      index: true,
    },
    locale: { type: String, enum: ["fr", "en"], default: "fr" },
    senderName: { type: String, required: true, trim: true },
    senderEmail: { type: String, required: true, trim: true, lowercase: true },
    senderPhone: { type: String, trim: true },
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

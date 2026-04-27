import mongoose, { Schema, Document, Model } from "mongoose";

export type AuthAuditAction =
  | "login_success"
  | "login_failed"
  | "login_blocked_unverified"
  | "login_blocked_rejected"
  | "logout"
  | "password_reset_requested"
  | "email_verified"
  | "phone_verified";

export interface IAuthAuditLog extends Document {
  email: string;
  userId?: mongoose.Types.ObjectId;
  action: AuthAuditAction;
  ip: string;
  userAgent: string;
  createdAt: Date;
}

const AuthAuditLogSchema = new Schema<IAuthAuditLog>(
  {
    email: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    action: {
      type: String,
      enum: [
        "login_success",
        "login_failed",
        "login_blocked_unverified",
        "login_blocked_rejected",
        "logout",
        "password_reset_requested",
        "email_verified",
        "phone_verified",
      ],
      required: true,
    },
    ip: { type: String, default: "unknown" },
    userAgent: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

AuthAuditLogSchema.index({ email: 1, createdAt: -1 });
AuthAuditLogSchema.index({ userId: 1, createdAt: -1 });
AuthAuditLogSchema.index({ action: 1, createdAt: -1 });

AuthAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 365 * 24 * 60 * 60 });

const AuthAuditLog: Model<IAuthAuditLog> =
  mongoose.models.AuthAuditLog ||
  mongoose.model<IAuthAuditLog>("AuthAuditLog", AuthAuditLogSchema);

export default AuthAuditLog;

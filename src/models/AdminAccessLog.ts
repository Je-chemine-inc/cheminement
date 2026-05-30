import mongoose, { Schema, Document, Model } from "mongoose";

export type AdminAccessLogAction =
  | "view_client_user"
  | "view_client_medical_profile"
  | "view_client_duplicates"
  | "merge_client_accounts";

export interface IAdminAccessLog extends Document {
  actorUserId: mongoose.Types.ObjectId;
  resourceUserId: mongoose.Types.ObjectId;
  action: AdminAccessLogAction;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const AdminAccessLogSchema = new Schema<IAdminAccessLog>(
  {
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    resourceUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: [
        "view_client_user",
        "view_client_medical_profile",
        "view_client_duplicates",
        "merge_client_accounts",
      ],
      required: true,
    },
    ip: { type: String },
    userAgent: { type: String, maxlength: 512 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AdminAccessLogSchema.index({ actorUserId: 1, createdAt: -1 });
AdminAccessLogSchema.index({ resourceUserId: 1, createdAt: -1 });

const AdminAccessLog: Model<IAdminAccessLog> =
  mongoose.models.AdminAccessLog ||
  mongoose.model<IAdminAccessLog>("AdminAccessLog", AdminAccessLogSchema);

export default AdminAccessLog;

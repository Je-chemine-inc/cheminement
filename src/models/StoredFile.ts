import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Generic binary-file storage. Used when Vercel's read-only serverless FS
 * makes writing to /public unsafe — instead, the bytes live in MongoDB and
 * are streamed back via GET /api/files/[id].
 *
 * Keep one model for every upload kind (patient documents, employee CVs,
 * referral attachments, client-shared documents) so callers all funnel
 * through the same auth, validation, and serving path.
 */
export interface IStoredFile extends Document {
  fileName: string;
  fileType: string;
  fileSize: number;
  data: Buffer;
  kind:
    | "patient-document"
    | "client-document"
    | "employee-cv"
    | "payout-cheque"
    | "content-image"
    | "referral"
    | "generic";
  uploadedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StoredFileSchema = new Schema<IStoredFile>(
  {
    fileName: { type: String, required: true, trim: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    data: { type: Buffer, required: true },
    kind: {
      type: String,
      enum: [
        "patient-document",
        "client-document",
        "employee-cv",
        "payout-cheque",
        "content-image",
        "referral",
        "generic",
      ],
      default: "generic",
      index: true,
    },
    // Optional: guest-booking referral uploads have no authenticated user.
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

StoredFileSchema.index({ uploadedBy: 1, createdAt: -1 });

const StoredFile: Model<IStoredFile> =
  mongoose.models.StoredFile ||
  mongoose.model<IStoredFile>("StoredFile", StoredFileSchema);

export default StoredFile;

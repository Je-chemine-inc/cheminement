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
  /**
   * Malware-scan verdict recorded at upload time:
   *  - "clean"    — scanned and cleared by the antivirus engine
   *  - "skipped"  — no scanner configured (CLOUDMERSIVE_API_KEY unset)
   *  - "error"    — scanner was unreachable; stored fail-open (re-scan candidate)
   *  - "infected" — never persisted (rejected at upload); reserved as a guard
   *  - "pending"  — default for legacy rows uploaded before scanning existed
   * The serving route refuses to stream anything marked "infected".
   */
  scanStatus?: "pending" | "clean" | "infected" | "skipped" | "error";
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
    scanStatus: {
      type: String,
      enum: ["pending", "clean", "infected", "skipped", "error"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true },
);

StoredFileSchema.index({ uploadedBy: 1, createdAt: -1 });

const StoredFile: Model<IStoredFile> =
  mongoose.models.StoredFile ||
  mongoose.model<IStoredFile>("StoredFile", StoredFileSchema);

export default StoredFile;

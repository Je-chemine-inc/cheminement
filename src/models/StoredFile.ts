import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Generic binary-file storage. Introduced when the old host's read-only FS
 * makes writing to /public unsafe — instead, the bytes live in MongoDB and
 * are streamed back via GET /api/files/[id].
 *
 * Keep one model for every upload kind (patient documents, employee CVs,
 * referral attachments, client-shared documents) so callers all funnel
 * through the same auth, validation, and serving path.
 */
/**
 * Kinds GET /api/files/[id] never serves, whoever asks: they have their own,
 * narrower route. An organization's claim form carries patient data and goes
 * only to billing admins (/api/admin/organization-invoices/[id]/attachment).
 */
export const PRIVATE_STORED_FILE_KINDS = ["organization-form", "product-file"] as const;

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
    | "organization-form"
    // A professional's photo for their showcase page (spec 003). Public only
    // once a published page shows it — see GET /api/files/[id].
    | "showcase-photo"
    // A professional's product (spec 003 phase 5): an image in its text, served
    // publicly like content images; and a PDF sold, served only to its buyers by
    // GET /api/products/[slug]/file.
    | "product-image"
    | "product-file"
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
        "organization-form",
        "showcase-photo",
        "product-image",
        "product-file",
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

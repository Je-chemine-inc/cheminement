import mongoose, { Schema, Document, Model } from "mongoose";

export type LegalDocumentKey = "terms" | "privacy" | "professionalTerms" | "cookies";
export type LegalDocumentLocale = "fr" | "en";

export interface ILegalDocument extends Document {
  documentKey: LegalDocumentKey;
  locale: LegalDocumentLocale;
  title: string;
  subtitle?: string;
  /** Displayed update date (e.g. "13 avril 2026" / "April 13, 2026"). */
  lastUpdated: string;
  /** Version string used for acceptance tracking (ISO date YYYY-MM-DD). */
  version: string;
  /** Full rich-text body as HTML. Section titles authored as h2. */
  contentHtml: string;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LegalDocumentSchema = new Schema<ILegalDocument>(
  {
    documentKey: {
      type: String,
      enum: ["terms", "privacy", "professionalTerms", "cookies"],
      required: true,
    },
    locale: {
      type: String,
      enum: ["fr", "en"],
      required: true,
    },
    title: { type: String, required: true },
    subtitle: String,
    lastUpdated: { type: String, required: true },
    version: { type: String, required: true },
    contentHtml: { type: String, required: true, default: "" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

LegalDocumentSchema.index(
  { documentKey: 1, locale: 1 },
  { unique: true },
);

const LegalDocument: Model<ILegalDocument> =
  mongoose.models.LegalDocument ||
  mongoose.model<ILegalDocument>("LegalDocument", LegalDocumentSchema);

export default LegalDocument;

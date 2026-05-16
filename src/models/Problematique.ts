import mongoose, { Schema, Document, Model } from "mongoose";

export type ProblematiqueLocale = "fr" | "en";
export type ProblematiqueStatus = "draft" | "published";

export interface IProblematique extends Document {
  /** URL slug, shared across locales (e.g. "depression", "anxiete"). */
  slug: string;
  locale: ProblematiqueLocale;
  title: string;
  /** Short blurb shown on the /book cards. */
  summary: string;
  /** Optional illustrative image/icon shown on the card and at the top of the public page. */
  iconUrl?: string;
  /** Full rich-text body as HTML (authored via Tiptap). */
  contentHtml: string;
  status: ProblematiqueStatus;
  /** Display order on the public listing (ascending). */
  sortOrder: number;
  updatedBy?: mongoose.Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProblematiqueSchema = new Schema<IProblematique>(
  {
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    },
    locale: {
      type: String,
      enum: ["fr", "en"],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    summary: { type: String, required: true, default: "" },
    iconUrl: { type: String },
    contentHtml: { type: String, required: true, default: "" },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      required: true,
    },
    sortOrder: { type: Number, default: 100 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: Date,
  },
  { timestamps: true },
);

ProblematiqueSchema.index({ slug: 1, locale: 1 }, { unique: true });
ProblematiqueSchema.index({ status: 1, sortOrder: 1 });

const Problematique: Model<IProblematique> =
  mongoose.models.Problematique ||
  mongoose.model<IProblematique>("Problematique", ProblematiqueSchema);

export default Problematique;

import mongoose, { Schema, Document, Model } from "mongoose";
import {
  CONTENT_KINDS,
  CONTENT_KIND_PUBLIC_BASE,
  type ContentKind,
  type ContentLocale,
  type ContentStatus,
} from "@/lib/content-kind";

export {
  CONTENT_KINDS,
  CONTENT_KIND_PUBLIC_BASE,
  type ContentKind,
  type ContentLocale,
  type ContentStatus,
};

export interface IContentEntry extends Document {
  kind: ContentKind;
  /** URL slug, shared across locales for the same entry. */
  slug: string;
  locale: ContentLocale;
  title: string;
  summary: string;
  iconUrl?: string;
  contentHtml: string;
  status: ContentStatus;
  /** Listing order (problematique + traitement). Ignored for nouveaute (date-sorted). */
  sortOrder: number;
  /** Set when status flips to "published". Used as the sort key for nouveaute. */
  publishedAt?: Date;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ContentEntrySchema = new Schema<IContentEntry>(
  {
    kind: {
      type: String,
      enum: CONTENT_KINDS,
      required: true,
    },
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
    summary: { type: String, default: "" },
    iconUrl: { type: String },
    contentHtml: { type: String, default: "" },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      required: true,
    },
    sortOrder: { type: Number, default: 100 },
    publishedAt: Date,
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ContentEntrySchema.index({ kind: 1, slug: 1, locale: 1 }, { unique: true });
ContentEntrySchema.index({ kind: 1, status: 1, sortOrder: 1 });
ContentEntrySchema.index({ kind: 1, status: 1, publishedAt: -1 });

const ContentEntry: Model<IContentEntry> =
  mongoose.models.ContentEntry ||
  mongoose.model<IContentEntry>("ContentEntry", ContentEntrySchema);

export default ContentEntry;

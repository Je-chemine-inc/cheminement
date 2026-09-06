import mongoose, { Schema, Document, Model } from "mongoose";
import {
  CONTENT_KINDS,
  CONTENT_KIND_PUBLIC_BASE,
  MEDIA_TYPES,
  type ContentKind,
  type ContentLocale,
  type ContentStatus,
  type MediaType,
} from "@/lib/content-kind";

export {
  CONTENT_KINDS,
  CONTENT_KIND_PUBLIC_BASE,
  type ContentKind,
  type ContentLocale,
  type ContentStatus,
  type MediaType,
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
  /** Only for kind "media": distinguishes articles, videos and podcasts. */
  mediaType?: MediaType;
  /**
   * External source: YouTube/Vimeo video, podcast feed, article link.
   *
   * For kind "media" this is mirrored across locales. For a premium
   * "resource" it is PER-LOCALE (a FR and an EN course video are different
   * assets) and it IS the paid good — strip it for anyone who has not bought,
   * exactly like contentHtml. See @/lib/content-premium.
   */
  mediaUrl?: string;
  /** Premium (paid) resource. Mirrored across locales — see the schema note. */
  isPremium: boolean;
  /** Price in INTEGER CENTS, CAD. Mirrored across locales. 0 when free. */
  priceCents: number;
  /** Per-locale public teaser shown on the paywall. Never a truncation of contentHtml. */
  previewHtml: string;
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
    mediaType: { type: String, enum: MEDIA_TYPES },
    mediaUrl: { type: String },
    // isPremium and priceCents are MIRRORED to both locale rows by the admin
    // write routes. They must never diverge: the entitlement is keyed on the
    // logical (kind, slug), so an FR-paid / EN-free entry would be a paywall
    // bypass via ?locale=en. previewHtml, being translated copy, is per-locale.
    isPremium: { type: Boolean, default: false },
    priceCents: { type: Number, default: 0, min: 0 },
    previewHtml: { type: String, default: "" },
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
// Splits the free grid from the premium grid on /book#resources.
ContentEntrySchema.index({ kind: 1, isPremium: 1, status: 1, sortOrder: 1 });

const ContentEntry: Model<IContentEntry> =
  mongoose.models.ContentEntry ||
  mongoose.model<IContentEntry>("ContentEntry", ContentEntrySchema);

export default ContentEntry;

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
import {
  PRODUCT_MODERATION_STATUSES,
  PRODUCT_TYPES,
  type ProductModerationStatus,
  type ProductType,
} from "@/lib/product-rules";

export {
  CONTENT_KINDS,
  CONTENT_KIND_PUBLIC_BASE,
  type ContentKind,
  type ContentLocale,
  type ContentStatus,
  type MediaType,
};

export interface IProductModeration {
  status: ProductModerationStatus;
  /** Bumped on every edit by the professional. */
  revision: number;
  /** The revision the team approved; below `revision`, a live product has changes to review. */
  approvedRevision?: number;
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  notes?: string;
  /** The professional attested they hold the rights to what they sell. */
  attestedAt?: Date;
  unpublishedBy?: "professional" | "admin";
  history: { at: Date; action: string; actor: "professional" | "admin"; notes?: string }[];
}

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
  /**
   * A training or digital product a professional sells (spec 003 phase 5).
   * Absent on the team's own content. For an owned row, `status` is written only
   * by syncProductLiveStatus (lib/products.ts): published while moderation is
   * approved and the professional's account is active. See lib/product-rules.ts.
   */
  ownerProfessionalId?: mongoose.Types.ObjectId;
  productType?: ProductType;
  /** The external product's own page. Mirrored; public. */
  externalUrl?: string;
  /** A PDF product's file (StoredFile kind "product-file"), per locale. The paid good. */
  productFileId?: mongoose.Types.ObjectId;
  /** When the webinar takes place. Mirrored; public. */
  webinar?: { startsAt?: Date; durationMinutes?: number };
  /** The webinar room and replay. Mirrored; paid — stripped like contentHtml. */
  webinarAccess?: { joinUrl?: string; replayUrl?: string };
  /** Also listed in the site's library on /book (never by default). Mirrored. */
  listInLibrary?: boolean;
  /** Mirrored across locales. */
  moderation?: IProductModeration;
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
    ownerProfessionalId: { type: Schema.Types.ObjectId, ref: "User" },
    productType: { type: String, enum: PRODUCT_TYPES },
    externalUrl: { type: String },
    productFileId: { type: Schema.Types.ObjectId },
    webinar: {
      type: new Schema({ startsAt: Date, durationMinutes: Number }, { _id: false }),
      required: false,
    },
    webinarAccess: {
      type: new Schema({ joinUrl: String, replayUrl: String }, { _id: false }),
      required: false,
    },
    listInLibrary: { type: Boolean },
    moderation: {
      type: new Schema(
        {
          status: { type: String, enum: PRODUCT_MODERATION_STATUSES, required: true },
          revision: { type: Number, default: 1 },
          approvedRevision: Number,
          submittedAt: Date,
          reviewedAt: Date,
          reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
          notes: { type: String, maxlength: 2000 },
          attestedAt: Date,
          unpublishedBy: { type: String, enum: ["professional", "admin"] },
          history: [
            new Schema(
              {
                at: { type: Date, required: true },
                action: { type: String, required: true },
                actor: { type: String, enum: ["professional", "admin"], required: true },
                notes: String,
              },
              { _id: false },
            ),
          ],
        },
        { _id: false },
      ),
      required: false,
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
// A professional's products, and the team's review queue (spec 003 phase 5).
ContentEntrySchema.index({ ownerProfessionalId: 1, locale: 1 }, { sparse: true });
ContentEntrySchema.index({ "moderation.status": 1, "moderation.submittedAt": 1 }, { sparse: true });

const ContentEntry: Model<IContentEntry> =
  mongoose.models.ContentEntry ||
  mongoose.model<IContentEntry>("ContentEntry", ContentEntrySchema);

export default ContentEntry;

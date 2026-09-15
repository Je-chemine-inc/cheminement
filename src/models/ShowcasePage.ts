import mongoose, { Schema, Document, Model } from "mongoose";
import {
  PROFESSIONAL_ORDER_CODES,
  SHOWCASE_REVIEW_STATES,
  SHOWCASE_STATUSES,
  type ProfessionalOrderCode,
  type ShowcaseActor,
  type ShowcaseReviewState,
  type ShowcaseStatus,
} from "@/lib/showcase-constants";

/**
 * A professional's showcase page (spec 003): psy<city>.jechemine.ca/<slug>.
 *
 * One per professional, created when an admin activates it. The editorial
 * content exists twice: `draft`, which an admin prepares, and `published`,
 * the copy the public sees — first set when an admin publishes, then edited
 * live by the professional (their saves write both copies). Identity facts (title, permit number, languages, modalities,
 * fees) are NOT copied here: the page reads them live from the profile, so it
 * never disagrees with what the platform bills.
 */

export interface ILocalizedText {
  fr: string;
  en: string;
}

/** A value (« Bienveillance »), with an optional short description. */
export interface IShowcaseValue extends ILocalizedText {
  details?: ILocalizedText;
}

/** A « Ce que j'accompagne » card. */
export interface IShowcaseFocusArea {
  title: ILocalizedText;
  body: ILocalizedText;
}

/** A method card in « Approche ». */
export interface IShowcaseMethod {
  name: ILocalizedText;
  title: ILocalizedText;
  body: ILocalizedText;
}

export interface IShowcaseContent {
  displayName: string;
  headline: ILocalizedText;
  intro: ILocalizedText;
  /** Plain text; paragraphs separated by a blank line. Never HTML. */
  bio: ILocalizedText;
  approach: ILocalizedText;
  values: IShowcaseValue[];
  /** One sentence the page quotes, signed with the display name. */
  quote: ILocalizedText;
  /** Short mentions under the introduction. */
  highlights: ILocalizedText[];
  /** « Parcours »: one line per degree, training or experience. */
  credentials: ILocalizedText[];
  focusAreas: IShowcaseFocusArea[];
  methods: IShowcaseMethod[];
  /** ProCatalogItem ids (category "expertise", offered on showcase pages). */
  expertiseIds: mongoose.Types.ObjectId[];
  orderCode?: ProfessionalOrderCode;
  /** The order's name when `orderCode` is "other". */
  orderLabel: string;
  insuranceNote: ILocalizedText;
  /** StoredFile of kind "showcase-photo". */
  photoFileId?: mongoose.Types.ObjectId;
  /**
   * The city the page asks to be on (registry key). Before the first
   * publication it moves the page at once; after, the page's `cityKey` changes
   * only when an admin approves this revision.
   */
  cityKey?: string;
}

export interface IShowcaseHistoryEntry {
  at: Date;
  actor: ShowcaseActor | "system";
  by?: mongoose.Types.ObjectId;
  action: string;
  note?: string;
}

export interface IShowcasePage extends Document {
  userId: mongoose.Types.ObjectId;
  slug: string;
  /** Former slugs, answered with a permanent redirect to the current page. */
  previousSlugs: string[];
  cityKey: string;
  status: ShowcaseStatus;
  review: {
    state: ShowcaseReviewState;
    submittedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: mongoose.Types.ObjectId;
    notes?: string;
  };
  draft: IShowcaseContent;
  /** +1 on every saved change; an approval names the revision it looked at. */
  draftRevision: number;
  draftUpdatedAt?: Date;
  draftUpdatedBy?: ShowcaseActor;
  published?: IShowcaseContent;
  publishedRevision?: number;
  publishedAt?: Date;
  publishedBy?: mongoose.Types.ObjectId;
  unpublishedAt?: Date;
  unpublishedBy?: ShowcaseActor;
  /** Offered on the page. Live settings: they apply without a new review. */
  services: { standard: boolean; quick: boolean };
  /**
   * The professional's agreement to publication (Loi 25), versioned. Since
   * 2026-09-14 an admin confirms it when publishing (`source` "admin",
   * `attestedBy`); older pages carry the professional's own acceptance.
   */
  consent?: {
    acceptedAt?: Date;
    version?: string;
    source?: ShowcaseActor;
    attestedBy?: mongoose.Types.ObjectId;
  };
  /** When the page was activated (the field keeps its first name). */
  invitedAt: Date;
  invitedBy?: mongoose.Types.ObjectId;
  /** Retired review flow: the last reminder sent. */
  remindedAt?: Date;
  /** The last « page changed by the professional » alert to the team. */
  changeAlertedAt?: Date;
  history: IShowcaseHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const LocalizedTextSchema = new Schema<ILocalizedText>(
  {
    fr: { type: String, trim: true, default: "" },
    en: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const localized = () => ({ type: LocalizedTextSchema, default: () => ({ fr: "", en: "" }) });

const ValueSchema = new Schema<IShowcaseValue>(
  {
    fr: { type: String, trim: true, default: "" },
    en: { type: String, trim: true, default: "" },
    details: { type: LocalizedTextSchema, default: undefined },
  },
  { _id: false },
);

const FocusAreaSchema = new Schema<IShowcaseFocusArea>({ title: localized(), body: localized() }, { _id: false });

const MethodSchema = new Schema<IShowcaseMethod>({ name: localized(), title: localized(), body: localized() }, { _id: false });

const ShowcaseContentSchema = new Schema<IShowcaseContent>(
  {
    displayName: { type: String, trim: true, default: "" },
    headline: localized(),
    intro: localized(),
    bio: localized(),
    approach: localized(),
    values: { type: [ValueSchema], default: [] },
    quote: localized(),
    highlights: { type: [LocalizedTextSchema], default: [] },
    credentials: { type: [LocalizedTextSchema], default: [] },
    focusAreas: { type: [FocusAreaSchema], default: [] },
    methods: { type: [MethodSchema], default: [] },
    expertiseIds: { type: [{ type: Schema.Types.ObjectId, ref: "ProCatalogItem" }], default: [] },
    orderCode: { type: String, enum: PROFESSIONAL_ORDER_CODES },
    orderLabel: { type: String, trim: true, default: "" },
    insuranceNote: localized(),
    photoFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    cityKey: { type: String, trim: true },
  },
  { _id: false },
);

const HistoryEntrySchema = new Schema<IShowcaseHistoryEntry>(
  {
    at: { type: Date, required: true },
    actor: { type: String, enum: ["professional", "admin", "system"], required: true },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const ShowcasePageSchema = new Schema<IShowcasePage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    },
    previousSlugs: { type: [String], default: [] },
    cityKey: { type: String, required: true, trim: true },
    status: { type: String, enum: SHOWCASE_STATUSES, default: "invited" },
    review: {
      state: { type: String, enum: SHOWCASE_REVIEW_STATES, default: "none" },
      submittedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
      notes: { type: String, trim: true },
    },
    draft: { type: ShowcaseContentSchema, default: () => ({}) },
    draftRevision: { type: Number, default: 0 },
    draftUpdatedAt: Date,
    draftUpdatedBy: { type: String, enum: ["professional", "admin"] },
    published: { type: ShowcaseContentSchema, default: undefined },
    publishedRevision: Number,
    publishedAt: Date,
    publishedBy: { type: Schema.Types.ObjectId, ref: "User" },
    unpublishedAt: Date,
    unpublishedBy: { type: String, enum: ["professional", "admin"] },
    services: {
      standard: { type: Boolean, default: true },
      quick: { type: Boolean, default: false },
    },
    consent: {
      acceptedAt: Date,
      version: String,
      source: { type: String, enum: ["professional", "admin"] },
      attestedBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    invitedAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
    remindedAt: Date,
    changeAlertedAt: Date,
    history: { type: [HistoryEntrySchema], default: [] },
  },
  { timestamps: true },
);

ShowcasePageSchema.index({ status: 1, cityKey: 1 });
ShowcasePageSchema.index({ previousSlugs: 1 });
ShowcasePageSchema.index({ "review.state": 1, "review.submittedAt": 1 });
ShowcasePageSchema.index({ "published.expertiseIds": 1, status: 1 });
ShowcasePageSchema.index({ "published.photoFileId": 1 }, { sparse: true });

const ShowcasePage: Model<IShowcasePage> =
  mongoose.models.ShowcasePage ||
  mongoose.model<IShowcasePage>("ShowcasePage", ShowcasePageSchema);

export default ShowcasePage;

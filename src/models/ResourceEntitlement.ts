import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * A purchase of a premium `ContentEntry` (kind "resource") — and the right to
 * read it.
 *
 * Keyed on the LOGICAL entry (`kind` + `slug`), never on a locale row's `_id`:
 * FR and EN are two documents sharing a slug, and buying the French version
 * must unlock the English one.
 *
 * Two kinds of buyer:
 *   - a member  -> `userId` set, access follows the session
 *   - a guest   -> `userId` ABSENT, access follows `accessToken` in an emailed link
 *
 * ⚠ Never write `userId: null` for a guest. The uniqueness guard below uses
 * `$exists: true`, which MATCHES null — one null row would collide against
 * every other guest purchase and break buying entirely. Omit the field.
 *
 * Deliberately NOT the dormant `ResourcePurchase` in models/Resource.ts: that
 * one requires a `Resource` FK (premium content has none), requires `userId`
 * (guests have none), stores float dollars and defaults currency to "usd".
 */

export type EntitlementStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

export const ENTITLEMENT_STATUSES: EntitlementStatus[] = [
  "pending",
  "paid",
  "failed",
  "cancelled",
  "refunded",
];

export interface IResourceEntitlement extends Document {
  /** Always "resource" today; a literal so a second premium kind is a schema change, not a silent widening. */
  kind: "resource";
  slug: string;

  /** Set for members. ABSENT (never null) for guests — see the note above. */
  userId?: mongoose.Types.ObjectId;
  buyerEmail: string;
  buyerName?: string;
  /** Language bought in: picks the email language and the locale row to serve. */
  locale: "fr" | "en";

  /** Guest bearer token, 64 hex chars. Unset on refund/dispute to kill the emailed link. */
  accessToken?: string;
  /** Left UNSET for a normal purchase — a bought good does not expire. Honoured if ever set. */
  accessTokenExpiry?: Date;

  /** INTEGER CENTS, snapshotted at purchase so a later price change cannot alter history. */
  amountCents: number;
  currency: string;
  status: EntitlementStatus;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  paidAt?: Date;
  failureReason?: string;
  refundedAt?: Date;
  refundedAmountCents?: number;
  disputed?: boolean;

  lastAccessedAt?: Date;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ResourceEntitlementSchema = new Schema<IResourceEntitlement>(
  {
    kind: { type: String, enum: ["resource"], required: true, default: "resource" },
    slug: { type: String, required: true, trim: true, lowercase: true },

    // No `default: null` anywhere on this field, on purpose.
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    buyerEmail: { type: String, required: true, trim: true, lowercase: true },
    buyerName: { type: String, trim: true },
    locale: { type: String, enum: ["fr", "en"], required: true, default: "fr" },

    accessToken: { type: String },
    accessTokenExpiry: { type: Date },

    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "cad", lowercase: true },
    status: {
      type: String,
      enum: ENTITLEMENT_STATUSES,
      default: "pending",
      required: true,
    },
    stripePaymentIntentId: { type: String },
    stripeCustomerId: { type: String },
    paidAt: { type: Date },
    failureReason: { type: String },
    refundedAt: { type: Date },
    refundedAmountCents: { type: Number },
    disputed: { type: Boolean, default: false },

    lastAccessedAt: { type: Date },
    accessCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// DOUBLE-GRANT GUARD 1 — one Stripe PaymentIntent backs at most one entitlement.
// This is the backstop that holds even if the application-level checks are bypassed.
ResourceEntitlementSchema.index(
  { stripePaymentIntentId: 1 },
  { unique: true, sparse: true },
);

// DOUBLE-GRANT GUARD 2 — a member holds at most one PAID entitlement per resource.
// Partial, so pending/failed/refunded rows may repeat (a refunded buyer may re-buy).
ResourceEntitlementSchema.index(
  { slug: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { userId: { $exists: true }, status: "paid" },
  },
);

// "has this email already bought it?" and the guest -> member merge lookup.
ResourceEntitlementSchema.index({ slug: 1, buyerEmail: 1, status: 1 });

// Guest token lookup. Always queried together with `slug` so a token for one
// resource cannot open another.
ResourceEntitlementSchema.index({ accessToken: 1 }, { unique: true, sparse: true });

// "my purchases" in the client dashboard.
ResourceEntitlementSchema.index({ userId: 1, createdAt: -1 });

// Admin revenue reporting.
ResourceEntitlementSchema.index({ status: 1, paidAt: -1 });

const ResourceEntitlement: Model<IResourceEntitlement> =
  mongoose.models.ResourceEntitlement ||
  mongoose.model<IResourceEntitlement>(
    "ResourceEntitlement",
    ResourceEntitlementSchema,
  );

export default ResourceEntitlement;

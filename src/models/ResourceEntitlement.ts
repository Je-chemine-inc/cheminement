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

  /**
   * A professional's product (spec 003 phase 5): who is credited, and the
   * commission as it stood at checkout — never read again from the settings,
   * so a later change cannot alter a sale. Absent on the team's resources.
   */
  ownerProfessionalId?: mongoose.Types.ObjectId;
  commissionBps?: number;
  productType?: string;
  /**
   * How taxes were handled at checkout. "added": TPS and TVQ were charged on
   * top of the price (the fields below say how much, at which rates, under
   * which numbers). "inclusive_untracked": a product bought while taxes were
   * off — nothing was added. Absent on the team's resources bought before
   * taxes existed.
   */
  taxTreatment?: "inclusive_untracked" | "added";
  /** The price before taxes, in cents. `amountCents` is what was charged: this plus TPS and TVQ. */
  subtotalCents?: number;
  tpsCents?: number;
  tvqCents?: number;
  tpsRatePercent?: number;
  tvqRatePercent?: number;
  tpsNumber?: string;
  tvqNumber?: string;
  /**
   * Webinar reminders sent for this purchase, as `<kind>:<start ISO>`
   * (webinarReminderKey). Each is claimed here before its email goes out, so
   * two runs never send it twice; the key carries the date, so a moved webinar
   * reminds again. Absent until the first reminder.
   */
  webinarRemindersSent?: string[];
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

    ownerProfessionalId: { type: Schema.Types.ObjectId, ref: "User" },
    commissionBps: { type: Number, min: 0, max: 10_000 },
    productType: { type: String },
    taxTreatment: { type: String, enum: ["inclusive_untracked", "added"] },
    subtotalCents: { type: Number, min: 0 },
    tpsCents: { type: Number, min: 0 },
    tvqCents: { type: Number, min: 0 },
    tpsRatePercent: { type: Number, min: 0, max: 20 },
    tvqRatePercent: { type: Number, min: 0, max: 20 },
    tpsNumber: { type: String, trim: true },
    tvqNumber: { type: String, trim: true },
    // No empty array by default: the team's resources never gain the key.
    webinarRemindersSent: { type: [String], default: undefined },
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

import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * A third party that pays for some patients' sessions: an employer, a PAE
 * (programme d'aide aux employés), a school, or another person (spec 002).
 *
 * Organizations never log in. Their terms here drive what `resolveSessionPayers`
 * bills them; the patients they cover are linked through OrganizationCoverage.
 */

export const ORGANIZATION_KINDS = [
  "employer",
  "eap",
  "school",
  "person",
  "other",
] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/** How the organization is invoiced: one invoice per session, or a monthly statement. */
export const ORGANIZATION_BILLING_CYCLES = ["per_session", "monthly"] as const;
export type OrganizationBillingCycle =
  (typeof ORGANIZATION_BILLING_CYCLES)[number];

/** Who covers the difference when the negotiated rate is below the session price. */
export const ORGANIZATION_GAP_POLICIES = [
  "client_copay",
  "clinic_absorbs_pro_full",
  "clinic_absorbs_pro_org_rate",
] as const;
export type OrganizationGapPolicy = (typeof ORGANIZATION_GAP_POLICIES)[number];

export const MAX_ORGANIZATION_BILLING_EMAILS = 5;

export interface IOrganizationAddress {
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
}

export interface IOrganization extends Document {
  name: string;
  kind: OrganizationKind;
  billingEmails: string[];
  contactName?: string;
  phone?: string;
  address?: IOrganizationAddress;
  /** Language of the documents and emails sent to the organization. */
  language: "fr" | "en";
  paymentTermsDays: number;
  billingCycle: OrganizationBillingCycle;
  /** Agreed price per session, in cents. Unset = the session's normal price. */
  negotiatedRateCents?: number;
  gapPolicy: OrganizationGapPolicy;
  /** Per-session invoices go out without review. Off by default (owner's rule). */
  autoSendPerSession: boolean;
  /** The organization wants its own proforma form filled in (done by hand for now). */
  requiresOwnForm: boolean;
  formNotes?: string;
  active: boolean;
  archivedAt?: Date;
  /** Created lazily when the organization first pays by card online. */
  stripeCustomerId?: string;
  internalNotes?: string;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AddressSchema = new Schema<IOrganizationAddress>(
  {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    province: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true, default: "Canada" },
  },
  { _id: false },
);

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: ORGANIZATION_KINDS, default: "eap" },
    billingEmails: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
      validate: [
        {
          validator: (v: string[]) => v.length <= MAX_ORGANIZATION_BILLING_EMAILS,
          message: `At most ${MAX_ORGANIZATION_BILLING_EMAILS} billing emails`,
        },
        {
          validator: (v: string[]) => v.every((e) => EMAIL_RE.test(e)),
          message: "Invalid billing email",
        },
      ],
    },
    contactName: { type: String, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 40 },
    address: { type: AddressSchema, required: false },
    language: { type: String, enum: ["fr", "en"], default: "fr" },
    paymentTermsDays: { type: Number, default: 30, min: 0, max: 180 },
    billingCycle: {
      type: String,
      enum: ORGANIZATION_BILLING_CYCLES,
      default: "per_session",
    },
    negotiatedRateCents: {
      type: Number,
      min: 0,
      validate: {
        validator: (v: number | undefined | null) =>
          v === undefined || v === null || Number.isInteger(v),
        message: "negotiatedRateCents must be whole cents",
      },
    },
    gapPolicy: {
      type: String,
      enum: ORGANIZATION_GAP_POLICIES,
      default: "client_copay",
    },
    autoSendPerSession: { type: Boolean, default: false },
    requiresOwnForm: { type: Boolean, default: false },
    formNotes: { type: String, maxlength: 2000 },
    active: { type: Boolean, default: true },
    archivedAt: Date,
    stripeCustomerId: String,
    internalNotes: { type: String, maxlength: 4000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

OrganizationSchema.index({ active: 1, name: 1 });

const Organization: Model<IOrganization> =
  mongoose.models.Organization ||
  mongoose.model<IOrganization>("Organization", OrganizationSchema);

export default Organization;

import mongoose, { Schema, Document, Model } from "mongoose";
import { attachContactStringEncryption } from "@/lib/mongoose-contact-encryption";

export interface IUser extends Document {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  role: "client" | "professional" | "admin" | "guest";
  isAdmin: boolean;
  adminId?: mongoose.Types.ObjectId; // Reference to Admin document if user is admin
  profile?: mongoose.Types.ObjectId; // Reference to Profile document
  phone?: string;
  language?: "fr" | "en" | "ar" | "es" | "zh" | "other";
  gender?: string;
  dateOfBirth?: Date;
  location?: string;
  status: "active" | "pending" | "inactive";
  emailVerified?: Date;
  /** Double validation compte : SMS après courriel (v1 = flux sécurisé public). */
  phoneVerifiedAt?: Date;
  accountSecurityVersion?: number;
  verificationEmailTokenHash?: string;
  verificationEmailExpires?: Date;
  phoneStepTokenHash?: string;
  phoneStepTokenExpires?: Date;
  verificationSmsCodeHash?: string;
  verificationSmsExpires?: Date;
  verificationSmsAttempts?: number;
  /**
   * Professionnel : revue permis (OPQ / ordre) avant activation complète par l’admin.
   */
  professionalLicenseStatus?:
    | "not_applicable"
    | "pending_review"
    | "verified"
    | "rejected";
  /** Consentement explicite à la politique de confidentialité (Loi 25), à l’inscription. */
  privacyPolicyAcceptedAt?: Date;
  /** Version de la politique de confidentialité acceptée (ex. "2026-04-13"). */
  privacyPolicyVersion?: string;
  /** Consentement aux conditions d’utilisation générales, à l’inscription. */
  termsAcceptedAt?: Date;
  /** Version des CG acceptées (ex. "2026-04-13"). */
  termsVersion?: string;
  /** Consentement aux conditions spécifiques professionnels (post-login, si mise à jour). */
  professionalTermsAcceptedAt?: Date;
  /** Version des conditions professionnelles acceptées (ex. "2026-04-13"). */
  professionalTermsVersion?: string;
  image?: string;
  stripeCustomerId?: string; // For clients to store payment methods
  /**
   * Garantie de paiement : none | pending_admin (Interac/entente — attente validation admin) | green.
   */
  paymentGuaranteeStatus?: "none" | "pending_admin" | "green";
  /** Origine du statut vert : carte/PAD Stripe ou entente Interac validée par l’admin. */
  paymentGuaranteeSource?: "stripe" | "interac_trust";
  stripeConnectAccountId?: string; // For professionals to receive payouts
  guardianId?: mongoose.Types.ObjectId; // Reference to parent/guardian User (for minors)
  accountManagerId?: mongoose.Types.ObjectId; // Alias for guardianId (same field, different name for clarity)
  managedAccounts?: mongoose.Types.ObjectId[]; // Array of User IDs that this user manages (for parents)
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: function (this: IUser) {
        return this.role !== "guest";
      },
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
    },
    role: {
      type: String,
      enum: ["client", "professional", "admin", "guest"],
      required: [true, "Role is required"],
      default: "client",
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    profile: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
    },
    phone: {
      type: String,
      trim: true,
    },
    language: {
      type: String,
      enum: ["fr", "en", "ar", "es", "zh", "other"],
      default: "en",
      trim: true,
    },
    gender: {
      type: String,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "pending", "inactive"],
      default: "pending",
    },
    emailVerified: Date,
    phoneVerifiedAt: Date,
    accountSecurityVersion: { type: Number, default: 0 },
    verificationEmailTokenHash: String,
    verificationEmailExpires: Date,
    phoneStepTokenHash: String,
    phoneStepTokenExpires: Date,
    verificationSmsCodeHash: String,
    verificationSmsExpires: Date,
    verificationSmsAttempts: { type: Number, default: 0 },
    professionalLicenseStatus: {
      type: String,
      enum: ["not_applicable", "pending_review", "verified", "rejected"],
      default: "not_applicable",
    },
    privacyPolicyAcceptedAt: Date,
    privacyPolicyVersion: String,
    termsAcceptedAt: Date,
    termsVersion: String,
    professionalTermsAcceptedAt: Date,
    professionalTermsVersion: String,
    image: String,
    stripeCustomerId: String, // For clients to store payment methods
    paymentGuaranteeStatus: {
      type: String,
      enum: ["none", "pending_admin", "green"],
      default: "none",
    },
    paymentGuaranteeSource: {
      type: String,
      enum: ["stripe", "interac_trust"],
    },
    stripeConnectAccountId: String, // For professionals to receive payouts
    guardianId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    }, // Reference to parent/guardian User (for minors)
    accountManagerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    }, // Alias for guardianId (same field, different name for clarity)
    managedAccounts: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ], // Array of User IDs that this user manages (for parents)
  },
  {
    timestamps: true,
  },
);

// Indexes for better query performance
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ isAdmin: 1 });
UserSchema.index({ adminId: 1 });
UserSchema.index({ guardianId: 1 });
UserSchema.index({ accountManagerId: 1 });
UserSchema.index({ managedAccounts: 1 });

attachContactStringEncryption(UserSchema, ["phone", "location"]);

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

export default User;

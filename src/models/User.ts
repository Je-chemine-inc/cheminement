import mongoose, { Schema, Document, Model } from "mongoose";
import { attachContactStringEncryption } from "@/lib/mongoose-contact-encryption";
import { phoneLookupHash, normalizeFullName } from "@/lib/contact-keys";

export interface IUser extends Document {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  role: "client" | "professional" | "admin" | "guest" | "prospect" | "employee";
  /** Postal address (employee/staff records — separate from `location` which is the city). */
  address?: string;
  /** Highest diploma / qualification (employee record). */
  diploma?: string;
  /** Free-text professional experience summary (employee record). */
  experience?: string;
  /** Stored URL of uploaded CV PDF/image (employee record). */
  cvDocumentUrl?: string;
  /** Original filename of the uploaded CV, shown in the admin UI. */
  cvDocumentName?: string;
  isAdmin: boolean;
  adminId?: mongoose.Types.ObjectId; // Reference to Admin document if user is admin
  profile?: mongoose.Types.ObjectId; // Reference to Profile document
  phone?: string;
  language?: "fr" | "en" | "ar" | "es" | "zh" | "other";
  gender?: string;
  dateOfBirth?: Date;
  location?: string;
  status: "active" | "pending" | "inactive";
  /**
   * Horodatage de la désactivation volontaire du compte par l'utilisateur
   * (libre-service, zone de danger des paramètres). Distingue un compte
   * `inactive` désactivé par son titulaire d'une coquille auto-provisionnée
   * jamais réclamée (qui, elle, n'a pas de `deactivatedAt`).
   */
  deactivatedAt?: Date;
  emailVerified?: Date;
  /** Double validation compte : SMS après courriel (v1 = flux sécurisé public). */
  phoneVerifiedAt?: Date;
  accountSecurityVersion?: number;
  verificationEmailTokenHash?: string;
  verificationEmailExpires?: Date;
  /** Admin-issued token so the user can set/reset their own password. */
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;
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
  /**
   * Professionnel : l'admin a approuvé le dossier. Devient `true` quand l'admin
   * clique "Valider" et déclenche l'envoi du lien d'activation 2FA. Le compte
   * passe à `status: "active"` uniquement quand `adminApproved && emailVerified
   * && phoneVerifiedAt`.
   */
  adminApproved?: boolean;
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
  /**
   * Mode de paiement choisi par le client (visible profil + admin).
   * Défaut implicite : "interac" si non défini.
   */
  preferredPaymentMethod?: "interac" | "card" | "direct_debit" | "payment_plan";
  stripeConnectAccountId?: string; // For professionals to receive payouts
  guardianId?: mongoose.Types.ObjectId; // Reference to parent/guardian User (for minors)
  accountManagerId?: mongoose.Types.ObjectId; // Alias for guardianId (same field, different name for clarity)
  managedAccounts?: mongoose.Types.ObjectId[]; // Array of User IDs that this user manages (for parents)
  /** HMAC of the normalized phone — queryable de-dup key (phone itself is encrypted at rest). */
  phoneLookupHash?: string;
  /** Lowercased/accent-stripped full name — weak de-dup key for admin review. */
  fullNameLookup?: string;
  /** Other accounts that may be the same person (admin review; never auto-merged). */
  possibleDuplicateOf?: mongoose.Types.ObjectId[];
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
        // Employee records may exist without login credentials until promoted
        // to admin (or a password is set later via the admin UI).
        return (
          this.role !== "guest" &&
          this.role !== "prospect" &&
          this.role !== "employee"
        );
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
      enum: [
        "client",
        "professional",
        "admin",
        "guest",
        "prospect",
        "employee",
      ],
      required: [true, "Role is required"],
      default: "client",
    },
    address: { type: String, trim: true },
    diploma: { type: String, trim: true },
    experience: { type: String, trim: true },
    cvDocumentUrl: { type: String, trim: true },
    cvDocumentName: { type: String, trim: true },
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
    deactivatedAt: Date,
    emailVerified: Date,
    phoneVerifiedAt: Date,
    accountSecurityVersion: { type: Number, default: 0 },
    verificationEmailTokenHash: String,
    verificationEmailExpires: Date,
    passwordResetTokenHash: String,
    passwordResetExpires: Date,
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
    adminApproved: { type: Boolean, default: false },
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
    preferredPaymentMethod: {
      type: String,
      enum: ["interac", "card", "direct_debit", "payment_plan"],
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
    phoneLookupHash: { type: String },
    fullNameLookup: { type: String },
    possibleDuplicateOf: [{ type: Schema.Types.ObjectId, ref: "User" }],
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
UserSchema.index({ phoneLookupHash: 1 }, { sparse: true });
UserSchema.index({ fullNameLookup: 1 });

// Maintain queryable de-dup keys. Registered BEFORE the contact-string
// encryption plugin so `phone` is still plaintext here (the encryption hook
// runs afterward and replaces it with a "v1." envelope).
UserSchema.pre("save", function (this: IUser, next) {
  const phone = this.phone;
  if (typeof phone === "string" && phone && !phone.startsWith("v1.")) {
    this.phoneLookupHash = phoneLookupHash(phone) ?? undefined;
  } else if (!phone) {
    this.phoneLookupHash = undefined;
  }
  this.fullNameLookup =
    normalizeFullName(this.firstName, this.lastName) ?? undefined;
  next();
});

attachContactStringEncryption(UserSchema, ["phone", "location"]);

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

export default User;

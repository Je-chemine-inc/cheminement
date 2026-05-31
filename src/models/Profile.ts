import mongoose, { Schema, Document, Model } from "mongoose";

export interface IProfile extends Document {
  userId: mongoose.Types.ObjectId;
  problematics?: string[];
  approaches?: string[];
  ageCategories?: string[];
  diagnosedConditions?: string[]; // Conditions that the professional treats
  skills?: string[];
  bio?: string;
  yearsOfExperience?: number;
  specialty?: string;
  license?: string;
  certifications?: string[];
  availability?: {
    days: {
      day: string;
      isWorkDay: boolean;
      startTime: string;
      endTime: string;
    }[];
    sessionDurationMinutes: number;
    breakDurationMinutes: number;
    firstDayOfWeek: string;
  };
  clinicalAvailability?: string[];
  languages?: string[];
  sessionTypes?: string[];
  modalities?: string[];
  paymentAgreement?: string;
  paymentFrequency?: string;
  pricing?: {
    individualSession: number;
    coupleSession: number;
    groupSession: number;
  };
  education?: {
    degree: string;
    institution: string;
    year: number;
  }[];
  profileCompleted: boolean;
  /** Acceptation des Conditions d’utilisation pour les professionnels (finalisation profil). */
  professionalTermsAcceptedAt?: Date;
  /** Version des CU pros acceptée (ex. "2026-04-13"). */
  professionalTermsVersion?: string;
  /**
   * Visibilité aux AUTRES professionnels pour la messagerie interne (peer-to-peer).
   * Défaut: visible. Si false, le pro n'apparaît plus aux autres pros et ne peut
   * échanger qu'avec ses clients et le soutien/les administrateurs.
   */
  visibleToProfessionals?: boolean;
  /** Profil visible aux clients (paramètre de confidentialité). */
  profileVisible?: boolean;
  /** Afficher la note moyenne sur le profil public. */
  showRating?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProfileSchema = new Schema<IProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    problematics: [String],
    approaches: [String],
    ageCategories: [String],
    diagnosedConditions: [String],
    skills: [String],
    bio: {
      type: String,
      maxlength: 1000,
    },
    yearsOfExperience: {
      type: Number,
      min: 0,
    },
    specialty: String,
    license: String,
    certifications: [String],
    availability: {
      days: [
        {
          day: {
            type: String,
            enum: [
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
              "Sunday",
            ],
          },
          isWorkDay: Boolean,
          startTime: String,
          endTime: String,
        },
      ],
      sessionDurationMinutes: Number,
      breakDurationMinutes: Number,
      firstDayOfWeek: {
        type: String,
        enum: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
      },
    },
    clinicalAvailability: [String],
    languages: [String],
    sessionTypes: [String],
    modalities: [String],
    paymentAgreement: String,
    paymentFrequency: String,
    pricing: {
      individualSession: Number,
      coupleSession: Number,
      groupSession: Number,
    },
    education: [
      {
        degree: String,
        institution: String,
        year: Number,
      },
    ],
    profileCompleted: {
      type: Boolean,
      default: false,
    },
    professionalTermsAcceptedAt: Date,
    professionalTermsVersion: String,
    // Visibilité aux autres professionnels pour la messagerie interne. Défaut: visible.
    visibleToProfessionals: { type: Boolean, default: true },
    profileVisible: { type: Boolean, default: true },
    showRating: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  },
);

ProfileSchema.index({ specialty: 1 });
ProfileSchema.index({ problematics: 1 });

const Profile: Model<IProfile> =
  mongoose.models.Profile || mongoose.model<IProfile>("Profile", ProfileSchema);

export default Profile;

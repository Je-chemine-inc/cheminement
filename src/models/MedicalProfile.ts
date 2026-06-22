import mongoose, { Schema, Document, Model } from "mongoose";
import { attachContactStringEncryption } from "@/lib/mongoose-contact-encryption";

export interface IMedicalProfile extends Document {
  userId: mongoose.Types.ObjectId;

  // Personal Information
  concernedPerson?: string;
  accountFor?: "me" | "child";
  childFirstName?: string;
  childLastName?: string;
  childDateOfBirth?: string;
  childServiceType?: "evaluation" | "suivi";

  // Health Background
  medicalConditions?: string[];
  currentMedications?: string[];
  allergies?: string[];
  consultationMotifs?: string[];
  substanceUse?: string;

  // Mental Health History
  previousTherapy?: boolean;
  previousTherapyDetails?: string;
  psychiatricHospitalization?: boolean;
  currentTreatment?: string;
  diagnosedConditions?: string[];

  // Current Concerns
  /** Primary concern(s) — up to 3. `primaryIssue` is kept = primaryIssues[0]
   * for backward compatibility with the matcher and all legacy readers. */
  primaryIssue?: string;
  primaryIssues?: string[];
  secondaryIssues?: string[];
  issueDescription?: string;
  severity?: "mild" | "moderate" | "severe";
  duration?: "lessThanMonth" | "oneToThree" | "threeToSix" | "moreThanSix";
  triggeringSituation?: string;

  // Symptoms & Impact
  symptoms?: string[];
  dailyLifeImpact?: string;
  sleepQuality?: "normal" | "poor" | "insomnia" | "excessive";
  appetiteChanges?: string;

  // Goals & Treatment Preferences
  treatmentGoals?: string[];
  therapyApproach?: string[];
  concernsAboutTherapy?: string;

  // Appointment Preferences
  availability?: string[];
  modality?: "online" | "inPerson" | "both";
  location?: string;
  sessionFrequency?: "weekly" | "biweekly" | "monthly";
  notes?: string;

  // Emergency Information
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactEmail?: string;
  emergencyContactRelation?: string;

  // Professional Matching Preferences
  preferredGender?: "noPreference" | "male" | "female" | "other";
  preferredAge?: "any" | "younger" | "middle" | "older";
  languagePreference?: string;
  culturalConsiderations?: string;

  paymentMethod?: string;

  profileCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MedicalProfileSchema = new Schema<IMedicalProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // Personal Information
    concernedPerson: String,
    accountFor: String,
    childFirstName: String,
    childLastName: String,
    childDateOfBirth: String,
    childServiceType: String,

    // Health Background
    medicalConditions: [String],
    currentMedications: [String],
    allergies: [String],
    consultationMotifs: [String],
    substanceUse: String,

    // Mental Health History
    previousTherapy: Boolean,
    previousTherapyDetails: String,
    psychiatricHospitalization: Boolean,
    currentTreatment: String,
    diagnosedConditions: [String],

    // Current Concerns
    primaryIssue: String,
    primaryIssues: [String],
    secondaryIssues: [String],
    issueDescription: String,
    severity: {
      type: String,
      enum: ["mild", "moderate", "severe"],
    },
    duration: {
      type: String,
      enum: ["lessThanMonth", "oneToThree", "threeToSix", "moreThanSix"],
    },
    triggeringSituation: String,

    // Symptoms & Impact
    symptoms: [String],
    dailyLifeImpact: String,
    sleepQuality: {
      type: String,
      enum: ["normal", "poor", "insomnia", "excessive"],
    },
    appetiteChanges: String,

    // Goals & Treatment Preferences
    treatmentGoals: [String],
    therapyApproach: [String],
    concernsAboutTherapy: String,

    // Appointment Preferences
    availability: [String],
    modality: {
      type: String,
      enum: ["online", "inPerson", "both"],
    },
    location: String,
    sessionFrequency: {
      type: String,
      enum: ["weekly", "biweekly", "monthly"],
    },
    notes: String,

    // Emergency Information
    emergencyContactName: String,
    emergencyContactPhone: String,
    emergencyContactEmail: String,
    emergencyContactRelation: String,

    // Professional Matching Preferences
    preferredGender: {
      type: String,
      enum: ["noPreference", "male", "female", "other"],
    },
    preferredAge: {
      type: String,
      enum: ["any", "younger", "middle", "older"],
    },
    languagePreference: String,
    culturalConsiderations: String,
    paymentMethod: String,

    profileCompleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for better query performance
// (userId already gets a unique index from `unique: true` on the field)
MedicalProfileSchema.index({ profileCompleted: 1 });

attachContactStringEncryption(MedicalProfileSchema, [
  "location",
  "emergencyContactPhone",
]);

const MedicalProfile: Model<IMedicalProfile> =
  mongoose.models.MedicalProfile ||
  mongoose.model<IMedicalProfile>("MedicalProfile", MedicalProfileSchema);

export default MedicalProfile;

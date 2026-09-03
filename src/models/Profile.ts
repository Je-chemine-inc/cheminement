import mongoose, { Schema, Document, Model } from "mongoose";

/** One therapy type's admin-configured pricing. */
export interface ProfessionalRate {
  /** What the client is charged. */
  clientPrice?: number;
  /** What the professional receives. The platform keeps `clientPrice - professionalRate`. */
  professionalRate?: number;
}

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
  /**
   * Where in-person sessions actually take place. Reminders used to carry no
   * location at all, so the only address a client saw was Je chemine's in the
   * email footer — and they could turn up at the wrong building. Structured
   * to match PlatformSettings.physicalAddress so formatStandardAddressBlock
   * renders both identically.
   */
  officeAddress?: {
    street?: string;
    suite?: string;
    city?: string;
    province?: string;
    postalCode?: string;
  };
  /** Free text for what an address cannot say: floor, buzzer, parking, entrance. */
  officeNotes?: string;
  paymentAgreement?: string;
  paymentFrequency?: string;
  /**
   * LEGACY (pre-2026-08-31). A single number per therapy type. Under the old
   * model this was what the **client was charged**; under the current model it
   * is read as the **professional's rate** (what they receive) — see spec 001
   * Q1. Still written by the professional's own profile form until the admin
   * pricing editor replaces it. `rates` takes precedence when present.
   * A value of `0` means **unset**, never "pays nothing".
   */
  pricing?: {
    individualSession: number;
    coupleSession: number;
    groupSession: number;
  };
  /**
   * Admin-configured pricing per therapy type: what the client pays and what
   * the professional receives. The platform keeps the spread between them.
   * Both sides are stored explicitly — a percentage is a UI affordance only,
   * so money never drifts through repeated rounding.
   */
  rates?: {
    solo?: ProfessionalRate;
    couple?: ProfessionalRate;
    group?: ProfessionalRate;
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
  /**
   * Décaissement manuel interne (aucun frais Stripe) : mode de versement choisi
   * par le professionnel pour recevoir ses paiements de la plateforme.
   */
  payoutMethod?: "interac" | "direct_deposit";
  /** Courriel de dépôt Interac (si payoutMethod === "interac"). */
  payoutInteracEmail?: string;
  /** URL du spécimen de chèque téléversé (si payoutMethod === "direct_deposit"). */
  payoutChequeUrl?: string;
  /** Nom de fichier d'origine du spécimen de chèque. */
  payoutChequeName?: string;
  /**
   * Le professionnel accepte-t-il de NOUVEAUX clients ? Défaut: true.
   * Si false, le jumelage automatique et la liste générale ne lui proposent
   * plus de nouvelles demandes, et la liste générale lui est masquée. Les
   * propositions et rendez-vous existants ne sont pas touchés. Permet au pro
   * de contrôler son afflux de nouvelles demandes.
   */
  acceptingNewClients?: boolean;
  /**
   * Le professionnel accepte-t-il les « Consultations ponctuelles rapides »
   * (demandes urgentes / isEmergency) ? Défaut: true. Si false, le jumelage
   * automatique ne lui propose plus de demandes urgentes et il n'est pas
   * notifié — mais il peut toujours les piger dans la liste générale. Indépendant
   * de `acceptingNewClients` : un pro peut accepter de nouveaux clients sans
   * accepter les demandes urgentes (et inversement).
   */
  acceptingEmergencyConsultations?: boolean;
  /**
   * Secret token for the read-only iCal subscription feed of this pro's
   * appointments (calendar sync). Generated on demand; rotating it invalidates
   * the old subscription URL. Consumed by GET /api/calendar/[token] without a
   * session (calendar apps can't authenticate).
   */
  calendarFeedToken?: string;
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
    officeAddress: {
      street: { type: String, trim: true, default: "" },
      suite: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      province: { type: String, trim: true, default: "" },
      postalCode: { type: String, trim: true, default: "" },
    },
    officeNotes: { type: String, trim: true },
    paymentAgreement: String,
    paymentFrequency: String,
    // LEGACY single-number pricing — read as the professional's rate. See the
    // interface above and spec 001.
    pricing: {
      individualSession: Number,
      coupleSession: Number,
      groupSession: Number,
    },
    // Admin-configured client price / professional rate per therapy type.
    rates: {
      solo: { clientPrice: Number, professionalRate: Number },
      couple: { clientPrice: Number, professionalRate: Number },
      group: { clientPrice: Number, professionalRate: Number },
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
    // Accepte de nouveaux clients (jumelage + liste générale). Défaut: true.
    acceptingNewClients: { type: Boolean, default: true },
    payoutMethod: { type: String, enum: ["interac", "direct_deposit"] },
    payoutInteracEmail: { type: String, trim: true },
    payoutChequeUrl: { type: String, trim: true },
    payoutChequeName: { type: String, trim: true },
    // Accepte les consultations ponctuelles rapides (demandes urgentes). Défaut: true.
    acceptingEmergencyConsultations: { type: Boolean, default: true },
    // Jeton secret du flux iCal (abonnement calendrier en lecture seule).
    calendarFeedToken: { type: String, trim: true },
  },
  {
    timestamps: true,
  },
);

ProfileSchema.index({ specialty: 1 });
ProfileSchema.index({ problematics: 1 });
// Look up the feed by its secret token (sparse: most profiles have none).
ProfileSchema.index(
  { calendarFeedToken: 1 },
  { unique: true, sparse: true },
);

const Profile: Model<IProfile> =
  mongoose.models.Profile || mongoose.model<IProfile>("Profile", ProfileSchema);

export default Profile;

import mongoose, { Schema, Document, Model } from "mongoose";
import { attachAppointmentContactEncryption } from "@/lib/mongoose-contact-encryption";

export interface IPayment {
  price: number;
  /** Tarif catalogue avant ajustement (clôture séance). */
  listPrice?: number;
  platformFee: number;
  professionalPayout: number;
  status:
    | "pending"
    | "processing"
    | "paid"
    | "failed"
    | "refunded"
    | "partially_refunded"
    | "cancelled"
    | "overdue";
  method?: "card" | "transfer" | "direct_debit" | "manual";
  stripePaymentIntentId?: string;
  /** Encrypted at rest when FIELD_ENCRYPTION_KEY is set (see `encryptPaymentMethodReference`). */
  stripePaymentMethodId?: string;
  paidAt?: Date;
  refundedAt?: Date;
  /** Amount actually refunded (CAD). Set for partial refunds; full refund == price. */
  refundedAmount?: number;
  /** A Stripe dispute/chargeback is open on this payment (blocks the receipt). */
  disputed?: boolean;
  payoutTransferId?: string;
  payoutDate?: Date;
  paymentToken?: string;
  paymentTokenExpiry?: Date;
  /** Interac / virement : échéance de réception du paiement (ex. fin de séance + 24h). */
  transferDueAt?: Date;
  /** Code message Interac (unique par RDV, lié au pro). */
  interacReferenceCode?: string;
  /** Nom du payeur Interac réel, saisi par l'admin lors de la réconciliation
   *  (ex. virement reçu sous le nom d'un conjoint). */
  interacPayerName?: string;
  /** Note libre de réconciliation admin (référence bancaire, contexte…). */
  interacReconciliationNote?: string;
}

// Loved one information for third-party bookings
export interface ILovedOneInfo {
  firstName: string;
  lastName: string;
  relationship: string; // e.g., "spouse", "child", "parent", "sibling", "other"
  dateOfBirth?: Date;
  phone?: string;
  email?: string;
  notes?: string;
}

// Referral information for patient bookings (by healthcare professionals)
export interface IReferralInfo {
  referrerType: "doctor" | "specialist" | "other_professional";
  referrerName: string;
  referrerLicense?: string;
  referrerPhone?: string;
  referrerEmail?: string;
  patientFirstName?: string;
  patientLastName?: string;
  patientPhone?: string;
  patientEmail?: string;
  referralReason?: string;
  /** Approaches/therapies the referrer would like for the patient (stored as
   *  readable labels in the booking locale). Multi-select on the referral form. */
  desiredApproaches?: string[];
  documentUrl?: string; // URL to uploaded prescription/referral PDF
  documentName?: string;
  uploadedAt?: Date;
}

export interface IAppointment extends Document {
  clientId: mongoose.Types.ObjectId;
  professionalId?: mongoose.Types.ObjectId;
  date?: Date;
  time?: string;
  duration: number;
  type: "video" | "in-person" | "phone" | "both";
  therapyType: "solo" | "couple" | "group";
  status:
    | "scheduled"
    | "completed"
    | "cancelled"
    | "no-show"
    | "pending"
    | "ongoing";
  issueType?: string;
  /** Array of selected motifs (1–3), stored from the booking form's `needs` field. */
  needs?: string[];
  notes?: string;
  cancelReason?: string;
  cancelledBy?: "client" | "professional" | "admin";
  cancelledAt?: Date;
  meetingLink?: string;
  location?: string;
  scheduledStartAt?: Date;
  reminderSent: boolean;
  payment: IPayment;

  // Booking context - who is this appointment for
  bookingFor: "self" | "patient" | "loved-one";

  // Loved one information (when bookingFor === "loved-one")
  lovedOneInfo?: ILovedOneInfo;

  // Referral information (when bookingFor === "patient")
  referralInfo?: IReferralInfo;

  // Routing status for professional assignment workflow.
  // "awaiting_admin": the auto-match cascade was exhausted (2 failed attempts,
  // by refusal or 48h no-response) or no eligible pro existed — the dossier is
  // returned to the admin "Demande de service" queue for a MANUAL decision
  // (assign a specific pro, or send to the general pool). It is admin-only and
  // is NOT visible to professionals in the general pull.
  routingStatus:
    | "pending"
    | "proposed"
    | "accepted"
    | "refused"
    | "general"
    | "awaiting_admin";

  /**
   * Set when a client requests a fresh appointment with a *different* professional
   * (the "Demander un rendez-vous avec un autre professionnel" CTA). Surfaced to
   * admins as the "Ancien client" badge so they avoid duplicate-client mistakes.
   */
  isReturningClient?: boolean;

  /**
   * Self-declared emergency request: set when the client comes through the
   * "Prendre un rendez-vous d'urgence" funnel. Surfaced to admins (alert email
   * + "Urgence" badge in the service-requests queue) so urgent requests are
   * triaged first. NOT a substitute for emergency services — the public
   * emergency page directs life-threatening situations to 911 / 988.
   */
  isEmergency?: boolean;

  // Array of professional IDs this appointment has been proposed to
  proposedTo?: mongoose.Types.ObjectId[];

  /**
   * When the current targeted proposal was sent (routingStatus → "proposed").
   * Drives the 48h no-response timeout (proposal-timeout cron): a proposal left
   * unanswered past 48h is treated exactly like a refusal and advances the
   * cascade. Re-stamped on every new proposal; irrelevant once not "proposed".
   */
  proposedAt?: Date;

  // Array of professional IDs who refused this appointment
  refusedBy?: mongoose.Types.ObjectId[];

  /**
   * Genuine cascade-refusal count — the targeted-attempt counter driving the
   * 3-level matching cascade (0 → Tentative 1 strict, 1 → Tentative 2 relaxed,
   * ≥2 → general pool). Deliberately SEPARATE from `refusedBy` (the
   * never-re-propose exclusion set), which is also written by release/reassign
   * and so must not advance the cascade. Incremented only by the refuse
   * re-route; reset to 0 when an admin re-runs automatic matching.
   */
  cascadeAttempts?: number;

  // Preferred availability slots provided by client
  preferredAvailability?: string[];

  /**
   * For "loved-one" requests: when the loved one is an adult (>18),
   * admin must validate where the onboarding/account link should be sent.
   */
  accountActivationStatus?:
    | "pending_admin"
    | "sent_to_requester"
    | "sent_to_loved_one";

  accountActivationSentAt?: Date;

  /**
   * True when the 1st appointment is scheduled but payment guarantee (card on file) is still pending.
   * Aligns with workflow: "RDV fixé — en attente de garantie".
   */
  awaitingPaymentGuarantee?: boolean;

  /** Horodatage du passage à l'état "jumelé" (acceptation par le pro). Sert à
   * mesurer les délais de relance/escalade depuis l'acceptation (pas la création). */
  matchedAt?: Date;

  /**
   * Relance envoyée au pro qui a accepté un client (jumelé) mais n'a pas encore
   * confirmé le 1er RDV après N jours (statut "pending" + routingStatus "accepted").
   */
  firstRdvReminderSent?: boolean;

  /** Escalade admin envoyée quand un jumelage reste non planifié au-delà du
   * délai de relance pro (le pro a accepté mais n'a jamais fixé le 1er RDV). */
  firstRdvAdminEscalatedSent?: boolean;

  /**
   * Soft-SLA dedup flag for URGENT requests ("Consultation ponctuelle rapide" /
   * isEmergency) at the TAKE-CHARGE stage: a pro who accepted commits to confirm
   * the 1st RDV within 24h. When that lapses, a daily cron sends a soft reminder
   * to the pro + an alert to admins — the request STAYS assigned (no auto-move).
   * Deadline computed on the fly (matchedAt + 24h); reset to false on each accept.
   * (The ACCEPT-stage deadline is HARD — the proposal timeout advances the
   * cascade at 24h regular / 12h urgent. See proposal-timeout.ts.)
   */
  takeChargeSlaAlertSent?: boolean;

  /** Premier passage en « scheduled » (pour relance J+1 garantie). */
  firstScheduledAt?: Date;
  guaranteeDay1ReminderSent?: boolean;
  guaranteeDay2ReminderSent?: boolean;
  guarantee48hClientReminderSent?: boolean;
  /** Last time an admin manually re-sent the guarantee nudge (cooldown / anti-spam). */
  lastGuaranteeReminderSentAt?: Date;

  /** Rappels client/SMS H-72 et H-48 avant le rendez-vous (politique d'annulation). */
  reminder72hSent?: boolean;
  reminder48hSent?: boolean;
  guarantee48hProfessionalAlertSent?: boolean;

  /**
   * Confirmation explicite du client depuis le rappel H-48. Sert au pro à voir
   * dans son tableau de bord que le client a affirmé sa présence.
   */
  clientConfirmedAt?: Date;

  /** Nature de l'acte (clôture professionnelle). */
  sessionActNature?: string;
  /** Précision libre sur la raison de consultation (apparaît sur le reçu). */
  sessionActNatureOther?: string;
  /** Issue de la rencontre (clôture). */
  sessionOutcome?: string;
  /** Prochain RDV convenu (information). */
  nextAppointmentAt?: Date;
  sessionCompletedAt?: Date;
  /** Reçu fiscal émis (PDF envoyé / disponible). */
  fiscalReceiptIssuedAt?: Date;
  /**
   * Numéro de facture unique attribué à la clôture (séance facturable). Sert sur
   * la demande de paiement post-séance ET sur le reçu fiscal final. Émis une
   * seule fois (idempotent), avant toute confirmation de paiement.
   */
  invoiceNumber?: string;

  /**
   * Rappel post-séance envoyé au client quand aucun mode de paiement n'était
   * configuré avant la date de rencontre. Admin alerté en même temps.
   */
  postMeetingPaymentReminderSent?: boolean;

  /** Relance automatique Interac J+1 (24h après transferDueAt sans paiement). */
  interacReminder24hSent?: boolean;
  /** Relance automatique Interac J+2 (48h après transferDueAt sans paiement). */
  interacReminder48hSent?: boolean;
  /** Relance facture impayée H+12 (carte ou Interac), depuis sessionCompletedAt. */
  paymentReminder12hSent?: boolean;
  /** Relance facture impayée H+36 (carte ou Interac), depuis sessionCompletedAt. */
  paymentReminder36hSent?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    price: {
      type: Number,
      required: true,
      default: 120,
    },
    listPrice: { type: Number, required: false },
    platformFee: {
      type: Number,
      required: true,
      default: 12,
    },
    professionalPayout: {
      type: Number,
      required: true,
      default: 108,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "paid",
        "failed",
        "refunded",
        "partially_refunded",
        "cancelled",
        "overdue",
      ],
      default: "pending",
    },
    method: {
      type: String,
      enum: ["card", "transfer", "direct_debit", "manual"],
      default: "card",
    },
    stripePaymentIntentId: String,
    stripePaymentMethodId: String,
    paidAt: Date,
    refundedAt: Date,
    refundedAmount: Number,
    disputed: { type: Boolean, default: false },
    payoutTransferId: String,
    payoutDate: Date,
    paymentToken: {
      type: String,
      index: true,
    },
    paymentTokenExpiry: Date,
    transferDueAt: Date,
    interacReferenceCode: { type: String, index: true },
    interacPayerName: String,
    interacReconciliationNote: String,
  },
  { _id: false },
);

const LovedOneInfoSchema = new Schema<ILovedOneInfo>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    relationship: {
      type: String,
      required: true,
      enum: ["spouse", "child", "parent", "sibling", "friend", "other"],
    },
    dateOfBirth: Date,
    phone: String,
    email: String,
    notes: String,
  },
  { _id: false },
);

const ReferralInfoSchema = new Schema<IReferralInfo>(
  {
    referrerType: {
      type: String,
      required: true,
      enum: ["doctor", "specialist", "other_professional"],
    },
    referrerName: { type: String, required: true },
    referrerLicense: String,
    referrerPhone: String,
    referrerEmail: String,
    patientFirstName: String,
    patientLastName: String,
    patientPhone: String,
    patientEmail: String,
    referralReason: String,
    desiredApproaches: [String],
    documentUrl: String,
    documentName: String,
    uploadedAt: Date,
  },
  { _id: false },
);

const AppointmentSchema = new Schema<IAppointment>(
  {
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    professionalId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    date: {
      type: Date,
      required: false,
    },
    time: {
      type: String,
      required: false,
    },
    duration: {
      type: Number,
      required: true,
      default: 60,
    },
    type: {
      type: String,
      enum: ["video", "in-person", "phone", "both"],
      required: true,
      default: "video",
    },
    therapyType: {
      type: String,
      enum: ["solo", "couple", "group"],
      required: true,
      default: "solo",
    },
    status: {
      type: String,
      enum: [
        "scheduled",
        "completed",
        "cancelled",
        "no-show",
        "pending",
        "ongoing",
      ],
      default: "pending",
    },
    issueType: String,
    needs: [{ type: String }],
    notes: String,
    cancelReason: String,
    cancelledBy: {
      type: String,
      enum: ["client", "professional", "admin"],
    },
    cancelledAt: Date,
    meetingLink: String,
    location: String,
    scheduledStartAt: Date,
    reminderSent: {
      type: Boolean,
      default: false,
    },
    payment: {
      type: PaymentSchema,
      required: true,
      default: () => ({}),
    },
    // Booking context - who is this appointment for
    bookingFor: {
      type: String,
      enum: ["self", "patient", "loved-one"],
      default: "self",
    },
    // Loved one information (when bookingFor === "loved-one")
    lovedOneInfo: {
      type: LovedOneInfoSchema,
      required: false,
    },
    // Referral information (when bookingFor === "patient")
    referralInfo: {
      type: ReferralInfoSchema,
      required: false,
    },
    // Routing status for professional assignment workflow
    routingStatus: {
      type: String,
      enum: [
        "pending",
        "proposed",
        "accepted",
        "refused",
        "general",
        "awaiting_admin",
      ],
      default: "pending",
    },
    isReturningClient: { type: Boolean, default: false },
    isEmergency: { type: Boolean, default: false },
    // Array of professional IDs this appointment has been proposed to
    proposedTo: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // When the current targeted proposal was sent (drives the 48h timeout).
    proposedAt: { type: Date, required: false },
    // Array of professional IDs who refused this appointment
    refusedBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Targeted-attempt counter for the 3-level cascade (see IAppointment).
    cascadeAttempts: { type: Number, default: 0 },
    // Preferred availability slots provided by client
    preferredAvailability: [String],

    // Loved-one onboarding link decision (admin-controlled when loved one is an adult)
    accountActivationStatus: {
      type: String,
      enum: ["pending_admin", "sent_to_requester", "sent_to_loved_one"],
      required: false,
    },
    accountActivationSentAt: { type: Date, required: false },

    awaitingPaymentGuarantee: {
      type: Boolean,
      default: false,
    },

    matchedAt: Date,
    firstRdvReminderSent: { type: Boolean, default: false },
    firstRdvAdminEscalatedSent: { type: Boolean, default: false },
    // Soft-SLA take-charge alert dedup flag for urgent requests (see IAppointment).
    takeChargeSlaAlertSent: { type: Boolean, default: false },
    firstScheduledAt: Date,
    guaranteeDay1ReminderSent: { type: Boolean, default: false },
    guaranteeDay2ReminderSent: { type: Boolean, default: false },
    guarantee48hClientReminderSent: { type: Boolean, default: false },
    lastGuaranteeReminderSentAt: { type: Date, required: false },

    reminder72hSent: { type: Boolean, default: false },
    reminder48hSent: { type: Boolean, default: false },
    guarantee48hProfessionalAlertSent: { type: Boolean, default: false },

    clientConfirmedAt: { type: Date, required: false },

    postMeetingPaymentReminderSent: { type: Boolean, default: false },

    interacReminder24hSent: { type: Boolean, default: false },
    interacReminder48hSent: { type: Boolean, default: false },
    paymentReminder12hSent: { type: Boolean, default: false },
    paymentReminder36hSent: { type: Boolean, default: false },

    sessionActNature: { type: String, required: false },
    sessionActNatureOther: { type: String, required: false },
    sessionOutcome: { type: String, required: false },
    nextAppointmentAt: { type: Date, required: false },
    sessionCompletedAt: { type: Date, required: false },
    fiscalReceiptIssuedAt: { type: Date, required: false },
    invoiceNumber: { type: String, required: false, index: true },
  },
  {
    timestamps: true,
  },
);

AppointmentSchema.index({ clientId: 1, date: 1 });
AppointmentSchema.index({ professionalId: 1, date: 1 });
AppointmentSchema.index({ status: 1, date: 1 });
AppointmentSchema.index({ routingStatus: 1 });
AppointmentSchema.index({ proposedTo: 1, routingStatus: 1 });

attachAppointmentContactEncryption(AppointmentSchema);

const Appointment: Model<IAppointment> =
  mongoose.models.Appointment ||
  mongoose.model<IAppointment>("Appointment", AppointmentSchema);

export default Appointment;

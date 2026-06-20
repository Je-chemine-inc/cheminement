interface PersonResponse {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  location?: string;
}

type AppointmentType = "video" | "in-person" | "phone" | "both";
type TherapyType = "solo" | "couple" | "group";
export type AppointmentStatus =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "no-show"
  | "pending"
  | "ongoing";

type PaymentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "refunded"
  | "cancelled";

type CancelledBy = "client" | "professional" | "admin";

export interface PaymentInfo {
  price: number;
  /** Tarif de référence avant ajustement fin de séance (facultatif jusqu'à la clôture). */
  listPrice?: number;
  platformFee: number;
  professionalPayout: number;
  status: PaymentStatus;
  method?: "card" | "transfer" | "direct_debit";
  stripePaymentIntentId?: string;
  stripePaymentMethodId?: string;
  paidAt?: string;
  refundedAt?: string;
  payoutTransferId?: string;
  payoutDate?: string;
  /** Interac / virement : date limite de réception (ex. +24h après séance). */
  transferDueAt?: string;
  interacReferenceCode?: string;
}

export interface AppointmentResponse {
  _id: string;
  clientId: PersonResponse;
  professionalId?: PersonResponse | null;
  date: string;
  time: string;
  duration: number;
  type: AppointmentType;
  therapyType: TherapyType;
  status: AppointmentStatus;
  /** Professional assignment workflow state (pending/proposed/accepted/refused/general). */
  routingStatus?: string;
  /** Who the appointment is for. */
  bookingFor?: "self" | "patient" | "loved-one";
  lovedOneInfo?: {
    firstName?: string;
    lastName?: string;
    relationship?: string;
  } | null;
  referralInfo?: {
    patientFirstName?: string;
    patientLastName?: string;
    referrerName?: string;
    referralReason?: string;
    desiredApproaches?: string[];
    documentUrl?: string;
    documentName?: string;
  } | null;
  issueType?: string;
  /** Selected motifs (1–3) from the booking form's `needs` field. */
  needs?: string[];
  /** Client's preferred-availability tokens (week_/weekend_ × period). */
  preferredAvailability?: string[];
  notes?: string;
  cancelReason?: string;
  cancelledBy?: CancelledBy;
  cancelledAt?: string;
  meetingLink?: string;
  location?: string;
  scheduledStartAt?: string;
  reminderSent: boolean;
  payment: PaymentInfo;
  /** RDV fixé mais moyen de paiement / garantie pas encore enregistré */
  awaitingPaymentGuarantee?: boolean;
  /** Clôture post-séance (professionnel) */
  sessionActNature?: string;
  sessionOutcome?: string;
  nextAppointmentAt?: string;
  sessionCompletedAt?: string;
  fiscalReceiptIssuedAt?: string;
  /** Fiscal invoice number (JC-YYYY-NNNNNN), assigned at session closure. */
  invoiceNumber?: string;
  createdAt: string;
  updatedAt: string;
}

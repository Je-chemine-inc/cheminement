import mongoose, { Schema, Document, Model } from "mongoose";

// Email notification types
export type EmailNotificationType =
  | "welcome"
  | "email_verification"
  | "password_reset"
  | "appointment_confirmation"
  | "appointment_professional_notification"
  | "appointment_reminder"
  | "appointment_reminder_72h"
  | "appointment_reminder_48h"
  | "appointment_cancellation"
  | "guest_booking_confirmation"
  | "service_request_onboarding"
  | "guest_payment_confirmation"
  | "guest_payment_complete"
  | "payment_invitation"
  | "payment_failed"
  | "payment_refund"
  | "meeting_link"
  | "professional_approval"
  | "professional_rejection"
  | "admin_interac_trust_request"
  | "interac_transfer_instructions"
  | "payment_guarantee_day1_reminder"
  | "payment_guarantee_day2_reminder"
  | "payment_guarantee_48h_client"
  | "payment_guarantee_48h_professional"
  | "fiscal_receipt"
  | "interac_payment_reminder";

export interface IEmailTemplateConfig {
  enabled: boolean;
  subject: string;
}

export interface IEmailBranding {
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  companyName: string;
  footerText: string;
}

export interface ISmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
}

export interface IEmailSettings {
  enabled: boolean;
  smtpConfigured: boolean;
  branding: IEmailBranding;
  templates: Record<EmailNotificationType, IEmailTemplateConfig>;
}

export interface IPlatformPhysicalAddress {
  /** Civic number + street, e.g. "123, rue de l'Exemple". */
  street: string;
  /** Suite / office / unit (optional), e.g. "Bureau 101". */
  suite: string;
  city: string;
  /** Full name or abbreviation, e.g. "Québec" or "QC". */
  province: string;
  /** Canadian postal code, format "A1B 2C3". */
  postalCode: string;
  country: string;
}

export interface IPlatformContact {
  physicalAddress: IPlatformPhysicalAddress;
  phoneNumber: string;
  supportEmail: string;
}

export interface IPlatformSettings extends Document {
  defaultPricing: {
    solo: number;
    couple: number;
    group: number;
  };
  platformFeePercentage: number;
  currency: string;
  cancellationPolicy: {
    clientCancellationHours: number;
    clientRefundPercentage: number;
    professionalCancellationHours: number;
  };
  emailSettings: IEmailSettings;
  /** Courriel de dépôt Interac affiché aux clients (ex. paiements@domaine.com). */
  interacDepositEmail?: string;
  platformContact: IPlatformContact;
  createdAt: Date;
  updatedAt: Date;
}

// Default email template configurations
const defaultEmailTemplates: Record<
  EmailNotificationType,
  IEmailTemplateConfig
> = {
  welcome: {
    enabled: true,
    subject: "Welcome to Je chemine!",
  },
  email_verification: {
    enabled: true,
    subject: "Verify Your Email - Je chemine",
  },
  password_reset: {
    enabled: true,
    subject: "Reset Your Password - Je chemine",
  },
  appointment_confirmation: {
    enabled: true,
    subject: "Appointment Confirmed - Je chemine",
  },
  appointment_professional_notification: {
    enabled: true,
    subject: "New Appointment Request - Je chemine",
  },
  appointment_reminder: {
    enabled: true,
    subject: "Appointment Reminder - Je chemine",
  },
  appointment_reminder_72h: {
    enabled: true,
    subject: "Rappel : rendez-vous dans 72 heures — Je chemine",
  },
  appointment_reminder_48h: {
    enabled: true,
    subject: "Rappel : rendez-vous dans 48 heures — Je chemine",
  },
  appointment_cancellation: {
    enabled: true,
    subject: "Appointment Cancelled - Je chemine",
  },
  guest_booking_confirmation: {
    enabled: true,
    subject: "Booking Request Received - Je chemine",
  },
  service_request_onboarding: {
    enabled: true,
    subject: "Je chemine — complete your profile",
  },
  guest_payment_confirmation: {
    enabled: true,
    subject: "Rendez-vous confirmé — prochaine étape : votre paiement",
  },
  guest_payment_complete: {
    enabled: true,
    subject: "Paiement confirmé — Je chemine",
  },
  payment_invitation: {
    enabled: true,
    subject: "Rendez-vous confirmé — prochaine étape : votre paiement",
  },
  payment_failed: {
    enabled: true,
    subject: "Payment Failed - Action Required",
  },
  payment_refund: {
    enabled: true,
    subject: "Refund Processed - Je chemine",
  },
  meeting_link: {
    enabled: true,
    subject: "Your Meeting Link is Ready - Je chemine",
  },
  professional_approval: {
    enabled: true,
    subject: "Welcome! Your Professional Account is Approved",
  },
  professional_rejection: {
    enabled: true,
    subject: "Application Update - Je chemine",
  },
  admin_interac_trust_request: {
    enabled: true,
    subject: "Interac / virement — validation requise (Statut vert)",
  },
  interac_transfer_instructions: {
    enabled: true,
    subject: "Instructions virement Interac — Je chemine",
  },
  payment_guarantee_day1_reminder: {
    enabled: true,
    subject: "Rappel : ajoutez un moyen de paiement — Je chemine",
  },
  payment_guarantee_day2_reminder: {
    enabled: true,
    subject: "Dernier rappel : moyen de paiement requis — Je chemine",
  },
  payment_guarantee_48h_client: {
    enabled: true,
    subject: "URGENT : votre rendez-vous approche — moyen de paiement — Je chemine",
  },
  payment_guarantee_48h_professional: {
    enabled: true,
    subject: "ALERTE : client sans garantie de paiement — rendez-vous proche",
  },
  fiscal_receipt: {
    enabled: true,
    subject: "Votre reçu fiscal — Je chemine",
  },
  interac_payment_reminder: {
    enabled: true,
    subject: "Rappel paiement Interac — Je chemine",
  },
};

const defaultEmailBranding: IEmailBranding = {
  primaryColor: "#8B7355",
  secondaryColor: "#6B5344",
  companyName: "Je chemine",
  footerText: "Your journey to wellness starts here.",
};

const EmailTemplateConfigSchema = new Schema<IEmailTemplateConfig>(
  {
    enabled: { type: Boolean, default: true },
    subject: { type: String, required: true },
  },
  { _id: false },
);

const EmailBrandingSchema = new Schema<IEmailBranding>(
  {
    primaryColor: { type: String, default: "#8B7355" },
    secondaryColor: { type: String, default: "#6B5344" },
    logoUrl: { type: String },
    companyName: { type: String, default: "Je chemine" },
    footerText: {
      type: String,
      default: "Your journey to wellness starts here.",
    },
  },
  { _id: false },
);

const PlatformSettingsSchema = new Schema<IPlatformSettings>(
  {
    defaultPricing: {
      solo: {
        type: Number,
        required: true,
        default: 120,
      },
      couple: {
        type: Number,
        required: true,
        default: 150,
      },
      group: {
        type: Number,
        required: true,
        default: 80,
      },
    },
    platformFeePercentage: {
      type: Number,
      required: true,
      default: 10,
      min: 0,
      max: 100,
    },
    currency: {
      type: String,
      default: "CAD",
    },
    cancellationPolicy: {
      clientCancellationHours: {
        type: Number,
        default: 24,
      },
      clientRefundPercentage: {
        type: Number,
        default: 100,
        min: 0,
        max: 100,
      },
      professionalCancellationHours: {
        type: Number,
        default: 12,
      },
    },
    interacDepositEmail: {
      type: String,
      trim: true,
      default: "",
    },
    platformContact: {
      physicalAddress: {
        street: { type: String, trim: true, default: "" },
        suite: { type: String, trim: true, default: "" },
        city: { type: String, trim: true, default: "" },
        province: { type: String, trim: true, default: "" },
        postalCode: { type: String, trim: true, default: "" },
        country: { type: String, trim: true, default: "Canada" },
      },
      phoneNumber: { type: String, trim: true, default: "" },
      supportEmail: {
        type: String,
        trim: true,
        default: "support@jechemine.ca",
      },
    },
    emailSettings: {
      enabled: {
        type: Boolean,
        default: true,
      },
      smtpConfigured: {
        type: Boolean,
        default: false,
      },
      branding: {
        type: EmailBrandingSchema,
        default: () => defaultEmailBranding,
      },
      templates: {
        type: Map,
        of: EmailTemplateConfigSchema,
        default: () => defaultEmailTemplates,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Helper to get default email settings
export function getDefaultEmailSettings(): IEmailSettings {
  return {
    enabled: true,
    smtpConfigured: false,
    branding: { ...defaultEmailBranding },
    templates: { ...defaultEmailTemplates },
  };
}

const PlatformSettings: Model<IPlatformSettings> =
  mongoose.models.PlatformSettings ||
  mongoose.model<IPlatformSettings>("PlatformSettings", PlatformSettingsSchema);

export default PlatformSettings;

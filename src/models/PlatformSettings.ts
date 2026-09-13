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
  | "resource_purchase_complete"
  | "payment_invitation"
  | "payment_failed"
  | "payment_refund"
  | "meeting_link"
  | "professional_approval"
  | "professional_rejection"
  | "admin_interac_trust_request"
  // Admin alert for a new service request. Deliberately its OWN type and not
  // "service_request_onboarding": that one is the CLIENT's confirmation, shown
  // in Admin → Settings as "Courriel de bienvenue (formulaire de demande)".
  // Sharing it meant switching off the client welcome email also silently
  // switched off the team's own new-demande alerts.
  | "admin_new_service_request"
  // Spec 002: a closed session is held because nobody has decided who pays.
  | "admin_third_party_decision_needed"
  // Spec 002: coverage confirmed, and the session-cap notices (one left / used up).
  | "client_coverage_confirmed"
  | "client_coverage_cap_warning"
  | "client_coverage_exhausted"
  | "admin_coverage_cap_warning"
  // Spec 002 phase 4: documents sent to an organization.
  | "organization_invoice"
  | "admin_organization_statement_review"
  | "organization_statement"
  // Spec 002 phase 5: getting paid by an organization.
  | "organization_payment_reminder"
  | "organization_payment_received"
  // A refund an admin made to an organization from the invoice screen.
  | "organization_refund"
  // An organization's pre-authorized debit was refused by its bank.
  | "organization_debit_failed"
  | "admin_organization_invoice_overdue"
  | "admin_organization_payment_review"
  | "interac_transfer_instructions"
  | "payment_guarantee_day1_reminder"
  | "payment_guarantee_day2_reminder"
  | "payment_guarantee_48h_client"
  | "payment_guarantee_48h_professional"
  | "fiscal_receipt"
  | "interac_payment_reminder"
  // Professional rate-change requests (spec 001 AC-22).
  | "rate_proposal_submitted"
  | "rate_proposal_decision"
  // Spec 003: showcase pages.
  | "showcase_invitation"
  | "showcase_reminder"
  | "showcase_published"
  | "showcase_changes_requested"
  | "showcase_unpublished"
  | "admin_showcase_submitted"
  // Spec 003 phase 3: direct requests from a showcase page.
  | "direct_request_received"
  | "direct_request_confirmation"
  | "direct_request_unavailable"
  | "admin_direct_request_returned"
  // Spec 003 phase 4: a professional's waitlist.
  | "waitlist_joined"
  | "waitlist_offer"
  | "waitlist_removed";

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
  // Runtime-only (NOT stored on this subdoc): the email helper merges the
  // platform's coordonnées (from PlatformSettings.platformContact) here so the
  // shared email footer can show them on every email.
  contactPhone?: string;
  contactEmail?: string;
  contactAddressLines?: string[];
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

/** Footer social-media hyperlinks (admin-editable). Empty string ⇒ icon hidden. */
export interface ISocialLinks {
  facebook: string;
  x: string;
  instagram: string;
  linkedin: string;
  youtube: string;
  tiktok: string;
}

/** Footer partner logo (admin-editable). Rendered in the scrolling partners band. */
export interface IPartner {
  /** Display/alt text — the partner's name. */
  name: string;
  /** Logo image URL (uploaded `/api/files/<id>` or a relative/absolute URL). */
  logoUrl: string;
  /** Optional outbound link to the partner's site. Empty ⇒ logo is not clickable. */
  linkUrl?: string;
}

/**
 * Seed partner so existing installs keep showing the current "Clinique Averroès"
 * logo until an admin configures the list. Only used as the fallback in
 * getPartners() when the `partners` field is ABSENT (an admin-saved empty list
 * is preserved — i.e. "show no partners").
 */
export const DEFAULT_PARTNERS: IPartner[] = [
  {
    name: "Clinique Averroès de santé mentale",
    logoUrl: "/logocln.png",
    linkUrl: "",
  },
];

/**
 * Every social link starts EMPTY, and empty means "hide that icon".
 *
 * Four of these used to ship as guessed handles — facebook/x/instagram/linkedin
 * all pointing at ".../jechemine". Every one of them was wrong: the real
 * accounts are facebook.com/CAJTerrebonne and linkedin.com/company/je-chemine,
 * x.com/jechemine is a 404, and instagram.com/jechemine is an unrelated empty
 * account. Because the admin settings form round-trips whatever it loads, the
 * first save persisted those guesses into the database, and the public footer
 * sent visitors to a dead profile until 2026-09-07.
 *
 * A default URL is a claim about the outside world that this repository cannot
 * verify, so it makes none. An icon appears only once an admin puts a real URL
 * behind it. Do not "helpfully" restore a handle here — platform-contact.spec.ts
 * fails if any default is a URL.
 */
export const DEFAULT_SOCIAL_LINKS: ISocialLinks = {
  facebook: "",
  x: "",
  instagram: "",
  linkedin: "",
  youtube: "",
  tiktok: "",
};

export interface IPlatformSettings extends Document {
  defaultPricing: {
    solo: number;
    couple: number;
    group: number;
    /** A quick one-time consultation (spec 003). Unset: the individual session's price. */
    quick?: number | null;
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
  /** Footer social-media links (Facebook, X, Instagram, LinkedIn). */
  socialLinks: ISocialLinks;
  /** Footer partner logos shown in the scrolling partners band (admin-editable). */
  partners?: IPartner[];
  /**
   * Adresse(s) recevant les notifications/alertes admin de la plateforme (ex.
   * support@ ou un compte dédié). Si renseignée, elle REMPLACE l'envoi aux
   * comptes admin individuels (séparer par des virgules pour plusieurs). Voir
   * getAdminAlertRecipients() dans notifications.ts. Interne — jamais exposée
   * via l'API publique platform-contact.
   */
  adminAlertEmail?: string;
  /** Spec 002 kill switch: third-party (organization) billing. Off by default. */
  organizationBillingEnabled?: boolean;
  /**
   * Organizations may pay an invoice by pre-authorized bank debit (DPA) from
   * the pay link. Off by default, for a pilot: the bank-account form and the
   * microdeposit path cannot be tested without real Stripe keys.
   */
  organizationPadEnabled?: boolean;
  /**
   * Spec 003 kill switch: the showcase pages (psy<city>.jechemine.ca), their
   * booking requests and waitlists. Off by default: every city host sends its
   * visitors to www and no showcase API answers.
   */
  showcaseEnabled?: boolean;
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
  resource_purchase_complete: {
    enabled: true,
    subject: "Votre ressource est débloquée — Je chemine",
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
  admin_new_service_request: {
    enabled: true,
    subject: "Nouvelle demande de service — Je chemine",
  },
  admin_third_party_decision_needed: {
    enabled: true,
    subject: "Payeur à confirmer — séance clôturée — Je chemine",
  },
  client_coverage_confirmed: {
    enabled: true,
    subject: "Vos séances sont prises en charge — Je chemine",
  },
  client_coverage_cap_warning: {
    enabled: true,
    subject: "Il vous reste une séance couverte — Je chemine",
  },
  client_coverage_exhausted: {
    enabled: true,
    subject: "Vos séances couvertes sont utilisées — Je chemine",
  },
  admin_coverage_cap_warning: {
    enabled: true,
    subject: "Une séance couverte restante — Je chemine",
  },
  admin_organization_statement_review: {
    enabled: true,
    subject: "Factures aux organismes à réviser — Je chemine",
  },
  organization_invoice: {
    enabled: true,
    subject: "Facture — Je chemine",
  },
  organization_statement: {
    enabled: true,
    subject: "Relevé de facturation — Je chemine",
  },
  organization_payment_reminder: {
    enabled: true,
    subject: "Rappel de paiement — Je chemine",
  },
  organization_payment_received: {
    enabled: true,
    subject: "Paiement reçu — Je chemine",
  },
  organization_refund: {
    enabled: true,
    subject: "Remboursement — Je chemine",
  },
  organization_debit_failed: {
    enabled: true,
    subject: "Débit refusé — Je chemine",
  },
  admin_organization_invoice_overdue: {
    enabled: true,
    subject: "Factures aux organismes en retard — Je chemine",
  },
  admin_organization_payment_review: {
    enabled: true,
    subject: "Paiement d’organisme à vérifier — Je chemine",
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
  rate_proposal_submitted: {
    enabled: true,
    subject: "Demande de changement de tarif — Je chemine",
  },
  rate_proposal_decision: {
    enabled: true,
    subject: "Votre demande de tarif — Je chemine",
  },
  showcase_invitation: {
    enabled: true,
    subject: "Votre page vitrine sur Je chemine",
  },
  showcase_reminder: {
    enabled: true,
    subject: "Rappel : votre page vitrine vous attend",
  },
  showcase_published: {
    enabled: true,
    subject: "Votre page vitrine est approuvée",
  },
  showcase_changes_requested: {
    enabled: true,
    subject: "Quelques modifications à votre page vitrine",
  },
  showcase_unpublished: {
    enabled: true,
    subject: "Votre page vitrine est retirée",
  },
  admin_showcase_submitted: {
    enabled: true,
    subject: "Page vitrine à vérifier — Je chemine",
  },
  direct_request_received: {
    enabled: true,
    subject: "Nouvelle demande de rendez-vous",
  },
  direct_request_confirmation: {
    enabled: true,
    subject: "Votre demande de rendez-vous a été envoyée",
  },
  direct_request_unavailable: {
    enabled: true,
    subject: "Votre demande de rendez-vous",
  },
  admin_direct_request_returned: {
    enabled: true,
    subject: "Demande directe revenue — Je chemine",
  },
  waitlist_joined: {
    enabled: true,
    subject: "Vous êtes sur la liste d'attente",
  },
  waitlist_offer: {
    enabled: true,
    subject: "Un créneau s'est libéré",
  },
  waitlist_removed: {
    enabled: true,
    subject: "Votre inscription à la liste d'attente a pris fin",
  },
};

/**
 * Seeded default footer tagline. Exported so the email layer can recognise the
 * un-customised (seed) value and substitute a per-language tagline instead of
 * leaking this English string into French emails. Keep this the single source
 * of truth — never inline the literal elsewhere, or the two can silently drift.
 */
export const DEFAULT_EMAIL_FOOTER_TEXT = "Your journey to wellness starts here.";

const defaultEmailBranding: IEmailBranding = {
  primaryColor: "#8B7355",
  secondaryColor: "#6B5344",
  companyName: "Je chemine",
  footerText: DEFAULT_EMAIL_FOOTER_TEXT,
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
      default: DEFAULT_EMAIL_FOOTER_TEXT,
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
      // A quick one-time consultation (spec 003). Unset: the individual session's price.
      quick: { type: Number, min: 0 },
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
    // Recipient for admin/transactional alerts. Empty ⇒ fall back to admin
    // accounts / ADMIN_ALERT_EMAIL (see getAdminAlertRecipients).
    adminAlertEmail: {
      type: String,
      trim: true,
      default: "",
    },
    organizationBillingEnabled: { type: Boolean, default: false },
    organizationPadEnabled: { type: Boolean, default: false },
    showcaseEnabled: { type: Boolean, default: false },
    // Footer social-media hyperlinks (admin-editable; empty hides the icon).
    socialLinks: {
      facebook: { type: String, trim: true, default: DEFAULT_SOCIAL_LINKS.facebook },
      x: { type: String, trim: true, default: DEFAULT_SOCIAL_LINKS.x },
      instagram: { type: String, trim: true, default: DEFAULT_SOCIAL_LINKS.instagram },
      linkedin: { type: String, trim: true, default: DEFAULT_SOCIAL_LINKS.linkedin },
      youtube: { type: String, trim: true, default: DEFAULT_SOCIAL_LINKS.youtube },
      tiktok: { type: String, trim: true, default: DEFAULT_SOCIAL_LINKS.tiktok },
    },
    // Footer partner logos (admin-editable; rendered in the scrolling band).
    // Absent ⇒ getPartners() falls back to DEFAULT_PARTNERS; an empty array is
    // honored as "show no partners".
    partners: {
      type: [
        {
          name: { type: String, trim: true, default: "" },
          logoUrl: { type: String, trim: true, required: true },
          linkUrl: { type: String, trim: true, default: "" },
        },
      ],
      default: undefined,
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

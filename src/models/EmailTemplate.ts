import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Templates the admin can edit. Add a new key here AND in
 * `src/lib/email-template-registry.ts` (which lists the allowed
 * placeholders and the hardcoded fallback content) to make it editable.
 */
export type EmailTemplateKey =
  | "welcomeClient"
  | "welcomeProfessional"
  | "jumelageSuccess"
  | "reminder72h"
  | "reminder48h"
  | "meetingLinkReady"
  | "paymentFailed"
  | "appointmentConfirmation"
  | "paymentInvitation"
  | "cancellationNotice"
  | "refundConfirmation"
  | "passwordReset"
  | "serviceRequestOnboarding"
  | "referralNewPatient"
  | "referralExistingMember"
  | "guestPaymentConfirmation"
  | "guestPaymentComplete"
  | "appointmentReminderGeneric"
  | "unscheduledMatchReminder"
  | "interacInstructions"
  | "interacReminder"
  | "accountVerification"
  | "passwordSetup"
  | "fiscalReceipt"
  | "postMeetingPayment"
  | "resendInvitation"
  | "appointmentTaken"
  | "paymentGuaranteeDay1"
  | "paymentGuaranteeDay2"
  | "paymentGuarantee48hClient"
  | "paymentGuarantee48hPro"
  | "professionalNewRequest"
  | "professionalApproval"
  | "professionalRejection"
  | "emergencyProSla"
  | "adminInteracTrustRequest"
  | "adminNoPaymentBeforeMeeting"
  | "adminNewServiceRequest"
  | "adminNewProfessionalSignup"
  | "adminAppointmentMovedToGeneral"
  | "adminRequestReturnedToQueue"
  | "adminNewExternalMessage"
  | "adminUnscheduledMatchEscalation"
  | "adminEmergencySlaBreach"
  | "appointmentRescheduled"
  | "appointmentChangeCancelled";

export type EmailTemplateLocale = "fr" | "en";

export interface IEmailTemplate extends Document {
  templateKey: EmailTemplateKey;
  locale: EmailTemplateLocale;
  /** Email Subject header. Supports {{placeholder}} interpolation. */
  subject: string;
  /** Banner heading shown at the top of the email. */
  title: string;
  /** Optional banner subheading. */
  subtitle?: string;
  /** Rich HTML body (TipTap output). Supports {{placeholder}} interpolation. */
  bodyHtml: string;
  /** CTA button label. The button URL is computed at send time in code. */
  ctaText?: string;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateSchema = new Schema<IEmailTemplate>(
  {
    templateKey: {
      type: String,
      enum: [
        "welcomeClient",
        "welcomeProfessional",
        "jumelageSuccess",
        "reminder72h",
        "reminder48h",
        "meetingLinkReady",
        "paymentFailed",
        "appointmentConfirmation",
        "paymentInvitation",
        "cancellationNotice",
        "refundConfirmation",
        "passwordReset",
        "serviceRequestOnboarding",
        "referralNewPatient",
        "referralExistingMember",
        "guestPaymentConfirmation",
        "guestPaymentComplete",
        "appointmentReminderGeneric",
        "unscheduledMatchReminder",
        "interacInstructions",
        "interacReminder",
        "accountVerification",
        "passwordSetup",
        "fiscalReceipt",
        "postMeetingPayment",
        "resendInvitation",
        "appointmentTaken",
        "paymentGuaranteeDay1",
        "paymentGuaranteeDay2",
        "paymentGuarantee48hClient",
        "paymentGuarantee48hPro",
        "professionalNewRequest",
        "professionalApproval",
        "professionalRejection",
        "emergencyProSla",
        "adminInteracTrustRequest",
        "adminNoPaymentBeforeMeeting",
        "adminNewServiceRequest",
        "adminNewProfessionalSignup",
        "adminAppointmentMovedToGeneral",
        "adminRequestReturnedToQueue",
        "adminNewExternalMessage",
        "adminUnscheduledMatchEscalation",
        "adminEmergencySlaBreach",
        "appointmentRescheduled",
        "appointmentChangeCancelled",
      ],
      required: true,
    },
    locale: { type: String, enum: ["fr", "en"], required: true },
    subject: { type: String, required: true },
    title: { type: String, required: true },
    subtitle: { type: String },
    bodyHtml: { type: String, required: true, default: "" },
    ctaText: { type: String },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

EmailTemplateSchema.index(
  { templateKey: 1, locale: 1 },
  { unique: true },
);

const EmailTemplate: Model<IEmailTemplate> =
  mongoose.models.EmailTemplate ||
  mongoose.model<IEmailTemplate>("EmailTemplate", EmailTemplateSchema);

export default EmailTemplate;

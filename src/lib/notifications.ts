/**
 * Email notification utilities for appointment scheduling
 * Uses nodemailer with SMTP for sending emails
 * Configurable from admin portal via PlatformSettings
 */

import nodemailer from "nodemailer";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import PlatformSettings, {
  type EmailNotificationType,
  type IEmailSettings,
  type IEmailBranding,
  getDefaultEmailSettings,
} from "@/models/PlatformSettings";

// =============================================================================
// Types
// =============================================================================

interface EmailData {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: {
    filename: string;
    content: Buffer;
    contentType?: string;
  }[];
}

interface BaseAppointmentData {
  date?: string;
  time?: string;
  duration: number;
  type: "video" | "in-person" | "phone" | "both";
}

interface AppointmentEmailData extends BaseAppointmentData {
  clientName: string;
  clientEmail: string;
  professionalName?: string;
  professionalEmail: string;
  meetingLink?: string;
  location?: string;
}

interface GuestBookingEmailData extends BaseAppointmentData {
  guestName: string;
  guestEmail: string;
  professionalName?: string;
  therapyType: "solo" | "couple" | "group";
  price: number;
  meetingLink?: string;
  paymentLink?: string;
  /** UI locale for service-request thank-you / onboarding copy */
  locale?: "fr" | "en";
  bookingFor?: "self" | "patient" | "loved-one";
  lovedOneIsMinor?: boolean;
}

interface MeetingLinkEmailData {
  guestName: string;
  guestEmail: string;
  professionalName?: string;
  date?: string;
  time?: string;
  duration: number;
  type: "video" | "in-person" | "phone" | "both";
  meetingLink: string;
}

interface WelcomeEmailData {
  name: string;
  email: string;
  role: "client" | "professional" | "guest" | "prospect";
  locale?: "fr" | "en";
}

interface AccountEmailVerificationData {
  name: string;
  email: string;
  verifyUrl: string;
}

interface PasswordResetEmailData {
  name: string;
  email: string;
  resetLink: string;
}

interface PaymentEmailData {
  name: string;
  email: string;
  amount: number;
  appointmentDate?: string;
  appointmentTime?: string;
  professionalName?: string;
}

interface ProfessionalStatusEmailData {
  name: string;
  email: string;
  reason?: string;
}

type EmailTheme = "success" | "info" | "warning" | "danger";

// =============================================================================
// Settings Cache
// =============================================================================

let cachedEmailSettings: IEmailSettings | null = null;
let settingsCacheTime: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

async function getEmailSettings(): Promise<IEmailSettings> {
  const now = Date.now();

  // Return cached settings if still valid
  if (cachedEmailSettings && now - settingsCacheTime < CACHE_TTL_MS) {
    return cachedEmailSettings;
  }

  try {
    await connectToDatabase();
    const settings = await PlatformSettings.findOne().lean();

    if (settings?.emailSettings) {
      // Handle the templates Map from MongoDB
      const templates =
        settings.emailSettings.templates instanceof Map
          ? Object.fromEntries(settings.emailSettings.templates)
          : settings.emailSettings.templates;

      cachedEmailSettings = {
        ...settings.emailSettings,
        templates: templates as IEmailSettings["templates"],
      };
      settingsCacheTime = now;
      return cachedEmailSettings;
    }
  } catch (error) {
    console.error("Error fetching email settings:", error);
  }

  // Return defaults if database fetch fails
  return getDefaultEmailSettings();
}

// Clear cache (call when settings are updated)
export function clearEmailSettingsCache(): void {
  cachedEmailSettings = null;
  settingsCacheTime = 0;
}

// =============================================================================
// Configuration & Transport
// =============================================================================

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// =============================================================================
// Formatting Helpers
// =============================================================================

const formatEmailDate = (dateString?: string): string => {
  if (!dateString) return "To be scheduled";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "To be scheduled";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const formatTime = (time?: string): string => {
  return time || "To be scheduled";
};

const formatProfessionalName = (name?: string): string => {
  return name || "To be assigned";
};

const formatAppointmentType = (
  type: "video" | "in-person" | "phone" | "both",
  lang: "fr" | "en" = "en",
): string => {
  if (lang === "fr") {
    const fr: Record<string, string> = {
      video: "Appel vidéo",
      "in-person": "En personne",
      phone: "Appel téléphonique",
      both: "Ouvert pour les deux (vidéo ou en personne)",
    };
    return fr[type] || type;
  }
  const types: Record<string, string> = {
    video: "Video Call",
    "in-person": "In-Person",
    phone: "Phone Call",
    both: "Open to both (video or in-person)",
  };
  return types[type] || type;
};

const formatSessionType = (type?: "solo" | "couple" | "group"): string => {
  const types: Record<string, string> = {
    solo: "Individual Session",
    couple: "Couple Session",
    group: "Group Session",
  };
  return types[type || "solo"] || "Individual Session";
};

// =============================================================================
// Theme Colors (configurable via branding)
// =============================================================================

const getThemeColors = (
  theme: EmailTheme,
  branding?: IEmailBranding,
): { primary: string; secondary: string; bg: string; text: string } => {
  const primaryColor = branding?.primaryColor || "#8B7355";
  const secondaryColor = branding?.secondaryColor || "#6B5344";

  const themes = {
    success: {
      primary: "#22c55e",
      secondary: "#16a34a",
      bg: "#f0fdf4",
      text: "#166534",
    },
    info: {
      primary: primaryColor,
      secondary: secondaryColor,
      bg: "#faf8f6",
      text: "#5c4a3a",
    },
    warning: {
      primary: "#f59e0b",
      secondary: "#d97706",
      bg: "#fffbeb",
      text: "#92400e",
    },
    danger: {
      primary: "#ef4444",
      secondary: "#dc2626",
      bg: "#fef2f2",
      text: "#991b1b",
    },
  };

  return themes[theme] || themes.info;
};

// =============================================================================
// Email Template Components
// =============================================================================

const getBaseStyles = (branding?: IEmailBranding): string => {
  const primaryColor = branding?.primaryColor || "#8B7355";

  return `
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${primaryColor}; }
    .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #666; font-size: 14px; }
    .detail-value { font-weight: 600; color: #333; }
    .button { display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, ${branding?.secondaryColor || "#6B5344"} 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 25px; margin: 20px 0; font-weight: 500; }
    .footer { text-align: center; color: #666; font-size: 12px; padding: 20px; }
    .footer a { color: ${primaryColor}; text-decoration: none; }
  `;
};

const createHeader = (
  title: string,
  subtitle?: string,
  theme: EmailTheme = "info",
  branding?: IEmailBranding,
): string => {
  const colors = getThemeColors(theme, branding);
  return `
    <div class="header" style="background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
      ${branding?.logoUrl ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="max-height: 40px; margin-bottom: 15px;">` : ""}
      <h1 style="margin: 0; font-weight: 300; font-size: 28px;">${title}</h1>
      ${subtitle ? `<p style="margin: 10px 0 0; opacity: 0.9; font-size: 16px;">${subtitle}</p>` : ""}
    </div>
  `;
};

const createDetailRow = (
  label: string,
  value: string,
  isLink = false,
  branding?: IEmailBranding,
): string => {
  const primaryColor = branding?.primaryColor || "#8B7355";
  const valueHtml = isLink
    ? `<a href="${value}" style="color: ${primaryColor};">${value.includes("Join") ? "Join Session" : value}</a>`
    : value;
  return `
    <div class="detail-row">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${valueHtml}</span>
    </div>
  `;
};

const createDetailsSection = (
  details: Array<{ label: string; value: string; isLink?: boolean }>,
  borderColor = "#8B7355",
  branding?: IEmailBranding,
): string => {
  const rows = details
    .map((d) => createDetailRow(d.label, d.value, d.isLink, branding))
    .join("");
  return `<div class="details" style="border-left-color: ${borderColor};">${rows}</div>`;
};

const createPriceSection = (
  amount: number,
  note: string,
  theme: EmailTheme = "info",
  currency: string,
  branding?: IEmailBranding,
): string => {
  const colors = getThemeColors(theme, branding);
  return `
    <div style="background: ${colors.primary}; color: white; padding: 15px 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <div style="font-size: 24px; font-weight: 600;">$${amount.toFixed(2)} ${currency}</div>
      <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">${note}</div>
    </div>
  `;
};

const createInfoBox = (
  title: string,
  content: string,
  theme: EmailTheme = "info",
  branding?: IEmailBranding,
): string => {
  const colors = getThemeColors(theme, branding);
  return `
    <div style="background: ${colors.bg}; border: 1px solid ${colors.primary}40; padding: 15px 20px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin: 0 0 10px; color: ${colors.primary}; font-size: 16px;">${title}</h3>
      <p style="margin: 0; color: ${colors.text}; font-size: 14px;">${content}</p>
    </div>
  `;
};

const createButton = (
  text: string,
  url: string,
  branding?: IEmailBranding,
): string => {
  const primaryColor = branding?.primaryColor || "#8B7355";
  const secondaryColor = branding?.secondaryColor || "#6B5344";
  return `<div style="text-align: center;"><a href="${url}" style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 25px; margin: 20px 0; font-weight: 500;">${text}</a></div>`;
};

const createFooter = (branding?: IEmailBranding): string => {
  const year = new Date().getFullYear();
  const url = process.env.NEXTAUTH_URL || "";
  const companyName = branding?.companyName || "JeChemine";
  const footerText =
    branding?.footerText || "Your journey to wellness starts here.";
  const primaryColor = branding?.primaryColor || "#8B7355";

  return `
    <div class="footer">
      <p style="margin: 0 0 5px;">${footerText}</p>
      <p style="margin: 0;">&copy; ${year} ${companyName}. All rights reserved.</p>
      <p style="margin: 10px 0 0;"><a href="${url}" style="color: ${primaryColor};">Visit our website</a></p>
    </div>
  `;
};

const createBadge = (
  text: string,
  theme: EmailTheme = "success",
  branding?: IEmailBranding,
): string => {
  const colors = getThemeColors(theme, branding);
  return `<span style="display: inline-block; background: ${colors.bg}; color: ${colors.text}; padding: 8px 16px; border-radius: 20px; font-size: 14px;">${text}</span>`;
};

// =============================================================================
// Email Template Builder
// =============================================================================

interface EmailTemplateOptions {
  title: string;
  subtitle?: string;
  theme?: EmailTheme;
  greeting: string;
  intro: string;
  details?: Array<{ label: string; value: string; isLink?: boolean }>;
  detailsBorderColor?: string;
  price?: { amount: number; note: string; theme?: EmailTheme; currency?: string };
  infoBox?: { title: string; content: string; theme?: EmailTheme };
  badge?: { text: string; theme?: EmailTheme };
  button?: { text: string; url: string };
  /** Optional second CTA (e.g. invite guest to create a full client account) */
  secondaryButton?: { preamble?: string; text: string; url: string };
  outro?: string;
  branding?: IEmailBranding;
}

const buildEmailHtml = (options: EmailTemplateOptions): string => {
  const {
    title,
    subtitle,
    theme = "info",
    greeting,
    intro,
    details,
    detailsBorderColor,
    price,
    infoBox,
    badge,
    button,
    secondaryButton,
    outro,
    branding,
  } = options;

  const colors = getThemeColors(theme, branding);

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>${getBaseStyles(branding)}</style>
      </head>
      <body>
        <div class="container">
          ${createHeader(title, subtitle, theme, branding)}
          <div class="content">
            ${badge ? `<div style="text-align: center; margin-bottom: 20px;">${createBadge(badge.text, badge.theme, branding)}</div>` : ""}
            <p>${greeting}</p>
            <p>${intro}</p>
            ${details ? createDetailsSection(details, detailsBorderColor || colors.primary, branding) : ""}
            ${price ? createPriceSection(price.amount, price.note, price.theme || theme, price.currency!, branding) : ""}
            ${infoBox ? createInfoBox(infoBox.title, infoBox.content, infoBox.theme, branding) : ""}
            ${button ? createButton(button.text, button.url, branding) : ""}
            ${
              secondaryButton
                ? `
            <div style="margin-top: 28px; padding-top: 24px; border-top: 1px solid #eee;">
              ${secondaryButton.preamble ? `<p style="margin: 0 0 16px; font-size: 15px; color: #333;">${secondaryButton.preamble}</p>` : ""}
              ${createButton(secondaryButton.text, secondaryButton.url, branding)}
            </div>`
                : ""
            }
            ${outro ? `<p style="color: #666; font-size: 14px;">${outro}</p>` : ""}
          </div>
          ${createFooter(branding)}
        </div>
      </body>
    </html>
  `;
};

const buildEmailText = (sections: string[]): string => {
  return (
    sections.filter(Boolean).join("\n\n") +
    `\n\n© ${new Date().getFullYear()} JeChemine. All rights reserved.`
  );
};

// =============================================================================
// Email Sender
// =============================================================================

const sendEmail = async (
  data: EmailData,
  emailType: EmailNotificationType,
): Promise<boolean> => {
  try {
    const settings = await getEmailSettings();

    // Check if emails are globally enabled
    if (!settings.enabled) {
      console.log("Email notifications are disabled globally");
      return false;
    }

    // Check if this specific email type is enabled
    const templateConfig = settings.templates[emailType];
    if (templateConfig && !templateConfig.enabled) {
      console.log(`Email type "${emailType}" is disabled`);
      return false;
    }

    // Check SMTP configuration
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS
    ) {
      console.log("SMTP not configured. Email would be sent:", {
        to: data.to,
        subject: data.subject,
        type: emailType,
      });
      return true;
    }

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"${settings.branding?.companyName || "JeChemine"}" <${process.env.SMTP_USER}>`,
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.text,
      attachments: data.attachments,
    });

    console.log(`Email sent successfully [${emailType}] to:`, data.to);
    return true;
  } catch (error) {
    console.error(`Error sending email [${emailType}]:`, error);
    return false;
  }
};

// Helper to get subject from settings or use default
async function getSubject(
  emailType: EmailNotificationType,
  defaultSubject: string,
): Promise<string> {
  const settings = await getEmailSettings();
  return settings.templates[emailType]?.subject || defaultSubject;
}

// Helper to get currency
async function getCurrency(): Promise<string> {
  try {
    await connectToDatabase();
    const settings = await PlatformSettings.findOne().lean();
    return settings?.currency || "CAD";
  } catch {
    return "CAD";
  }
}

// Helper to get branding
async function getBranding(): Promise<IEmailBranding | undefined> {
  try {
    await connectToDatabase();
    const settings = await PlatformSettings.findOne().lean();
    return settings?.emailSettings?.branding;
  } catch {
    return undefined;
  }
}

// =============================================================================
// Public Email Functions - Authentication
// =============================================================================

export async function sendAccountEmailVerificationEmail(
  data: AccountEmailVerificationData,
): Promise<boolean> {
  const branding = await getBranding();
  const html = buildEmailHtml({
    title: "Confirmez votre adresse courriel",
    subtitle: "Lien valide 15 minutes",
    theme: "info",
    greeting: `Bonjour ${data.name},`,
    intro:
      "Pour sécuriser votre compte, veuillez confirmer votre adresse courriel en cliquant sur le bouton ci-dessous. Ensuite, vous devrez valider votre numéro de téléphone par code SMS.",
    button: { text: "Confirmer mon courriel", url: data.verifyUrl },
    outro:
      "Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message.",
    branding,
  });
  const text = buildEmailText([
    "Confirmez votre adresse courriel",
    `Bonjour ${data.name},`,
    "Ouvrez ce lien (valide 15 minutes) pour continuer :",
    data.verifyUrl,
  ]);
  const subject = await getSubject(
    "email_verification",
    "Confirmez votre courriel - JeChemine",
  );
  return sendEmail(
    { to: data.email, subject, html, text },
    "email_verification",
  );
}

export async function sendWelcomeEmail(
  data: WelcomeEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/${data.role}/dashboard`;

  const roleMessages: Record<string, string> = {
    client:
      "Vous pouvez maintenant consulter les professionnels, réserver des rendez-vous et accéder aux ressources pour soutenir votre parcours de mieux-être.",
    professional:
      "Votre compte est en attente d'approbation. Une fois approuvé, vous pourrez gérer vos rendez-vous, vous connecter avec des clients et développer votre pratique.",
    guest: "Vous pouvez suivre votre rendez-vous et recevoir des mises à jour par courriel.",
  };

  const html = buildEmailHtml({
    title: "Bienvenue !",
    subtitle: `Vous avez rejoint ${branding?.companyName || "JeChemine"}`,
    theme: "success",
    greeting: `Bonjour ${data.name},`,
    intro: `Merci d'avoir créé votre compte. ${roleMessages[data.role] || ""}`,
    button:
      data.role !== "guest" && data.role !== "prospect"
        ? { text: "Accéder au tableau de bord", url: dashboardUrl }
        : undefined,
    outro:
      "Si vous avez des questions, n'hésitez pas à contacter notre équipe de soutien.",
    branding,
  });

  const text = buildEmailText([
    `Bienvenue sur ${branding?.companyName || "JeChemine"} !`,
    `Bonjour ${data.name},`,
    `Merci d'avoir créé votre compte.`,
    roleMessages[data.role] || "",
    data.role !== "guest" && data.role !== "prospect" ? `Accédez à votre tableau de bord : ${dashboardUrl}` : "",
  ]);

  const subject = await getSubject("welcome", "Bienvenue sur JeChemine !");

  return sendEmail({ to: data.email, subject, html, text }, "welcome");
}

export async function sendPasswordResetEmail(
  data: PasswordResetEmailData,
): Promise<boolean> {
  const branding = await getBranding();

  const html = buildEmailHtml({
    title: "Réinitialisation du mot de passe",
    theme: "info",
    greeting: `Bonjour ${data.name},`,
    intro:
      "Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe.",
    button: { text: "Réinitialiser mon mot de passe", url: data.resetLink },
    infoBox: {
      title: "Vous n'avez pas fait cette demande ?",
      content:
        "Si vous n'avez pas demandé de réinitialisation, ignorez simplement ce message. Votre mot de passe reste inchangé.",
      theme: "warning",
    },
    outro: "Ce lien expirera dans 1 heure pour des raisons de sécurité.",
    branding,
  });

  const text = buildEmailText([
    "Demande de réinitialisation du mot de passe",
    `Bonjour ${data.name},`,
    "Nous avons reçu une demande de réinitialisation de votre mot de passe.",
    `Réinitialisez votre mot de passe : ${data.resetLink}`,
    "Ce lien expirera dans 1 heure.",
    "Si vous n'avez pas fait cette demande, ignorez ce message.",
  ]);

  const subject = await getSubject(
    "password_reset",
    "Réinitialisation de votre mot de passe — JeChemine",
  );

  return sendEmail({ to: data.email, subject, html, text }, "password_reset");
}

// =============================================================================
// Public Email Functions - Guest Booking
// =============================================================================

export async function sendGuestBookingConfirmation(
  data: GuestBookingEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const baseUrl = process.env.NEXTAUTH_URL || "";
  const memberSignupUrl = `${baseUrl}/signup/member?email=${encodeURIComponent(data.guestEmail)}`;
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const professionalName = formatProfessionalName(data.professionalName);
  const sessionType = formatSessionType(data.therapyType);
  const isPendingSchedule = !data.date || !data.time || !data.professionalName;
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";
  const appointmentType = formatAppointmentType(data.type, lang);

  const isSelfServiceRequest =
    isPendingSchedule && data.bookingFor === "self";

  if (isSelfServiceRequest) {
    const intro =
      lang === "fr"
        ? "Merci de votre demande. Pour accélérer votre jumelage, complétez votre profil en suivant le lien ci-dessous."
        : "Thank you for your request. To speed up your matching, complete your profile using the link below.";

    const nextSteps =
      lang === "fr"
        ? "Un professionnel vous sera proposé sous peu. Vous recevrez un autre courriel lorsque votre demande progressera."
        : "A professional will be assigned to you soon. You will receive another email as your request moves forward.";

    const detailLabels =
      lang === "fr"
        ? {
            session: "Type de séance",
            modality: "Modalité",
            professional: "Professionnel",
            date: "Date",
            time: "Heure",
            duration: "Durée",
          }
        : {
            session: "Session type",
            modality: "Modality",
            professional: "Professional",
            date: "Date",
            time: "Time",
            duration: "Duration",
          };

    const html = buildEmailHtml({
      title:
        lang === "fr" ? "Demande de service reçue" : "Service request received",
      subtitle:
        lang === "fr"
          ? "Nous traitons votre demande"
          : "We are processing your request",
      theme: "info",
      badge: {
        text: lang === "fr" ? "⏳ En attente de jumelage" : "⏳ Pending matching",
        theme: "warning",
      },
      greeting:
        lang === "fr"
          ? `Bonjour ${data.guestName},`
          : `Dear ${data.guestName},`,
      intro,
      details: [
        { label: detailLabels.session, value: sessionType },
        { label: detailLabels.modality, value: appointmentType },
        { label: detailLabels.professional, value: professionalName },
        { label: detailLabels.date, value: formattedDate },
        { label: detailLabels.time, value: formattedTime },
        {
          label: detailLabels.duration,
          value:
            lang === "fr"
              ? `${data.duration} minutes`
              : `${data.duration} minutes`,
        },
      ],
      infoBox: {
        title: lang === "fr" ? "Ensuite" : "Next steps",
        content: nextSteps,
      },
      button: {
        text:
          lang === "fr"
            ? "Compléter mon profil (onboarding)"
            : "Complete my profile (onboarding)",
        url: memberSignupUrl,
      },
      secondaryButton: {
        preamble:
          lang === "fr"
            ? "Vous pouvez aussi créer un compte membre sécurisé avec la même adresse courriel pour suivre vos rendez-vous."
            : "You can also create a secure member account with the same email to track your appointments.",
        text:
          lang === "fr" ? "Créer mon compte membre" : "Create my member account",
        url: memberSignupUrl,
      },
      outro:
        lang === "fr"
          ? "Merci de votre confiance."
          : "Thank you for choosing us.",
      branding,
    });

    const text = buildEmailText([
      lang === "fr" ? "Demande de service reçue" : "Service request received",
      lang === "fr"
        ? `Bonjour ${data.guestName},`
        : `Dear ${data.guestName},`,
      intro,
      `${detailLabels.session}: ${sessionType}`,
      `${detailLabels.modality}: ${appointmentType}`,
      nextSteps,
      lang === "fr" ? "Lien onboarding (profil)" : "Onboarding link (profile)",
      memberSignupUrl,
    ]);

    const subject =
      lang === "fr"
        ? "Merci pour votre demande — Je Chemine"
        : "Thank you for your request — Je Chemine";

    return sendEmail(
      { to: data.guestEmail, subject, html, text },
      "guest_booking_confirmation",
    );
  }

  // Loved-one booking (pending assignment):
  // - child (<18): send onboarding link to the requester immediately
  // - adult (>18): keep dossier pending until admin decides where to send the link
  if (isPendingSchedule && data.bookingFor === "loved-one") {
    if (data.lovedOneIsMinor) {
      const intro =
        lang === "fr"
          ? "Merci de votre demande. Pour accélérer votre jumelage, complétez votre profil en suivant le lien ci-dessous."
          : "Thank you for your request. To speed up your matching, complete your profile using the link below.";

      const nextSteps =
        lang === "fr"
          ? "Un professionnel vous sera proposé sous peu."
          : "A professional will be assigned to you soon.";

      const detailLabels =
        lang === "fr"
          ? {
              session: "Type de séance",
              modality: "Modalité",
              professional: "Professionnel",
              date: "Date",
              time: "Heure",
              duration: "Durée",
            }
          : {
              session: "Session type",
              modality: "Modality",
              professional: "Professional",
              date: "Date",
              time: "Time",
              duration: "Duration",
            };

      const html = buildEmailHtml({
        title: lang === "fr" ? "Demande de service reçue" : "Service request received",
        subtitle: lang === "fr" ? "Nous traitons votre demande" : "We are processing your request",
        theme: "info",
        badge: {
          text: lang === "fr" ? "⏳ En attente de jumelage" : "⏳ Pending matching",
          theme: "warning",
        },
        greeting: lang === "fr" ? `Bonjour ${data.guestName},` : `Dear ${data.guestName},`,
        intro,
        details: [
          { label: detailLabels.session, value: sessionType },
          { label: detailLabels.modality, value: appointmentType },
          { label: detailLabels.professional, value: professionalName },
          { label: detailLabels.date, value: formattedDate },
          { label: detailLabels.time, value: formattedTime },
          { label: detailLabels.duration, value: `${data.duration} minutes` },
        ],
        infoBox: {
          title: lang === "fr" ? "Ensuite" : "Next steps",
          content: nextSteps,
        },
        button: {
          text: lang === "fr" ? "Compléter mon profil (onboarding)" : "Complete my profile (onboarding)",
          url: memberSignupUrl,
        },
        branding,
      });

      const text = buildEmailText([
        lang === "fr" ? "Demande de service reçue" : "Service request received",
        lang === "fr" ? `Bonjour ${data.guestName},` : `Dear ${data.guestName},`,
        intro,
        `Duration: ${data.duration} minutes`,
        nextSteps,
        lang === "fr" ? "Lien onboarding (profil)" : "Onboarding link (profile)",
        memberSignupUrl,
      ]);

      const subject =
        lang === "fr"
          ? "Merci pour votre demande — Je Chemine"
          : "Thank you for your request — Je Chemine";

      return sendEmail(
        { to: data.guestEmail, subject, html, text },
        "guest_booking_confirmation",
      );
    }

    // Adult (>18): no onboarding link until admin decision
    const intro =
      lang === "fr"
        ? "Merci de votre demande. Votre dossier est en attente de validation par l’Admin. Selon votre situation, le lien de compte sera envoyé au demandeur ou directement au proche."
        : "Thank you for your request. Your file is pending admin validation. Depending on your situation, the account link will be sent to the requester or directly to the loved one.";

    const nextSteps =
      lang === "fr"
        ? "Un administrateur examinera votre demande avant l’envoi du lien de compte."
        : "An admin will review your request before sending the account link.";

    const html = buildEmailHtml({
      title: lang === "fr" ? "Demande de service reçue" : "Service request received",
      subtitle: lang === "fr" ? "Nous traitons votre demande" : "We are processing your request",
      theme: "info",
      badge: {
        text: lang === "fr" ? "⏳ En attente de validation" : "⏳ Pending admin validation",
        theme: "warning",
      },
      greeting: lang === "fr" ? `Bonjour ${data.guestName},` : `Dear ${data.guestName},`,
      intro,
      details: [
        { label: "Type de séance", value: sessionType },
        { label: "Type de rendez-vous", value: appointmentType },
        { label: "Professionnel", value: professionalName },
        { label: "Date", value: formattedDate },
        { label: "Heure", value: formattedTime },
        { label: "Durée", value: `${data.duration} minutes` },
      ],
      infoBox: {
        title: lang === "fr" ? "Ensuite" : "Next steps",
        content: nextSteps,
      },
      branding,
    });

    const text = buildEmailText([
      lang === "fr" ? "Demande de service reçue" : "Service request received",
      lang === "fr" ? `Bonjour ${data.guestName},` : `Dear ${data.guestName},`,
      intro,
      nextSteps,
    ]);

    const subject =
      lang === "fr"
        ? "Demande en attente de validation — Je Chemine"
        : "Request pending admin validation — Je Chemine";

    return sendEmail(
      { to: data.guestEmail, subject, html, text },
      "guest_booking_confirmation",
    );
  }

  const intro = isPendingSchedule
    ? "Nous avons reçu votre demande de réservation et nous vous associerons bientôt à un professionnel."
    : "Votre demande de réservation a été reçue et est en cours de traitement.";

  const nextSteps = isPendingSchedule
    ? "Un professionnel vous sera assigné prochainement. Vous recevrez un autre courriel avec les détails de paiement une fois confirmé."
    : "Veuillez attendre la confirmation de votre professionnel assigné. Vous recevrez les instructions de paiement une fois votre rendez-vous confirmé.";

  const appointmentTypeFr = formatAppointmentType(data.type, "fr");

  const html = buildEmailHtml({
    title: "Demande de réservation reçue",
    subtitle: isPendingSchedule
      ? "Nous trouverons le bon professionnel pour vous"
      : "Détails de votre séance",
    theme: "info",
    badge: {
      text: isPendingSchedule
        ? "⏳ En attente d'attribution"
        : "📅 En attente de confirmation",
      theme: "warning",
    },
    greeting: `Bonjour ${data.guestName},`,
    intro,
    details: [
      { label: "Type de séance", value: sessionType },
      { label: "Type de rendez-vous", value: appointmentTypeFr },
      { label: "Professionnel", value: professionalName },
      { label: "Date", value: formattedDate },
      { label: "Heure", value: formattedTime },
      { label: "Durée", value: `${data.duration} minutes` },
    ],
    infoBox: {
      title: "Prochaines étapes",
      content: nextSteps,
    },
    secondaryButton: {
      preamble:
        "Créez votre compte membre sécurisé Je Chemine avec le même courriel utilisé pour cette demande. Vous compléterez votre profil détaillé (informations cliniques de base) pour aider votre professionnel à préparer votre prise en charge.",
      text: "Créer mon compte sécurisé",
      url: memberSignupUrl,
    },
    outro:
      "Merci de nous faire confiance. Nous vous contacterons bientôt avec plus de détails.",
    branding,
  });

  const textNextSteps = isPendingSchedule
    ? [
        "PROCHAINES ÉTAPES :",
        "1. Un professionnel vous sera assigné prochainement",
        "2. Vous recevrez une confirmation avec les détails de paiement",
        "3. Complétez le paiement pour sécuriser votre rendez-vous",
        "4. Recevez votre lien de réunion avant la séance",
      ]
    : [
        "PROCHAINES ÉTAPES :",
        "1. Attendez la confirmation du professionnel",
        "2. Vous recevrez les instructions de paiement une fois confirmé",
        "3. Complétez le paiement pour sécuriser votre rendez-vous",
        "4. Recevez votre lien de réunion avant la séance",
      ];

  const text = buildEmailText([
    "Demande de réservation reçue",
    `Bonjour ${data.guestName},`,
    intro,
    "DÉTAILS DE LA SÉANCE :",
    `Type de séance : ${sessionType}`,
    `Type de rendez-vous : ${appointmentTypeFr}`,
    `Professionnel : ${professionalName}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    `Durée : ${data.duration} minutes`,
    ...textNextSteps,
    "CRÉER VOTRE COMPTE SÉCURISÉ :",
    "Utilisez le lien ci-dessous pour vous inscrire et compléter votre profil clinique détaillé (même courriel que cette demande) :",
    memberSignupUrl,
  ]);

  const subject = await getSubject(
    "guest_booking_confirmation",
    "Demande de réservation reçue — JeChemine",
  );

  return sendEmail(
    { to: data.guestEmail, subject, html, text },
    "guest_booking_confirmation",
  );
}

// =============================================================================
// Public Email Functions - Service request onboarding link (admin approval)
// =============================================================================

export async function sendServiceRequestOnboardingEmail(data: {
  toName: string;
  toEmail: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";
  const baseUrl = process.env.NEXTAUTH_URL || "";
  const memberSignupUrl = `${baseUrl}/signup/member?email=${encodeURIComponent(
    data.toEmail,
  )}`;

  const intro =
    lang === "fr"
      ? "Merci de votre demande. Pour accélérer votre jumelage, complétez votre profil ici."
      : "Thank you for your request. To speed up your matching, complete your profile here.";

  const html = buildEmailHtml({
    title: lang === "fr" ? "Demande reçue" : "Request received",
    subtitle: lang === "fr" ? "Onboarding du profil" : "Profile onboarding",
    theme: "info",
    badge: {
      text: lang === "fr" ? "✅ Action requise" : "✅ Action needed",
      theme: "success",
    },
    greeting: lang === "fr" ? `Bonjour ${data.toName},` : `Dear ${data.toName},`,
    intro,
    infoBox: {
      title: lang === "fr" ? "Étapes suivantes" : "Next steps",
      content:
        lang === "fr"
          ? "Complétez votre profil pour accélérer votre jumelage."
          : "Complete your profile to speed up your matching.",
    },
    button: {
      text:
        lang === "fr" ? "Compléter votre profil" : "Complete your profile",
      url: memberSignupUrl,
    },
    outro: lang === "fr" ? "Merci de votre confiance." : "Thank you for your trust.",
    branding,
  });

  const text = buildEmailText([
    lang === "fr" ? "Demande reçue" : "Request received",
    lang === "fr" ? `Bonjour ${data.toName},` : `Dear ${data.toName},`,
    intro,
    lang === "fr" ? "Lien onboarding :" : "Onboarding link:",
    memberSignupUrl,
    lang === "fr"
      ? "Complétez votre profil pour accélérer votre jumelage."
      : "Complete your profile to speed up your matching.",
  ]);

  const subject =
    lang === "fr"
      ? "Merci pour votre demande — Je Chemine"
      : "Thank you for your request — Je Chemine";

  return sendEmail(
    { to: data.toEmail, subject, html, text },
    "service_request_onboarding",
  );
}

export async function sendGuestPaymentConfirmation(
  data: GuestBookingEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const professionalName = formatProfessionalName(data.professionalName);
  const sessionType = formatSessionType(data.therapyType);
  const appointmentType = formatAppointmentType(data.type);

  const details = [
    { label: "Type de séance", value: sessionType },
    { label: "Type de rendez-vous", value: appointmentType },
    { label: "Professionnel", value: professionalName },
    { label: "Date", value: formattedDate },
    { label: "Heure", value: formattedTime },
    { label: "Durée", value: `${data.duration} minutes` },
  ];

  const html = buildEmailHtml({
    title: "Prochaine étape : confirmez votre rendez-vous",
    subtitle: "Votre professionnel a confirmé votre séance",
    theme: "info",
    badge: { text: "✅ Rendez-vous confirmé", theme: "success" },
    greeting: `Bonjour ${data.guestName},`,
    intro:
      "Votre rendez-vous est confirmé. Ouvrez le lien sécurisé ci-dessous pour ajouter vos coordonnées de paiement (carte, virement Interac via Stripe, ou prélèvement automatique canadien). Aucun montant n'est prélevé avant que votre séance ait eu lieu et que votre professionnel la marque comme complétée. Stripe traite vos informations bancaires — nous ne les stockons pas.",
    details,
    detailsBorderColor: branding?.primaryColor,
    price: {
      amount: data.price,
      note: "Frais de séance (prélevés après la séance complétée)",
      theme: "info",
      currency,
    },
    button: data.paymentLink
      ? { text: "Confirmer avec mes coordonnées de paiement", url: data.paymentLink }
      : undefined,
    infoBox: {
      title: "Paiements sécurisés avec Stripe",
      content:
        "Une fois votre moyen de paiement enregistré, vous pourrez accéder à votre lien de réunion. Le paiement n'est traité qu'après la complétion de la séance.",
    },
    outro:
      "Si vous avez besoin d'aide, contactez-nous via les coordonnées indiquées sur notre site web.",
    branding,
  });

  const text = buildEmailText([
    "Confirmez votre rendez-vous (paiement après la séance)",
    `Bonjour ${data.guestName},`,
    "Votre rendez-vous est confirmé. Utilisez votre lien personnel pour ajouter un moyen de paiement. Vous ne serez facturé qu'après la complétion de la séance. Stripe gère vos coordonnées bancaires.",
    "DÉTAILS DE LA SÉANCE :",
    `Type de séance : ${sessionType}`,
    `Type de rendez-vous : ${appointmentType}`,
    `Professionnel : ${professionalName}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    `Durée : ${data.duration} minutes`,
    `Montant dû : ${data.price.toFixed(2)} $ ${currency}`,
    data.paymentLink ? `Confirmer le paiement : ${data.paymentLink}` : "",
  ]);

  const subject = await getSubject(
    "guest_payment_confirmation",
    "Votre rendez-vous est confirmé — prochaine étape",
  );

  return sendEmail(
    { to: data.guestEmail, subject, html, text },
    "guest_payment_confirmation",
  );
}

export async function sendGuestPaymentComplete(
  data: GuestBookingEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const professionalName = formatProfessionalName(data.professionalName);
  const sessionType = formatSessionType(data.therapyType);
  const appointmentType = formatAppointmentType(data.type);

  const details: Array<{ label: string; value: string; isLink?: boolean }> = [
    { label: "Type de séance", value: sessionType },
    { label: "Type de rendez-vous", value: appointmentType },
    { label: "Professionnel", value: professionalName },
    { label: "Date", value: formattedDate },
    { label: "Heure", value: formattedTime },
    { label: "Durée", value: `${data.duration} minutes` },
  ];

  if (data.meetingLink) {
    details.push({
      label: "Lien de réunion",
      value: data.meetingLink,
      isLink: true,
    });
  }

  const html = buildEmailHtml({
    title: "Paiement confirmé",
    subtitle: "Vous êtes prêt pour votre séance",
    theme: "success",
    badge: { text: "💳 Paiement complété", theme: "success" },
    greeting: `Bonjour ${data.guestName},`,
    intro:
      "Merci ! Votre paiement a été traité avec succès. Votre rendez-vous est maintenant pleinement confirmé.",
    details,
    detailsBorderColor: "#22c55e",
    price: {
      amount: data.price,
      note: "Paiement reçu — Merci !",
      theme: "success",
      currency,
    },
    button: data.meetingLink
      ? { text: "Rejoindre la séance", url: data.meetingLink }
      : undefined,
    infoBox: {
      title: "Avant votre séance",
      content: data.meetingLink
        ? "Votre lien de réunion est prêt. Assurez-vous de vous connecter quelques minutes avant et d'avoir une connexion internet stable."
        : "Votre lien de réunion vous sera envoyé avant l'heure prévue de votre séance.",
    },
    outro:
      "Nous avons hâte de vous accompagner dans votre parcours de mieux-être. Si vous devez reporter, contactez-nous au moins 24 heures à l'avance.",
    branding,
  });

  const text = buildEmailText([
    "Paiement confirmé — Vous êtes prêt !",
    `Bonjour ${data.guestName},`,
    "Votre paiement a été traité avec succès.",
    "DÉTAILS DU RENDEZ-VOUS :",
    `Type de séance : ${sessionType}`,
    `Professionnel : ${professionalName}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    `Durée : ${data.duration} minutes`,
    `Montant payé : ${data.price.toFixed(2)} $ ${currency}`,
    data.meetingLink ? `Lien de réunion : ${data.meetingLink}` : "",
  ]);

  const subject = await getSubject(
    "guest_payment_complete",
    "Paiement confirmé — JeChemine",
  );

  return sendEmail(
    { to: data.guestEmail, subject, html, text },
    "guest_payment_complete",
  );
}

// =============================================================================
// Public Email Functions - Appointments
// =============================================================================

export async function sendAppointmentConfirmation(
  data: AppointmentEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const professionalName = formatProfessionalName(data.professionalName);
  const appointmentType = formatAppointmentType(data.type);

  const details: Array<{ label: string; value: string; isLink?: boolean }> = [
    { label: "Professionnel", value: professionalName },
    { label: "Date", value: formattedDate },
    { label: "Heure", value: formattedTime },
    { label: "Durée", value: `${data.duration} minutes` },
  ];

  if (data.meetingLink) {
    details.push({
      label: "Lien de réunion",
      value: data.meetingLink,
      isLink: true,
    });
  } else if (data.location) {
    details.push({ label: "Lieu", value: data.location });
  }

  const html = buildEmailHtml({
    title: "Rendez-vous confirmé",
    theme: "success",
    greeting: `Bonjour ${data.clientName},`,
    intro: `Votre rendez-vous (${appointmentType.toLowerCase()}) est confirmé.`,
    details,
    button: data.meetingLink
      ? { text: "Rejoindre la séance", url: data.meetingLink }
      : undefined,
    outro:
      "Si vous devez reporter ou annuler, veuillez le faire au moins 24 heures à l'avance.",
    branding,
  });

  const text = buildEmailText([
    "Rendez-vous confirmé",
    `Bonjour ${data.clientName},`,
    `Votre rendez-vous (${appointmentType.toLowerCase()}) est confirmé.`,
    "DÉTAILS :",
    `Professionnel : ${professionalName}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    `Durée : ${data.duration} minutes`,
    data.meetingLink ? `Lien de réunion : ${data.meetingLink}` : "",
    data.location ? `Lieu : ${data.location}` : "",
  ]);

  const subject = await getSubject(
    "appointment_confirmation",
    "Rendez-vous confirmé — JeChemine",
  );

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "appointment_confirmation",
  );
}

export async function sendPaymentInvitation(
  data: AppointmentEmailData & { price: number; paymentUrl?: string },
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const professionalName = formatProfessionalName(data.professionalName);
  const appointmentType = formatAppointmentType(data.type);
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/client/dashboard/appointments`;

  const details: Array<{ label: string; value: string; isLink?: boolean }> = [
    { label: "Professionnel", value: professionalName },
    { label: "Date", value: formattedDate },
    { label: "Heure", value: formattedTime },
    { label: "Durée", value: `${data.duration} minutes` },
  ];

  if (data.meetingLink) {
    details.push({
      label: "Lien de réunion",
      value: data.meetingLink,
      isLink: true,
    });
  } else if (data.location) {
    details.push({ label: "Lieu", value: data.location });
  }

  const html = buildEmailHtml({
    title: "Prochaine étape : confirmez votre rendez-vous",
    subtitle: "Votre professionnel a confirmé votre séance",
    theme: "info",
    badge: { text: "✅ Rendez-vous confirmé", theme: "success" },
    greeting: `Bonjour ${data.clientName},`,
    intro:
      "Votre rendez-vous est confirmé. Veuillez ajouter vos coordonnées de paiement (carte, virement Interac via Stripe, ou prélèvement automatique canadien) pour finaliser votre réservation. Aucun montant n'est prélevé avant que votre séance ait eu lieu et que votre professionnel la marque comme complétée. Les données de carte et bancaires sont traitées par Stripe — nous ne les stockons pas sur notre plateforme.",
    details,
    detailsBorderColor: branding?.primaryColor,
    price: {
      amount: data.price,
      note: "Frais de séance (prélevés après la séance complétée)",
      theme: "info",
      currency,
    },
    button: data.paymentUrl
      ? { text: "Ouvrir la facturation et confirmer", url: data.paymentUrl }
      : { text: "Voir le rendez-vous", url: dashboardUrl },
    infoBox: {
      title: "Paiements sécurisés avec Stripe",
      content:
        "Vous recevrez votre lien de réunion une fois votre moyen de paiement enregistré. Le montant n'est prélevé qu'après confirmation de la séance par votre professionnel.",
    },
    outro:
      "Pour toute question, répondez à ce courriel ou contactez le soutien depuis votre tableau de bord.",
    branding,
  });

  const text = buildEmailText([
    "Confirmez votre rendez-vous (paiement après la séance)",
    `Bonjour ${data.clientName},`,
    "Votre rendez-vous est confirmé. Ajoutez votre moyen de paiement via le lien ci-dessous pour confirmer votre réservation. Vous ne serez facturé qu'après la complétion de votre séance. Stripe gère vos coordonnées bancaires ; nous ne les stockons pas.",
    "DÉTAILS DU RENDEZ-VOUS :",
    `Professionnel : ${professionalName}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    `Durée : ${data.duration} minutes`,
    `Montant dû : ${data.price.toFixed(2)} $ ${currency}`,
    data.paymentUrl
      ? `Confirmer le paiement : ${data.paymentUrl}`
      : `Voir le rendez-vous : ${dashboardUrl}`,
  ]);

  const subject = await getSubject(
    "payment_invitation",
    "Votre rendez-vous est confirmé — prochaine étape",
  );

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_invitation",
  );
}

export async function sendProfessionalNotification(
  data: AppointmentEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const professionalName = formatProfessionalName(data.professionalName);
  const appointmentType = formatAppointmentType(data.type);
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/professional/dashboard/requests`;

  const html = buildEmailHtml({
    title: "Nouvelle demande de rendez-vous",
    theme: "info",
    greeting: `Bonjour ${professionalName},`,
    intro:
      "Vous avez reçu une nouvelle demande de rendez-vous. Veuillez consulter les détails ci-dessous.",
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Type", value: appointmentType },
      { label: "Date", value: formattedDate },
      { label: "Heure", value: formattedTime },
    ],
    button: { text: "Voir la demande", url: dashboardUrl },
    outro:
      "Veuillez répondre à cette demande dès que possible pour confirmer ou reporter.",
    branding,
  });

  const text = buildEmailText([
    "Nouvelle demande de rendez-vous",
    `Bonjour ${professionalName},`,
    "Vous avez une nouvelle demande de rendez-vous.",
    "DÉTAILS DU CLIENT :",
    `Client : ${data.clientName}`,
    `Courriel : ${data.clientEmail}`,
    `Type : ${appointmentType}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    `Voir les demandes : ${dashboardUrl}`,
  ]);

  const subject = await getSubject(
    "appointment_professional_notification",
    "Nouvelle demande de rendez-vous — JeChemine",
  );

  return sendEmail(
    { to: data.professionalEmail, subject, html, text },
    "appointment_professional_notification",
  );
}

export async function sendAppointmentReminder(
  data: AppointmentEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const professionalName = formatProfessionalName(data.professionalName);

  const details: Array<{ label: string; value: string; isLink?: boolean }> = [
    { label: "Professionnel", value: professionalName },
    { label: "Date", value: formattedDate },
    { label: "Heure", value: formattedTime },
  ];

  if (data.meetingLink) {
    details.push({
      label: "Lien de réunion",
      value: data.meetingLink,
      isLink: true,
    });
  }

  const html = buildEmailHtml({
    title: "Rappel de rendez-vous",
    theme: "warning",
    greeting: `Bonjour ${data.clientName},`,
    intro: "Voici un rappel amical concernant votre prochain rendez-vous.",
    details,
    infoBox: {
      title: "Préparez votre séance",
      content:
        "Assurez-vous d'être dans un endroit calme et privé avec une connexion internet stable. Connectez-vous quelques minutes avant pour tester votre audio et vidéo.",
      theme: "info",
    },
    button: data.meetingLink
      ? { text: "Rejoindre la séance", url: data.meetingLink }
      : undefined,
    outro: "Nous avons hâte de vous voir !",
    branding,
  });

  const text = buildEmailText([
    "Rappel de rendez-vous",
    `Bonjour ${data.clientName},`,
    "Rappel pour votre prochain rendez-vous :",
    `Professionnel : ${professionalName}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    data.meetingLink ? `Rejoindre : ${data.meetingLink}` : "",
  ]);

  const subject = await getSubject(
    "appointment_reminder",
    "Rappel de rendez-vous — JeChemine",
  );

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "appointment_reminder",
  );
}

export async function sendMeetingLinkNotification(
  data: MeetingLinkEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const professionalName = formatProfessionalName(data.professionalName);
  const appointmentType = formatAppointmentType(data.type);

  const html = buildEmailHtml({
    title: "Lien de réunion prêt",
    subtitle: "Détails de votre séance",
    theme: "success",
    badge: { text: "🔗 Lien prêt", theme: "success" },
    greeting: `Bonjour ${data.guestName},`,
    intro:
      "Votre lien de réunion est maintenant disponible. Vous pouvez rejoindre la séance via le lien ci-dessous.",
    details: [
      { label: "Professionnel", value: professionalName },
      { label: "Type", value: appointmentType },
      { label: "Date", value: formattedDate },
      { label: "Heure", value: formattedTime },
      { label: "Durée", value: `${data.duration} minutes` },
      { label: "Lien de réunion", value: data.meetingLink, isLink: true },
    ],
    detailsBorderColor: "#22c55e",
    button: { text: "Rejoindre la séance", url: data.meetingLink },
    outro:
      "Veuillez vous connecter quelques minutes avant et vous assurer d'avoir une connexion internet stable.",
    branding,
  });

  const text = buildEmailText([
    "Votre lien de réunion est prêt",
    `Bonjour ${data.guestName},`,
    "Détails de votre séance :",
    `Professionnel : ${professionalName}`,
    `Type : ${appointmentType}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    `Durée : ${data.duration} minutes`,
    `Lien de réunion : ${data.meetingLink}`,
  ]);

  const subject = await getSubject(
    "meeting_link",
    "Votre lien de réunion est prêt — JeChemine",
  );

  return sendEmail(
    { to: data.guestEmail, subject, html, text },
    "meeting_link",
  );
}

export async function sendCancellationNotification(
  data: AppointmentEmailData & { cancelledBy: "client" | "professional" },
): Promise<boolean> {
  const branding = await getBranding();
  const formattedDate = formatEmailDate(data.date);
  const formattedTime = formatTime(data.time);
  const isClientCancellation = data.cancelledBy === "client";
  const recipientEmail = isClientCancellation
    ? data.professionalEmail
    : data.clientEmail;
  const recipientName = isClientCancellation
    ? formatProfessionalName(data.professionalName)
    : data.clientName;
  const cancellerName = isClientCancellation
    ? data.clientName
    : formatProfessionalName(data.professionalName);

  const hasSchedule = data.date && data.time;
  const intro = hasSchedule
    ? `Le rendez-vous prévu le ${formattedDate} à ${formattedTime} a été annulé par ${cancellerName}.`
    : `Une demande de rendez-vous a été annulée par ${cancellerName}.`;

  const html = buildEmailHtml({
    title: "Rendez-vous annulé",
    theme: "danger",
    greeting: `Bonjour ${recipientName},`,
    intro,
    details: hasSchedule
      ? [
          { label: "Date initiale", value: formattedDate },
          { label: "Heure initiale", value: formattedTime },
          { label: "Annulé par", value: cancellerName },
        ]
      : undefined,
    detailsBorderColor: "#ef4444",
    outro:
      "Si vous avez des questions ou souhaitez reporter, veuillez nous contacter.",
    branding,
  });

  const text = buildEmailText([
    "Rendez-vous annulé",
    `Bonjour ${recipientName},`,
    intro,
    hasSchedule ? `Date initiale : ${formattedDate}` : "",
    hasSchedule ? `Heure initiale : ${formattedTime}` : "",
  ]);

  const subject = await getSubject(
    "appointment_cancellation",
    `Rendez-vous annulé${isClientCancellation ? " par le client" : ""} — JeChemine`,
  );

  return sendEmail(
    { to: recipientEmail, subject, html, text },
    "appointment_cancellation",
  );
}

// =============================================================================
// Public Email Functions - Payments
// =============================================================================

export async function sendPaymentFailedNotification(
  data: PaymentEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const paymentUrl = `${process.env.NEXTAUTH_URL}/payment`;

  const html = buildEmailHtml({
    title: "Paiement échoué",
    subtitle: "Action requise",
    theme: "danger",
    greeting: `Bonjour ${data.name},`,
    intro:
      "Malheureusement, nous n'avons pas pu traiter votre paiement. Veuillez mettre à jour votre moyen de paiement et réessayer.",
    details: data.appointmentDate
      ? [
          { label: "Montant", value: `${data.amount.toFixed(2)} $ ${currency}` },
          {
            label: "Date du rendez-vous",
            value: formatEmailDate(data.appointmentDate),
          },
          {
            label: "Professionnel",
            value: formatProfessionalName(data.professionalName),
          },
        ]
      : [{ label: "Montant", value: `${data.amount.toFixed(2)} $ ${currency}` }],
    button: { text: "Réessayer le paiement", url: paymentUrl },
    infoBox: {
      title: "Besoin d'aide ?",
      content:
        "Si les problèmes persistent, veuillez contacter notre équipe de soutien.",
      theme: "info",
    },
    outro: "Veuillez résoudre ce problème dans les 24 heures pour conserver votre plage horaire.",
    branding,
  });

  const text = buildEmailText([
    "Paiement échoué — Action requise",
    `Bonjour ${data.name},`,
    "Votre paiement n'a pas pu être traité.",
    `Montant : ${data.amount.toFixed(2)} $ ${currency}`,
    `Réessayer le paiement : ${paymentUrl}`,
  ]);

  const subject = await getSubject(
    "payment_failed",
    "Paiement échoué — Action requise",
  );

  return sendEmail({ to: data.email, subject, html, text }, "payment_failed");
}

export async function sendRefundConfirmation(
  data: PaymentEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();

  const html = buildEmailHtml({
    title: "Remboursement traité",
    theme: "info",
    greeting: `Bonjour ${data.name},`,
    intro:
      "Votre remboursement a été traité avec succès. Les fonds devraient apparaître dans votre compte dans un délai de 5 à 10 jours ouvrables.",
    details: [
      { label: "Montant remboursé", value: `${data.amount.toFixed(2)} $ ${currency}` },
      ...(data.appointmentDate
        ? [
            {
              label: "Rendez-vous initial",
              value: formatEmailDate(data.appointmentDate),
            },
          ]
        : []),
    ],
    infoBox: {
      title: "Délai de traitement",
      content:
        "Les remboursements prennent généralement 5 à 10 jours ouvrables pour apparaître sur votre relevé, selon votre institution bancaire.",
    },
    outro:
      "Si vous avez des questions concernant ce remboursement, veuillez contacter notre équipe de soutien.",
    branding,
  });

  const text = buildEmailText([
    "Remboursement traité",
    `Bonjour ${data.name},`,
    "Votre remboursement a été traité.",
    `Montant : ${data.amount.toFixed(2)} $ ${currency}`,
    "Les fonds devraient apparaître dans votre compte dans un délai de 5 à 10 jours ouvrables.",
  ]);

  const subject = await getSubject(
    "payment_refund",
    "Remboursement traité — JeChemine",
  );

  return sendEmail({ to: data.email, subject, html, text }, "payment_refund");
}

// =============================================================================
// Public Email Functions - Professional Status
// =============================================================================

export async function sendProfessionalApprovalEmail(
  data: ProfessionalStatusEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/professional/dashboard`;

  const html = buildEmailHtml({
    title: "Demande approuvée !",
    subtitle: "Bienvenue dans l'équipe",
    theme: "success",
    badge: { text: "✅ Approuvé", theme: "success" },
    greeting: `Bonjour ${data.name},`,
    intro:
      "Félicitations ! Votre candidature professionnelle a été approuvée. Vous pouvez maintenant commencer à accepter des rendez-vous et à vous connecter avec des clients.",
    infoBox: {
      title: "Pour commencer",
      content:
        "Complétez votre profil, définissez vos disponibilités et commencez à accepter les demandes de rendez-vous des clients qui ont besoin de votre expertise.",
    },
    button: { text: "Accéder au tableau de bord", url: dashboardUrl },
    outro: "Merci de nous avoir rejoints. Nous sommes ravis de vous compter parmi nous !",
    branding,
  });

  const text = buildEmailText([
    "Demande approuvée !",
    `Bonjour ${data.name},`,
    "Votre candidature professionnelle a été approuvée.",
    "Vous pouvez maintenant commencer à accepter des rendez-vous.",
    `Accédez à votre tableau de bord : ${dashboardUrl}`,
  ]);

  const subject = await getSubject(
    "professional_approval",
    "Bienvenue ! Votre compte professionnel est approuvé",
  );

  return sendEmail(
    { to: data.email, subject, html, text },
    "professional_approval",
  );
}

export async function sendProfessionalRejectionEmail(
  data: ProfessionalStatusEmailData,
): Promise<boolean> {
  const branding = await getBranding();

  const html = buildEmailHtml({
    title: "Mise à jour de votre candidature",
    theme: "info",
    greeting: `Bonjour ${data.name},`,
    intro:
      "Merci de l'intérêt que vous portez à notre plateforme. Après examen attentif, nous ne sommes pas en mesure d'approuver votre candidature pour le moment.",
    infoBox: data.reason
      ? {
          title: "Commentaires",
          content: data.reason,
        }
      : undefined,
    outro:
      "Si vous pensez que cette décision est erronée ou souhaitez fournir des informations supplémentaires, veuillez contacter notre équipe de soutien.",
    branding,
  });

  const text = buildEmailText([
    "Mise à jour de votre candidature",
    `Bonjour ${data.name},`,
    "Nous ne sommes pas en mesure d'approuver votre candidature pour le moment.",
    data.reason ? `Commentaires : ${data.reason}` : "",
    "Veuillez contacter le soutien si vous avez des questions.",
  ]);

  const subject = await getSubject(
    "professional_rejection",
    "Mise à jour de votre candidature — JeChemine",
  );

  return sendEmail(
    { to: data.email, subject, html, text },
    "professional_rejection",
  );
}

/** Alerte admins : un client a choisi Interac / virement (entente de confiance à valider). */
export async function sendAdminInteracTrustRequestAlert(data: {
  clientName: string;
  clientEmail: string;
  appointmentId: string;
}): Promise<void> {
  await connectToDatabase();
  const adminUsers = await User.find({ isAdmin: true, role: "admin" })
    .select("email")
    .lean();
  let emails = adminUsers
    .map((a) => a.email)
    .filter((e): e is string => Boolean(e));
  if (emails.length === 0 && process.env.ADMIN_ALERT_EMAIL) {
    emails = process.env.ADMIN_ALERT_EMAIL.split(",").map((s) => s.trim());
  }
  if (emails.length === 0) {
    console.warn(
      "[admin_interac_trust_request] No admin emails — set ADMIN_ALERT_EMAIL or admin users.",
    );
    return;
  }

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const reviewUrl = `${base}/admin/dashboard/payment-trust`;

  const branding = await getBranding();
  const html = buildEmailHtml({
    title: "Validation garantie Interac / virement",
    theme: "warning",
    greeting: "Bonjour,",
    intro:
      "Un client a indiqué ne pas utiliser de carte et souhaite payer par virement Interac (entente de confiance). Validez le profil pour passer le client en Statut vert.",
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Rendez-vous", value: data.appointmentId },
    ],
    button: { text: "Ouvrir la file d’attente", url: reviewUrl },
    outro:
      "Après chaque séance, le paiement doit être reçu dans les 24 heures. Merci de confirmer la réception selon vos processus internes.",
    branding,
  });

  const text = buildEmailText([
    "Interac / virement — action admin requise",
    `Client: ${data.clientName} (${data.clientEmail})`,
    `Rendez-vous: ${data.appointmentId}`,
    `Valider: ${reviewUrl}`,
  ]);

  const subject = await getSubject(
    "admin_interac_trust_request",
    "Interac / virement — validation requise (Statut vert)",
  );

  for (const to of emails) {
    await sendEmail({ to, subject, html, text }, "admin_interac_trust_request");
  }
}

export async function sendInteracTransferInstructionsEmail(data: {
  clientName: string;
  clientEmail: string;
  clientLegalName: string;
  depositEmail: string;
  amountCad: number;
  interacReferenceCode: string;
  professionalName: string;
  appointmentDateLabel: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const company = branding?.companyName || "JeChemine";

  const smsBlock = [
    "Paiement Interac Rapide ⚡",
    `📧 Courriel : ${data.depositEmail}`,
    `💰 Montant : ${data.amountCad.toFixed(2)} $`,
    `📝 Message obligatoire : ${data.interacReferenceCode}`,
    "",
    "Le système pourra associer votre virement à votre dossier grâce à ce code.",
  ].join("\n");

  const html = buildEmailHtml({
    title: "Instructions — virement Interac",
    theme: "info",
    greeting: `Bonjour ${data.clientName},`,
    intro: `Voici comment envoyer votre virement pour votre séance avec ${data.professionalName} (${data.appointmentDateLabel}).`,
    details: [
      {
        label: "1. Envoyez votre virement à",
        value: data.depositEmail,
      },
      {
        label: "2. Vérification du nom",
        value: `Le nom associé à votre compte bancaire doit être identique à celui de votre dossier : ${data.clientLegalName}.`,
      },
      {
        label: "3. Compte d’un tiers ou d’une entreprise",
        value:
          "Inscrivez votre nom complet dans le champ « Message » du virement pour que nous puissions identifier votre paiement.",
      },
      {
        label: "4. Message obligatoire (référence unique)",
        value: data.interacReferenceCode,
      },
    ],
    infoBox: {
      title: "Format court (idéal mobile / SMS)",
      content: smsBlock.split("\n").join("<br/>"),
      theme: "info",
    },
    outro: `PAD et carte : vous pouvez aussi enregistrer un moyen de paiement sécurisé (Stripe) depuis votre espace Facturation. Pour les PME, des solutions type prélèvement avec mandat (ex. intégrations bancaires spécialisées) peuvent s’ajouter — contactez ${company} pour plus d’informations.`,
    branding,
  });

  const text = buildEmailText([
    "Instructions virement Interac",
    `Bonjour ${data.clientName},`,
    `Séance avec ${data.professionalName} — ${data.appointmentDateLabel}`,
    "",
    `1. Envoyer le virement à : ${data.depositEmail}`,
    `2. Nom : doit correspondre à « ${data.clientLegalName} »`,
    "3. Tiers / entreprise : indiquez votre nom complet dans le message du virement.",
    `4. Message obligatoire : ${data.interacReferenceCode}`,
    `Montant : ${data.amountCad.toFixed(2)} $`,
    "",
    "— Format SMS —",
    smsBlock,
  ]);

  const subject = await getSubject(
    "interac_transfer_instructions",
    "Instructions virement Interac — JeChemine",
  );

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "interac_transfer_instructions",
  );
}

/** Relance automatique Interac (J+1 ou J+2) quand le virement n'a pas encore été reçu. */
export async function sendInteracPaymentReminder(data: {
  clientName: string;
  clientEmail: string;
  depositEmail: string;
  amountCad: number;
  interacReferenceCode: string;
  appointmentDateLabel: string;
  reminderNumber: 1 | 2;
}): Promise<boolean> {
  const branding = await getBranding();
  const company = branding?.companyName || "JeChemine";
  const isUrgent = data.reminderNumber === 2;

  const smsBlock = [
    "Paiement Interac Rapide ⚡",
    `📧 Courriel : ${data.depositEmail}`,
    `💰 Montant : ${data.amountCad.toFixed(2)} $`,
    `📝 Message obligatoire : ${data.interacReferenceCode}`,
    "",
    "Le système associera votre virement à votre dossier grâce à ce code.",
  ].join("\n");

  const html = buildEmailHtml({
    title: `Rappel de paiement — Interac (${data.reminderNumber === 1 ? "J+1" : "J+2"})`,
    theme: isUrgent ? "warning" : "info",
    greeting: `Bonjour ${data.clientName},`,
    intro: isUrgent
      ? `Deuxième rappel : votre paiement Interac pour la séance du ${data.appointmentDateLabel} est toujours en attente. Veuillez envoyer votre virement dès que possible afin d'éviter un signalement de retard.`
      : `Nous n'avons pas encore reçu votre virement Interac pour votre séance du ${data.appointmentDateLabel}. Voici un rappel des instructions de paiement.`,
    details: [
      { label: "1. Envoyer à", value: data.depositEmail },
      { label: "2. Nom", value: `Le nom de votre compte bancaire doit correspondre à celui de votre dossier : ${data.clientName}.` },
      { label: "3. Compte tiers / entreprise", value: "Indiquez votre nom complet dans le champ « Message » du virement." },
      { label: "4. Message obligatoire (code unique)", value: data.interacReferenceCode },
      { label: "Montant", value: `${data.amountCad.toFixed(2)} $ CAD` },
    ],
    infoBox: {
      title: "Format court (idéal mobile / SMS)",
      content: smsBlock.split("\n").join("<br/>"),
      theme: isUrgent ? "warning" : "info",
    },
    outro: isUrgent
      ? `Votre paiement est en retard. Si vous rencontrez des difficultés, contactez le soutien de ${company} immédiatement.`
      : `En cas de difficulté, contactez-nous à l'adresse de support de ${company}.`,
    branding,
  });

  const text = buildEmailText([
    `Rappel paiement Interac (relance ${data.reminderNumber})`,
    `Bonjour ${data.clientName},`,
    `Séance du ${data.appointmentDateLabel}`,
    "",
    `1. Envoyer à : ${data.depositEmail}`,
    `2. Nom : doit correspondre à « ${data.clientName} »`,
    "3. Tiers / entreprise : indiquez votre nom dans le message.",
    `4. Message obligatoire : ${data.interacReferenceCode}`,
    `Montant : ${data.amountCad.toFixed(2)} $ CAD`,
    "",
    "— Format SMS —",
    smsBlock,
  ]);

  const subject = await getSubject(
    "interac_payment_reminder",
    `Rappel paiement Interac — ${company}`,
  );

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "interac_payment_reminder",
  );
}

export async function sendFiscalReceiptEmail(data: {
  clientEmail: string;
  clientName: string;
  amountCad: number;
  pdfBuffer: Buffer;
  appointmentId: string;
  paymentPendingTransfer: boolean;
}): Promise<boolean> {
  const branding = await getBranding();
  const subject = await getSubject(
    "fiscal_receipt",
    "Votre reçu fiscal — JeChemine",
  );
  const html = buildEmailHtml({
    title: "Reçu fiscal",
    theme: data.paymentPendingTransfer ? "warning" : "success",
    greeting: `Bonjour ${data.clientName},`,
    intro: data.paymentPendingTransfer
      ? `Votre séance est enregistrée. Montant dû : ${data.amountCad.toFixed(2)} $ CAD (virement Interac). Les instructions ont été ou seront envoyées par courriel. Vous trouverez en pièce jointe votre reçu.`
      : `Votre paiement de ${data.amountCad.toFixed(2)} $ CAD a été traité. Veuillez trouver votre reçu fiscal en pièce jointe.`,
    branding,
  });
  const text = buildEmailText([
    "Reçu fiscal — Je Chemine",
    data.paymentPendingTransfer
      ? `Montant dû (Interac) : ${data.amountCad.toFixed(2)} $ CAD`
      : `Paiement reçu : ${data.amountCad.toFixed(2)} $ CAD`,
    "PDF en pièce jointe.",
  ]);
  return sendEmail(
    {
      to: data.clientEmail,
      subject,
      html,
      text,
      attachments: [
        {
          filename: `recu-${data.appointmentId.slice(-8)}.pdf`,
          content: data.pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    },
    "fiscal_receipt",
  );
}

export async function sendPaymentGuaranteeDay1Reminder(data: {
  clientName: string;
  clientEmail: string;
  billingUrl: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const html = buildEmailHtml({
    title: "Rappel : moyen de paiement",
    theme: "warning",
    greeting: `Bonjour ${data.clientName},`,
    intro:
      "Votre rendez-vous est confirmé, mais aucune carte ni prélèvement bancaire (PAD) n’est encore enregistré. Ajoutez un moyen de paiement pour finaliser la garantie.",
    button: { text: "Ouvrir Facturation", url: data.billingUrl },
    outro: "Si vous avez choisi le virement Interac, votre demande est en traitement côté administration.",
    branding,
  });
  const text = buildEmailText([
    "Rappel moyen de paiement",
    `Bonjour ${data.clientName},`,
    "Ajoutez une carte ou un PAD :",
    data.billingUrl,
  ]);
  const subject = await getSubject(
    "payment_guarantee_day1_reminder",
    "Rappel : ajoutez un moyen de paiement — JeChemine",
  );
  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_guarantee_day1_reminder",
  );
}

export async function sendPaymentGuarantee48hClientReminder(data: {
  clientName: string;
  clientEmail: string;
  billingUrl: string;
  appointmentDateLabel: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const html = buildEmailHtml({
    title: "URGENT — rendez-vous proche",
    theme: "danger",
    greeting: `Bonjour ${data.clientName},`,
    intro: `Votre rendez-vous du ${data.appointmentDateLabel} approche. Aucune garantie de paiement (carte/PAD) n’est en place. Merci d’agir immédiatement pour éviter tout report.`,
    button: { text: "Ajouter un moyen de paiement", url: data.billingUrl },
    branding,
  });
  const text = buildEmailText([
    "URGENT — moyen de paiement",
    `Bonjour ${data.clientName},`,
    `Rendez-vous : ${data.appointmentDateLabel}`,
    data.billingUrl,
  ]);
  const subject = await getSubject(
    "payment_guarantee_48h_client",
    "URGENT : moyen de paiement — JeChemine",
  );
  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_guarantee_48h_client",
  );
}

export async function sendPaymentGuarantee48hProfessionalAlert(data: {
  professionalEmail: string;
  professionalName: string;
  clientName: string;
  appointmentDateLabel: string;
  appointmentId: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const dashboardUrl = `${base}/professional/dashboard/sessions`;

  const html = buildEmailHtml({
    title: "ALERTE — client sans garantie de paiement",
    theme: "danger",
    greeting: `Bonjour ${data.professionalName},`,
    intro: `Le client ${data.clientName} n’a toujours pas de carte ni prélèvement enregistré pour le rendez-vous du ${data.appointmentDateLabel}. Dernière relance automatique envoyée au client.`,
    details: [
      { label: "Rendez-vous", value: data.appointmentId },
    ],
    button: { text: "Voir les séances", url: dashboardUrl },
    branding,
  });
  const text = buildEmailText([
    "ALERTE garantie paiement",
    `Bonjour ${data.professionalName},`,
    `Client : ${data.clientName}`,
    `Date : ${data.appointmentDateLabel}`,
    dashboardUrl,
  ]);
  const subject = await getSubject(
    "payment_guarantee_48h_professional",
    "ALERTE : client sans garantie — rendez-vous proche",
  );
  return sendEmail(
    { to: data.professionalEmail, subject, html, text },
    "payment_guarantee_48h_professional",
  );
}

/**
 * Envoyé au client dès qu'un professionnel accepte sa demande (jumelage réussi).
 * Invite le client à choisir son mode de paiement : carte Stripe ou virement Interac.
 */
export async function sendJumelageSuccessEmail(data: {
  clientName: string;
  clientEmail: string;
  professionalName?: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const billingUrl = `${base}/client/dashboard/billing`;

  const title =
    lang === "fr"
      ? "Jumelage réussi — Configurez votre paiement"
      : "Match successful — Set up your payment";
  const subtitle =
    lang === "fr"
      ? data.professionalName
        ? `Professionnel assigné : ${data.professionalName}`
        : "Un professionnel a accepté votre demande"
      : data.professionalName
      ? `Professional assigned: ${data.professionalName}`
      : "A professional has accepted your request";
  const intro =
    lang === "fr"
      ? "Votre demande a été acceptée par un professionnel. Pour confirmer votre rendez-vous, veuillez choisir votre mode de paiement : carte de crédit (Stripe) ou virement Interac."
      : "Your request has been accepted by a professional. To confirm your appointment, please choose your payment method: credit card (Stripe) or Interac e-Transfer.";
  const infoContent =
    lang === "fr"
      ? "Carte de crédit : vos données sont sécurisées par Stripe. Votre carte sera validée et aucun montant n'est prélevé avant la séance.\n\nVirement Interac : choisissez cette option si vous préférez payer par courriel Interac. L'administration validera votre dossier."
      : "Credit card: your data is secured by Stripe. Your card is validated and nothing is charged before the session.\n\nInterac e-Transfer: choose this option if you prefer to pay by Interac email transfer. Admin will validate your file.";

  const html = buildEmailHtml({
    title,
    subtitle,
    theme: "success",
    badge: {
      text: lang === "fr" ? "✅ Jumelage confirmé" : "✅ Match confirmed",
      theme: "success",
    },
    greeting: lang === "fr" ? `Bonjour ${data.clientName},` : `Dear ${data.clientName},`,
    intro,
    infoBox: {
      title: lang === "fr" ? "Modes de paiement disponibles" : "Available payment methods",
      content: infoContent,
    },
    button: {
      text: lang === "fr" ? "Configurer mon paiement" : "Set up my payment",
      url: billingUrl,
    },
    outro:
      lang === "fr"
        ? "Si vous avez des questions, contactez notre équipe depuis votre tableau de bord."
        : "If you have questions, contact our team from your dashboard.",
    branding,
  });

  const text = buildEmailText([
    title,
    lang === "fr" ? `Bonjour ${data.clientName},` : `Dear ${data.clientName},`,
    intro,
    lang === "fr"
      ? "Configurer votre paiement :"
      : "Set up your payment:",
    billingUrl,
  ]);

  const subject =
    lang === "fr"
      ? "Jumelage réussi — configurez votre mode de paiement"
      : "Match successful — set up your payment method";

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_invitation",
  );
}

/**
 * Rappel post-séance envoyé au client si aucun mode de paiement n'a été choisi avant la rencontre.
 * Un alerte admin est également envoyée via sendAdminInteracTrustRequestAlert ou email direct.
 */
export async function sendPostMeetingPaymentReminder(data: {
  clientName: string;
  clientEmail: string;
  appointmentDateLabel: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const billingUrl = `${base}/client/dashboard/billing`;

  const intro =
    lang === "fr"
      ? `Votre séance du ${data.appointmentDateLabel} a eu lieu, mais aucun mode de paiement n'a encore été configuré sur votre compte. Veuillez régulariser votre situation dès que possible.`
      : `Your session on ${data.appointmentDateLabel} has taken place, but no payment method has been set up on your account yet. Please settle this as soon as possible.`;

  const html = buildEmailHtml({
    title: lang === "fr" ? "Action requise — paiement en attente" : "Action required — payment pending",
    theme: "danger",
    badge: {
      text: lang === "fr" ? "⚠️ Paiement en attente" : "⚠️ Payment pending",
      theme: "danger",
    },
    greeting: lang === "fr" ? `Bonjour ${data.clientName},` : `Dear ${data.clientName},`,
    intro,
    button: {
      text: lang === "fr" ? "Configurer mon paiement" : "Set up my payment",
      url: billingUrl,
    },
    outro:
      lang === "fr"
        ? "Si vous avez des questions, notre équipe est disponible depuis votre tableau de bord."
        : "If you have any questions, our team is available from your dashboard.",
    branding,
  });

  const text = buildEmailText([
    lang === "fr" ? "Paiement en attente après votre séance" : "Payment pending after your session",
    lang === "fr" ? `Bonjour ${data.clientName},` : `Dear ${data.clientName},`,
    intro,
    lang === "fr" ? "Configurer votre paiement :" : "Set up your payment:",
    billingUrl,
  ]);

  const subject =
    lang === "fr"
      ? "Action requise — paiement non configuré après votre séance"
      : "Action required — payment not set up after your session";

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_invitation",
  );
}

/**
 * Alerte admin : aucun mode de paiement choisi avant la date de rencontre.
 */
export async function sendAdminNoPaymentBeforeMeetingAlert(data: {
  clientName: string;
  clientEmail: string;
  appointmentDateLabel: string;
  appointmentId: string;
}): Promise<void> {
  await connectToDatabase();
  const adminUsers = await User.find({ isAdmin: true, role: "admin" })
    .select("email")
    .lean();
  let adminEmails = adminUsers
    .map((a) => a.email)
    .filter((e): e is string => Boolean(e));
  if (adminEmails.length === 0 && process.env.ADMIN_ALERT_EMAIL) {
    adminEmails = process.env.ADMIN_ALERT_EMAIL.split(",").map((s) => s.trim());
  }
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/patients`;

  const html = buildEmailHtml({
    title: "⚠️ Aucun paiement avant la rencontre",
    theme: "danger",
    greeting: "Bonjour,",
    intro: `Le client ${data.clientName} (${data.clientEmail}) n'avait aucun mode de paiement configuré avant sa rencontre du ${data.appointmentDateLabel}. Une relance a été envoyée automatiquement au client.`,
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Date séance", value: data.appointmentDateLabel },
      { label: "ID RDV", value: data.appointmentId },
    ],
    button: { text: "Voir les dossiers clients", url: adminUrl },
    branding,
  });
  const text = buildEmailText([
    "Aucun paiement avant la rencontre — action requise",
    `Client : ${data.clientName} — ${data.clientEmail}`,
    `Date : ${data.appointmentDateLabel}`,
    `RDV : ${data.appointmentId}`,
    adminUrl,
  ]);
  const subject = `⚠️ Aucun paiement — séance passée — ${data.clientName}`;

  for (const to of adminEmails) {
    await sendEmail({ to, subject, html, text }, "admin_interac_trust_request").catch((e) =>
      console.error("sendAdminNoPaymentBeforeMeetingAlert:", e),
    );
  }
}

export async function sendResendInvitationEmail(data: {
  name: string;
  email: string;
  role: "client" | "professional";
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang = data.locale || "fr";
  const loginUrl = "https://cheminement.vercel.app/login";

  const titles = {
    fr: "Finalisez votre inscription",
    en: "Finalize your registration",
  };
  const greetings = {
    fr: `Bonjour ${data.name},`,
    en: `Hello ${data.name},`,
  };
  const intros = {
    fr: `Vous avez été invité à rejoindre ${branding?.companyName || "JeChemine"}. Veuillez vous connecter pour compléter votre profil et accéder à votre tableau de bord.`,
    en: `You have been invited to join ${branding?.companyName || "JeChemine"}. Please log in to complete your profile and access your dashboard.`,
  };
  const buttons = {
    fr: "Se connecter au site",
    en: "Log in to the site",
  };
  const outros = {
    fr: "Si vous avez des questions, n'hésitez pas à nous contacter.",
    en: "If you have any questions, feel free to contact us.",
  };

  const html = buildEmailHtml({
    title: titles[lang],
    subtitle: branding?.companyName || "JeChemine",
    theme: "info",
    greeting: greetings[lang],
    intro: intros[lang],
    button: { text: buttons[lang], url: loginUrl },
    outro: outros[lang],
    branding,
  });

  const text = buildEmailText([
    titles[lang],
    branding?.companyName || "JeChemine",
    greetings[lang],
    intros[lang],
    `${buttons[lang]}: ${loginUrl}`,
    outros[lang],
  ]);

  const subject =
    lang === "fr"
      ? `Invitation à rejoindre ${branding?.companyName || "JeChemine"}`
      : `Invitation to join ${branding?.companyName || "JeChemine"}`;

  return sendEmail({ to: data.email, subject, html, text }, "welcome");
}

/**
 * Sent to all admins when a new service request (appointment) is submitted.
 * Covers both authenticated clients and unauthenticated prospects.
 */
export async function sendAdminNewServiceRequestAlert(data: {
  clientName: string;
  clientEmail: string;
  bookingFor: string;
  motifs: string[];
  appointmentId: string;
}): Promise<void> {
  await connectToDatabase();
  const adminUsers = await User.find({ isAdmin: true, role: "admin" })
    .select("email")
    .lean();
  let adminEmails = adminUsers
    .map((a) => a.email)
    .filter((e): e is string => Boolean(e));
  if (adminEmails.length === 0 && process.env.ADMIN_ALERT_EMAIL) {
    adminEmails = process.env.ADMIN_ALERT_EMAIL.split(",").map((s) => s.trim());
  }
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/service-requests`;

  const html = buildEmailHtml({
    title: "Nouvelle demande de service",
    theme: "info",
    greeting: "Bonjour,",
    intro: `Une nouvelle demande de service a été soumise par ${data.clientName} (${data.clientEmail}).`,
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Pour", value: data.bookingFor },
      { label: "Motif(s)", value: data.motifs.join(", ") || "—" },
      { label: "ID Rendez-vous", value: data.appointmentId },
    ],
    button: { text: "Voir les demandes", url: adminUrl },
    branding,
  });

  const text = buildEmailText([
    "Nouvelle demande de service",
    `Client : ${data.clientName} — ${data.clientEmail}`,
    `Pour : ${data.bookingFor}`,
    `Motif(s) : ${data.motifs.join(", ") || "—"}`,
    `ID : ${data.appointmentId}`,
    adminUrl,
  ]);

  const subject = `Nouvelle demande — ${data.clientName}`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) => console.error("sendAdminNewServiceRequestAlert:", e));
  }
}

/**
 * Sent to proposed professionals whose request was taken by a colleague.
 */
export async function sendAppointmentTakenNotification(data: {
  professionalName: string;
  professionalEmail: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const dashboardUrl = `${process.env.NEXTAUTH_URL || ""}/professional/dashboard/requests`;

  const html = buildEmailHtml({
    title: "Demande de rendez-vous attribuée",
    theme: "warning",
    greeting: `Bonjour ${data.professionalName},`,
    intro:
      "Une demande de rendez-vous qui vous avait été proposée a été acceptée par un autre professionnel. Elle n'est plus disponible.",
    infoBox: {
      title: "Nouvelles demandes disponibles",
      content:
        "D'autres demandes de clients vous attendent sur votre tableau de bord.",
      theme: "info",
    },
    button: { text: "Voir les demandes disponibles", url: dashboardUrl },
    branding,
  });

  const text = buildEmailText([
    "Demande de rendez-vous attribuée",
    `Bonjour ${data.professionalName},`,
    "Une demande qui vous avait été proposée a été acceptée par un autre professionnel.",
    `Voir les nouvelles demandes : ${dashboardUrl}`,
  ]);

  const subject = "Demande attribuée à un autre professionnel — JeChemine";

  return sendEmail(
    { to: data.professionalEmail, subject, html, text },
    "appointment_professional_notification",
  );
}

/**
 * Sent to the client when their request could not be matched and moved to the general list.
 */
export async function sendRequestMovedToGeneralListEmail(data: {
  clientName: string;
  clientEmail: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";

  const title =
    lang === "fr"
      ? "Votre demande est toujours active"
      : "Your request is still active";
  const intro =
    lang === "fr"
      ? "Nous n'avons pas encore trouvé un professionnel parfaitement correspondant à votre demande. Votre dossier a été ouvert à l'ensemble de notre réseau de professionnels disponibles."
      : "We haven't yet found a perfectly matched professional for your request. Your file has been opened to our full network of available professionals.";
  const infoContent =
    lang === "fr"
      ? "Dès qu'un professionnel accepte votre demande, vous recevrez un courriel de confirmation avec les prochaines étapes."
      : "As soon as a professional accepts your request, you will receive a confirmation email with next steps.";

  const html = buildEmailHtml({
    title,
    theme: "info",
    badge: {
      text: lang === "fr" ? "⏳ Recherche en cours" : "⏳ Search in progress",
      theme: "warning",
    },
    greeting:
      lang === "fr"
        ? `Bonjour ${data.clientName},`
        : `Dear ${data.clientName},`,
    intro,
    infoBox: {
      title:
        lang === "fr" ? "Que se passe-t-il ensuite ?" : "What happens next?",
      content: infoContent,
    },
    outro:
      lang === "fr"
        ? "Merci de votre patience. Si vous avez des questions, contactez notre équipe."
        : "Thank you for your patience. If you have questions, please contact our team.",
    branding,
  });

  const text = buildEmailText([
    title,
    lang === "fr"
      ? `Bonjour ${data.clientName},`
      : `Dear ${data.clientName},`,
    intro,
    infoContent,
  ]);

  const subject =
    lang === "fr"
      ? "Votre demande est transmise à notre réseau — JeChemine"
      : "Your request has been shared with our network — JeChemine";

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "service_request_onboarding",
  );
}

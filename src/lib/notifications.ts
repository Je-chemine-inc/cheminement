/**
 * Email notification utilities for appointment scheduling
 * Sends via Mailgun HTTP API in production, SMTP fallback in dev.
 * Configurable from admin portal via PlatformSettings.
 */

import {
  sendMail as transportSendMail,
  resolveFromAddress,
  emailTransportStatus,
} from "@/lib/email-transport";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import PlatformSettings, {
  type EmailNotificationType,
  type IEmailSettings,
  type IEmailBranding,
  getDefaultEmailSettings,
} from "@/models/PlatformSettings";
import {
  getEmailTemplate,
  renderTemplate,
} from "@/lib/email-template-registry";
import type { EmailTemplateKey } from "@/models/EmailTemplate";

/**
 * Loads an admin-editable email template + renders {{placeholder}} tokens.
 * Returns `null` if the DB read fails so callers can fall back to their
 * hardcoded copy.
 */
async function loadEditableTemplate(
  key: EmailTemplateKey,
  locale: "fr" | "en",
  vars: Record<string, string | undefined>,
): Promise<{
  subject: string;
  title: string;
  subtitle?: string;
  bodyHtml: string;
  ctaText?: string;
} | null> {
  try {
    const tpl = await getEmailTemplate(key, locale);
    return {
      subject: renderTemplate(tpl.subject, vars),
      title: renderTemplate(tpl.title, vars),
      subtitle: tpl.subtitle ? renderTemplate(tpl.subtitle, vars) : undefined,
      bodyHtml: renderTemplate(tpl.bodyHtml, vars),
      ctaText: tpl.ctaText ? renderTemplate(tpl.ctaText, vars) : undefined,
    };
  } catch (error) {
    console.warn(`Failed to load editable template "${key}":`, error);
    return null;
  }
}

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
  locale?: "fr" | "en";
  /**
   * When true, the email describes a single-step activation (no SMS code
   * follow-up). Used for admin-approved professionals whose identity was
   * already verified through dossier review. Defaults to false (full 2FA
   * client flow: email link + SMS code).
   */
  singleFactor?: boolean;
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
// Configuration
// =============================================================================
// Transport (Mailgun + SMTP fallback) lives in src/lib/email-transport.ts.
// All sending goes through `transportSendMail` so the From address, threading
// headers, and message-id capture stay consistent across the codebase.

// =============================================================================
// Formatting Helpers
// =============================================================================

const formatEmailDate = (
  dateString?: string,
  lang: "fr" | "en" = "en",
): string => {
  const tba = lang === "fr" ? "À planifier" : "To be scheduled";
  if (!dateString) return tba;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return tba;
  return date.toLocaleDateString(lang === "fr" ? "fr-CA" : "en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const formatTime = (time?: string, lang: "fr" | "en" = "en"): string => {
  return time || (lang === "fr" ? "À planifier" : "To be scheduled");
};

const formatProfessionalName = (
  name?: string,
  lang: "fr" | "en" = "en",
): string => {
  return name || (lang === "fr" ? "À assigner" : "To be assigned");
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

const formatSessionType = (
  type?: "solo" | "couple" | "group",
  lang: "fr" | "en" = "en",
): string => {
  if (lang === "fr") {
    const fr: Record<string, string> = {
      solo: "Séance individuelle",
      couple: "Séance de couple",
      group: "Séance de groupe",
    };
    return fr[type || "solo"] || "Séance individuelle";
  }
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
  // " :" separator survives email clients that strip the flex layout (Gmail).
  // Non-breaking space keeps the colon glued to the label per French typography
  // and reads fine in English too.
  return `
    <div class="detail-row">
      <span class="detail-label">${label}&nbsp;:</span>
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

const createFooter = (branding?: IEmailBranding, lang: "fr" | "en" = "fr"): string => {
  const year = new Date().getFullYear();
  const url = process.env.NEXTAUTH_URL || "";
  const companyName = branding?.companyName || "JeChemine";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@jechemine.ca";
  const footerText =
    branding?.footerText ||
    (lang === "fr"
      ? "Votre parcours vers le mieux-être commence ici."
      : "Your journey to wellness starts here.");
  const primaryColor = branding?.primaryColor || "#8B7355";
  const allRights = lang === "fr" ? "Tous droits réservés." : "All rights reserved.";
  const visitSite = lang === "fr" ? "Visiter notre site web" : "Visit our website";
  const contactSupport = lang === "fr" ? "Contacter le soutien" : "Contact support";

  return `
    <div class="footer">
      <p style="margin: 0 0 5px;">${footerText}</p>
      <p style="margin: 0;">&copy; ${year} ${companyName}. ${allRights}</p>
      <p style="margin: 8px 0 0;">
        <a href="${url}" style="color: ${primaryColor};">${visitSite}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${supportEmail}" style="color: ${primaryColor};">${contactSupport}</a>
      </p>
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
  /**
   * When true, the primary button renders directly under the intro (above
   * any details/price/infoBox blocks). Used by security-critical emails like
   * 2FA activation so the CTA stays above the typical mail-client fold and
   * doesn't get clipped by Gmail/Yahoo's "view entire message" truncation.
   */
  buttonAboveInfo?: boolean;
  /** Optional second CTA (e.g. invite guest to create a full client account) */
  secondaryButton?: { preamble?: string; text: string; url: string };
  outro?: string;
  branding?: IEmailBranding;
  lang?: "fr" | "en";
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
    buttonAboveInfo,
    secondaryButton,
    outro,
    branding,
    lang = "fr",
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
            ${buttonAboveInfo && button ? createButton(button.text, button.url, branding) : ""}
            ${details ? createDetailsSection(details, detailsBorderColor || colors.primary, branding) : ""}
            ${price ? createPriceSection(price.amount, price.note, price.theme || theme, price.currency!, branding) : ""}
            ${infoBox ? createInfoBox(infoBox.title, infoBox.content, infoBox.theme, branding) : ""}
            ${!buttonAboveInfo && button ? createButton(button.text, button.url, branding) : ""}
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
          ${createFooter(branding, lang)}
        </div>
      </body>
    </html>
  `;
};

const buildEmailText = (sections: string[], lang: "fr" | "en" = "fr"): string => {
  const supportEmail = process.env.SUPPORT_EMAIL || "support@jechemine.ca";
  const copyright =
    lang === "fr"
      ? `© ${new Date().getFullYear()} JeChemine. Tous droits réservés.\nSoutien : ${supportEmail}`
      : `© ${new Date().getFullYear()} JeChemine. All rights reserved.\nSupport: ${supportEmail}`;
  return sections.filter(Boolean).join("\n\n") + `\n\n${copyright}`;
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

    const transportStatus = emailTransportStatus();
    if (!transportStatus.configured) {
      console.log("Email transport not configured. Would have sent:", {
        to: data.to,
        subject: data.subject,
        type: emailType,
      });
      return true;
    }

    const result = await transportSendMail({
      from: resolveFromAddress(
        undefined,
        settings.branding?.companyName ?? undefined,
      ),
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.text,
      attachments: data.attachments,
      tags: [emailType],
    });

    console.log(
      `Email sent [${emailType}] via ${result.backend} to ${data.to}` +
        (result.messageId ? ` (id=${result.messageId})` : ""),
    );
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
// Admin-composed outbound email
// =============================================================================

interface AdminComposedEmailData {
  to: string;
  subject: string;
  /** Plain-text body authored by the admin. Newlines preserved. */
  body: string;
  /** Reply-To header — defaults to the platform support address so replies land back in the shared inbox. */
  replyTo?: string;
  /** Display name to render in the email greeting/footer (optional). */
  recipientName?: string;
  locale?: "fr" | "en";
  /** RFC Message-Id (with brackets) this email is replying to. Enables threading. */
  inReplyTo?: string;
  /** Existing References chain to append our reply to. */
  references?: string;
}

export interface AdminComposedEmailResult {
  sent: boolean;
  /** RFC Message-Id of the sent email (with angle brackets). Used to thread future replies. */
  messageId: string | null;
}

/**
 * Sends a free-form email composed by an admin from the dashboard. The From
 * address resolves to the platform support inbox (support@jechemine.ca) via
 * `resolveFromAddress`. Reply-To defaults to the same inbox so the
 * conversation stays in the platform — overridable per-call.
 *
 * Bypasses the per-template enabled flag — admin-composed sends are
 * intentional and shouldn't be silently dropped when the welcome template is
 * disabled. Still honors the global `emailSettings.enabled` kill switch.
 */
export async function sendAdminComposedEmail(
  data: AdminComposedEmailData,
): Promise<AdminComposedEmailResult> {
  const branding = await getBranding();
  const settings = await getEmailSettings();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";

  if (!settings.enabled) {
    console.log("Email notifications globally disabled — admin compose skipped");
    return { sent: false, messageId: null };
  }

  // Convert the plain-text body to HTML paragraphs while preserving newlines.
  const bodyHtml = data.body
    .split(/\n{2,}/)
    .map((para) =>
      `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #333;">${para
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const greeting = data.recipientName
    ? lang === "fr"
      ? `Bonjour ${data.recipientName},`
      : `Hello ${data.recipientName},`
    : lang === "fr"
      ? "Bonjour,"
      : "Hello,";

  const html = buildEmailHtml({
    title: data.subject,
    theme: "info",
    greeting,
    intro: bodyHtml,
    branding,
    lang,
  });

  const text = buildEmailText([data.subject, greeting, data.body], lang);

  const transportStatus = emailTransportStatus();
  if (!transportStatus.configured) {
    console.log("Email transport not configured. Admin email would be sent:", {
      to: data.to,
      subject: data.subject,
    });
    // Surface as "sent" so the dev environment doesn't 502 the composer; the
    // record still lands in the inbox but with messageId=null (no threading).
    return { sent: true, messageId: null };
  }

  try {
    const supportInbox =
      process.env.MAIL_FROM ||
      process.env.SUPPORT_EMAIL ||
      "support@jechemine.ca";
    const result = await transportSendMail({
      from: resolveFromAddress(
        undefined,
        branding?.companyName || settings.branding?.companyName,
      ),
      to: data.to,
      // Default replies back to the shared support inbox so the next reply
      // is captured by the inbound webhook (not the admin's personal inbox).
      replyTo: data.replyTo || supportInbox,
      subject: data.subject,
      html,
      text,
      inReplyTo: data.inReplyTo,
      references: data.references,
      tags: ["admin-compose"],
    });
    console.log(
      `Admin-composed email sent via ${result.backend} to ${data.to}` +
        (result.messageId ? ` (id=${result.messageId})` : ""),
    );
    return { sent: true, messageId: result.messageId };
  } catch (error) {
    console.error("Error sending admin-composed email:", error);
    return { sent: false, messageId: null };
  }
}

// =============================================================================
// Public Email Functions - Authentication
// =============================================================================

export async function sendAccountEmailVerificationEmail(
  data: AccountEmailVerificationData,
): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const isSingleFactor = data.singleFactor === true;

  // Two variants:
  //   - singleFactor=true  → admin-approved professional. One click activates
  //                          the account; no SMS step.
  //   - default            → client 2FA flow (email link + SMS code).
  const title = isSingleFactor
    ? lang === "fr"
      ? "Activez votre compte professionnel"
      : "Activate your professional account"
    : lang === "fr"
      ? "Activez la sécurité à deux facteurs"
      : "Activate two-factor security";

  const badgeText = isSingleFactor
    ? lang === "fr"
      ? "✅ Compte approuvé par l'administration"
      : "✅ Approved by the administration"
    : lang === "fr"
      ? "🔐 Activation 2FA requise"
      : "🔐 2FA activation required";

  const intro = isSingleFactor
    ? lang === "fr"
      ? "Bonne nouvelle : votre dossier professionnel a été validé par notre équipe administrative. Un seul clic suffit maintenant pour activer votre compte et accéder à votre espace."
      : "Great news: your professional dossier has been approved by our administrative team. A single click is all you need to activate your account and access your workspace."
    : lang === "fr"
      ? "Pour finaliser l'activation de votre compte, activez l'authentification à deux facteurs en cliquant sur le bouton ci-dessous."
      : "To finalize your account activation, enable two-factor authentication by clicking the button below.";

  const buttonText = isSingleFactor
    ? lang === "fr"
      ? "Activer mon compte professionnel"
      : "Activate my professional account"
    : lang === "fr"
      ? "Activer mon compte"
      : "Activate my account";

  const infoBox = isSingleFactor
    ? {
        title:
          lang === "fr"
            ? "Et ensuite ?"
            : "What's next?",
        content:
          lang === "fr"
            ? "Une fois le bouton ci-dessus cliqué, votre compte sera immédiatement actif. Connectez-vous sur Je chemine avec le courriel et le mot de passe que vous avez choisis lors de votre inscription pour accéder à votre tableau de bord."
            : "Once you click the button above, your account will be immediately active. Sign in to Je chemine using the email and password you chose at signup to access your dashboard.",
      }
    : {
        title:
          lang === "fr"
            ? "Les deux étapes de l'activation 2FA"
            : "The two steps of 2FA activation",
        content:
          lang === "fr"
            ? "1. Confirmation de votre adresse courriel via le lien sécurisé du bouton ci-dessus.<br>2. Réception et saisie d'un code SMS à 6 chiffres envoyé sur votre téléphone."
            : "1. Confirmation of your email address via the secure link in the button above.<br>2. Receive and enter a 6-digit SMS code sent to your phone.",
      };

  const html = buildEmailHtml({
    title,
    subtitle:
      lang === "fr" ? "Lien valide 15 minutes" : "Link valid for 15 minutes",
    theme: "info",
    badge: { text: badgeText, theme: "info" },
    greeting:
      lang === "fr" ? `Bonjour ${data.name},` : `Hello ${data.name},`,
    intro,
    button: { text: buttonText, url: data.verifyUrl },
    buttonAboveInfo: true,
    infoBox,
    outro:
      lang === "fr"
        ? "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message."
        : "If you did not request this account, you can safely ignore this message.",
    branding,
    lang,
  });

  const textLines: string[] = isSingleFactor
    ? lang === "fr"
      ? [
          "Activez votre compte professionnel",
          `Bonjour ${data.name},`,
          "Votre dossier a été validé par l'administration. Cliquez sur le lien ci-dessous (valide 15 minutes) pour activer votre compte.",
          data.verifyUrl,
          "Une fois activé, connectez-vous avec le courriel et le mot de passe choisis à l'inscription pour accéder à votre tableau de bord.",
          "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.",
        ]
      : [
          "Activate your professional account",
          `Hello ${data.name},`,
          "Your dossier has been approved by the administration. Click the link below (valid for 15 minutes) to activate your account.",
          data.verifyUrl,
          "Once activated, sign in with the email and password you chose at signup to access your dashboard.",
          "If you did not request this account, you can safely ignore this message.",
        ]
    : lang === "fr"
      ? [
          "Activez la sécurité à deux facteurs",
          `Bonjour ${data.name},`,
          "Pour finaliser la création de votre compte, activez l'authentification à deux facteurs : confirmation par courriel + code SMS.",
          "Ouvrez ce lien (valide 15 minutes) pour continuer :",
          data.verifyUrl,
          "1. Confirmation de votre adresse courriel via le lien ci-dessus.",
          "2. Saisie d'un code SMS à 6 chiffres envoyé sur votre téléphone.",
          "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.",
        ]
      : [
          "Activate two-factor security",
          `Hello ${data.name},`,
          "To finalize your account, activate two-factor authentication: email confirmation + SMS code.",
          "Open this link (valid for 15 minutes) to continue:",
          data.verifyUrl,
          "1. Confirm your email address via the link above.",
          "2. Enter a 6-digit SMS code sent to your phone.",
          "If you did not request this account, you can safely ignore this message.",
        ];
  const text = buildEmailText(textLines, lang);

  const fallbackSubject = isSingleFactor
    ? lang === "fr"
      ? "Activez votre compte professionnel — Je chemine"
      : "Activate your professional account — Je chemine"
    : lang === "fr"
      ? "Activez votre compte (2FA) — Je chemine"
      : "Activate your account (2FA) — Je chemine";
  const subject = await getSubject("email_verification", fallbackSubject);

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
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const companyName = branding?.companyName || "JeChemine";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@jechemine.ca";

  // Only the "client" welcome flow is admin-editable in DB. Other roles
  // (guest, prospect) keep the legacy single-language copy.
  if (data.role === "client") {
    const editable = await loadEditableTemplate("welcomeClient", lang, {
      firstName: data.name,
      dashboardUrl,
      companyName,
      supportEmail,
    });
    if (editable) {
      const html = buildEmailHtml({
        title: editable.title,
        subtitle: editable.subtitle,
        theme: "success",
        greeting: "",
        intro: editable.bodyHtml,
        button: editable.ctaText
          ? { text: editable.ctaText, url: dashboardUrl }
          : undefined,
        branding,
        lang,
      });
      const text = buildEmailText(
        [
          editable.title,
          editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          editable.ctaText ? `${editable.ctaText} : ${dashboardUrl}` : "",
        ],
        lang,
      );
      return sendEmail(
        { to: data.email, subject: editable.subject, html, text },
        "welcome",
      );
    }
  }

  const roleMessages: Record<string, string> = {
    client:
      "Vous pouvez maintenant consulter les professionnels, réserver des rendez-vous et accéder aux ressources pour soutenir votre parcours de mieux-être.",
    professional:
      "Votre compte est en attente d'approbation. Une fois approuvé, vous pourrez gérer vos rendez-vous, vous connecter avec des clients et développer votre pratique.",
    guest: "Vous pouvez suivre votre rendez-vous et recevoir des mises à jour par courriel.",
  };

  const html = buildEmailHtml({
    title: "Bienvenue !",
    subtitle: `Vous avez rejoint ${companyName}`,
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
    `Bienvenue sur ${companyName} !`,
    `Bonjour ${data.name},`,
    `Merci d'avoir créé votre compte.`,
    roleMessages[data.role] || "",
    data.role !== "guest" && data.role !== "prospect" ? `Accédez à votre tableau de bord : ${dashboardUrl}` : "",
  ]);

  const subject = await getSubject("welcome", "Bienvenue sur JeChemine !");

  return sendEmail({ to: data.email, subject, html, text }, "welcome");
}

export async function sendProfessionalProfileCompletedEmail(
  data: WelcomeEmailData,
): Promise<boolean> {
  const branding = await getBranding();
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/professional/dashboard`;
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const companyName = branding?.companyName || "Je chemine";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@jechemine.ca";

  const editable = await loadEditableTemplate("welcomeProfessional", lang, {
    firstName: data.name,
    dashboardUrl,
    companyName,
    supportEmail,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "success",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: dashboardUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${dashboardUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.email, subject: editable.subject, html, text },
      "welcome",
    );
  }

  // Fallback (DB unavailable) — original hardcoded copy.
  const html = buildEmailHtml({
    title: "Bienvenue dans l'équipe Je chemine !",
    subtitle: "Profil complété — un administrateur prendra contact avec vous",
    theme: "success",
    greeting: `Bonjour ${data.name},`,
    intro:
      "C'est un réel plaisir de vous compter parmi nos nouveaux collaborateurs ! Votre expertise est une valeur précieuse pour notre communauté, et nous avons hâte de vous voir accompagner vos futurs clients via la plateforme Je chemine.",
    infoBox: {
      title: "🌟 Prochaine étape : activation de votre compte",
      content:
        "Pour garantir la qualité de notre réseau et assurer une expérience optimale pour tous, un administrateur communiquera avec vous très bientôt. Cet échange rapide permettra de valider les derniers détails et de rendre votre profil officiellement actif sur la plateforme afin que vous puissiez commencer à recevoir des demandes.",
      theme: "info",
    },
    button: { text: "Accéder au tableau de bord", url: dashboardUrl },
    outro:
      "✅ Un profil évolutif que vous pouvez modifier à votre guise — vous pourrez l'ajuster, l'enrichir ou modifier vos disponibilités en tout temps, même une fois votre compte activé.\n\nChaleureusement,\nL'équipe de Je chemine",
    branding,
  });

  const text = buildEmailText([
    "Bienvenue dans l'équipe Je chemine !",
    `Bonjour ${data.name},`,
    "C'est un réel plaisir de vous compter parmi nos nouveaux collaborateurs ! Votre expertise est une valeur précieuse pour notre communauté, et nous avons hâte de vous voir accompagner vos futurs clients via la plateforme Je chemine.",
    "Prochaine étape : activation de votre compte",
    "Pour garantir la qualité de notre réseau et assurer une expérience optimale pour tous, un administrateur communiquera avec vous très bientôt. Cet échange rapide permettra de valider les derniers détails et de rendre votre profil officiellement actif sur la plateforme afin que vous puissiez commencer à recevoir des demandes.",
    "Un profil évolutif que vous pouvez modifier à votre guise — vous pourrez l'ajuster, l'enrichir ou modifier vos disponibilités en tout temps, même une fois votre compte activé.",
    `Tableau de bord : ${dashboardUrl}`,
    "Chaleureusement,",
    "L'équipe de Je chemine",
  ]);

  const subject = "Bienvenue dans l'équipe Je chemine !";

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
// Public Email Functions - Service request onboarding link (admin approval)
// =============================================================================

export async function sendServiceRequestOnboardingEmail(data: {
  toName: string;
  toEmail: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const baseUrl = process.env.NEXTAUTH_URL || "";
  const memberSignupUrl = `${baseUrl}/signup/member?email=${encodeURIComponent(
    data.toEmail,
  )}`;

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Votre demande est bien reçue !"
        : "We've received your request!",
    subtitle:
      lang === "fr"
        ? "Prochaines étapes avec Je chemine"
        : "Next steps with Je chemine",
    theme: "info",
    badge: {
      text: lang === "fr" ? "✅ Demande reçue" : "✅ Request received",
      theme: "success",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.toName},` : `Hello ${data.toName},`,
    intro:
      lang === "fr"
        ? "Nous avons bien reçu votre demande et nous vous remercions de nous avoir choisis pour vous accompagner dans votre parcours. Toute l'équipe de Je chemine est déjà à l'œuvre pour vous offrir un service de qualité."
        : "We have received your request and thank you for choosing us to support you on your journey. The entire Je chemine team is already at work to provide you with quality service.",
    infoBox: {
      title:
        lang === "fr"
          ? "🔍 Votre demande est entre de bonnes mains"
          : "🔍 Your request is in good hands",
      content:
        lang === "fr"
          ? "Actuellement, nos professionnels examinent les détails de votre dossier. Notre objectif est simple : vous orienter vers la ressource la plus adaptée à votre situation pour que votre démarche soit une réussite dès le premier contact.<br><br><strong>Optimisez votre jumelage</strong><br>Pour nous aider à bien vous comprendre et à vous diriger efficacement, nous vous invitons à finaliser la création de votre profil de membre via le lien ci-dessous."
          : "Our professionals are currently reviewing the details of your file. Our goal is simple: to guide you to the resource best suited to your situation so that your journey is a success from the very first contact.<br><br><strong>Optimize your matching</strong><br>To help us understand you better and direct you effectively, we invite you to finalize the creation of your member profile via the link below.",
    },
    button: {
      text:
        lang === "fr"
          ? "Finaliser mon profil de membre"
          : "Complete my member profile",
      url: memberSignupUrl,
    },
    outro:
      lang === "fr"
        ? "<strong>Pourquoi prendre ces quelques minutes ?</strong> Ce questionnaire est conçu pour être fluide et rapide à remplir. En apprenant à mieux vous connaître, nous nous assurons que le professionnel que nous vous suggérerons possèdera l'expertise précise dont vous avez besoin.<br><br>Dès que votre profil sera complété et notre analyse terminée, nous communiquerons avec vous pour la suite des choses.<br><br>Merci de faire équipe avec nous pour votre bien-être.<br><br>Chaleureusement,<br>L'équipe de Je chemine"
        : "<strong>Why take a few minutes?</strong> This questionnaire is designed to be smooth and quick to fill out. By getting to know you better, we ensure that the professional we suggest will have the precise expertise you need.<br><br>As soon as your profile is completed and our analysis is finished, we will contact you with next steps.<br><br>Thank you for teaming up with us for your well-being.<br><br>Warmly,<br>The Je chemine team",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Votre demande est bien reçue !",
          `Bonjour ${data.toName},`,
          "Nous avons bien reçu votre demande et nous vous remercions de nous avoir choisis pour vous accompagner dans votre parcours. Toute l'équipe de Je chemine est déjà à l'œuvre pour vous offrir un service de qualité.",
          "🔍 Votre demande est entre de bonnes mains",
          "Actuellement, nos professionnels examinent les détails de votre dossier. Notre objectif est simple : vous orienter vers la ressource la plus adaptée à votre situation pour que votre démarche soit une réussite dès le premier contact.",
          "Optimisez votre jumelage",
          "Pour nous aider à bien vous comprendre et à vous diriger efficacement, nous vous invitons à finaliser la création de votre profil de membre via le lien ci-dessous :",
          memberSignupUrl,
          "Pourquoi prendre ces quelques minutes ? Ce questionnaire est conçu pour être fluide et rapide à remplir. En apprenant à mieux vous connaître, nous nous assurons que le professionnel que nous vous suggérerons possèdera l'expertise précise dont vous avez besoin.",
          "Dès que votre profil sera complété et notre analyse terminée, nous communiquerons avec vous pour la suite des choses.",
          "Merci de faire équipe avec nous pour votre bien-être.",
          "Chaleureusement,",
          "L'équipe de Je chemine",
        ]
      : [
          "We've received your request!",
          `Hello ${data.toName},`,
          "We have received your request and thank you for choosing us to support you on your journey. The entire Je chemine team is already at work to provide you with quality service.",
          "🔍 Your request is in good hands",
          "Our professionals are currently reviewing the details of your file. Our goal is simple: to guide you to the resource best suited to your situation so that your journey is a success from the very first contact.",
          "Optimize your matching",
          "To help us understand you better and direct you effectively, we invite you to finalize the creation of your member profile via the link below:",
          memberSignupUrl,
          "Why take a few minutes? This questionnaire is designed to be smooth and quick to fill out. By getting to know you better, we ensure that the professional we suggest will have the precise expertise you need.",
          "As soon as your profile is completed and our analysis is finished, we will contact you with next steps.",
          "Thank you for teaming up with us for your well-being.",
          "Warmly,",
          "The Je chemine team",
        ],
    lang,
  );

  const subject = await getSubject(
    "service_request_onboarding",
    lang === "fr"
      ? "Votre demande est bien reçue ! Prochaines étapes avec Je chemine"
      : "We've received your request! Next steps with Je chemine",
  );

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
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const formattedDate = formatEmailDate(data.date, lang);
  const formattedTime = formatTime(data.time, lang);
  const professionalName = formatProfessionalName(data.professionalName, lang);
  const sessionType = formatSessionType(data.therapyType, lang);
  const appointmentType = formatAppointmentType(data.type, lang);

  const details =
    lang === "fr"
      ? [
          { label: "Type de séance", value: sessionType },
          { label: "Type de rendez-vous", value: appointmentType },
          { label: "Professionnel", value: professionalName },
          { label: "Date", value: formattedDate },
          { label: "Heure", value: formattedTime },
          { label: "Durée", value: `${data.duration} minutes` },
        ]
      : [
          { label: "Session type", value: sessionType },
          { label: "Appointment type", value: appointmentType },
          { label: "Professional", value: professionalName },
          { label: "Date", value: formattedDate },
          { label: "Time", value: formattedTime },
          { label: "Duration", value: `${data.duration} minutes` },
        ];

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Prochaine étape : confirmez votre rendez-vous"
        : "Next step: confirm your appointment",
    subtitle:
      lang === "fr"
        ? "Votre professionnel a confirmé votre séance"
        : "Your professional has confirmed your session",
    theme: "info",
    badge: {
      text:
        lang === "fr" ? "✅ Rendez-vous confirmé" : "✅ Appointment confirmed",
      theme: "success",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.guestName},` : `Hello ${data.guestName},`,
    intro:
      lang === "fr"
        ? "Votre rendez-vous est confirmé. Ouvrez le lien sécurisé ci-dessous pour ajouter vos coordonnées de paiement (carte, virement Interac via Stripe, ou prélèvement automatique canadien). Aucun montant n'est prélevé avant que votre séance ait eu lieu et que votre professionnel la marque comme complétée. Stripe traite vos informations bancaires — nous ne les stockons pas."
        : "Your appointment is confirmed. Open the secure link below to add your payment information (card, Interac e-Transfer via Stripe, or Canadian pre-authorized debit). No amount is charged before your session has taken place and your professional has marked it as complete. Stripe handles your banking information — we do not store it.",
    details,
    detailsBorderColor: branding?.primaryColor,
    price: {
      amount: data.price,
      note:
        lang === "fr"
          ? "Frais de séance (prélevés après la séance complétée)"
          : "Session fee (charged after the session is completed)",
      theme: "info",
      currency,
    },
    button: data.paymentLink
      ? {
          text:
            lang === "fr"
              ? "Confirmer avec mes coordonnées de paiement"
              : "Confirm with my payment information",
          url: data.paymentLink,
        }
      : undefined,
    infoBox: {
      title:
        lang === "fr"
          ? "Paiements sécurisés avec Stripe"
          : "Payments secured by Stripe",
      content:
        lang === "fr"
          ? "Une fois votre moyen de paiement enregistré, vous pourrez accéder à votre lien de réunion. Le paiement n'est traité qu'après la complétion de la séance."
          : "Once your payment method is saved, you will be able to access your meeting link. Payment is only processed after the session is completed.",
    },
    outro:
      lang === "fr"
        ? "Si vous avez besoin d'aide, contactez-nous via les coordonnées indiquées sur notre site web."
        : "If you need help, contact us using the information on our website.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
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
        ]
      : [
          "Confirm your appointment (payment after the session)",
          `Hello ${data.guestName},`,
          "Your appointment is confirmed. Use your personal link to add a payment method. You will only be charged after the session is completed. Stripe handles your banking information.",
          "SESSION DETAILS:",
          `Session type: ${sessionType}`,
          `Appointment type: ${appointmentType}`,
          `Professional: ${professionalName}`,
          `Date: ${formattedDate}`,
          `Time: ${formattedTime}`,
          `Duration: ${data.duration} minutes`,
          `Amount due: ${data.price.toFixed(2)} ${currency}`,
          data.paymentLink ? `Confirm payment: ${data.paymentLink}` : "",
        ],
    lang,
  );

  // Locale-aware subject — bypass admin override here because the stored
  // template subject is single-language and would mismatch the body language.
  const subject =
    lang === "fr"
      ? "Rendez-vous confirmé — prochaine étape : votre paiement"
      : "Appointment confirmed — next step: your payment";

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

/**
 * Email 7 — H-72 reminder. Includes a cancel button AND a "request another
 * appointment" button. Free cancellation window is still open at this point.
 */
export async function sendAppointment72hReminder(data: {
  clientName: string;
  clientEmail: string;
  professionalName?: string;
  appointmentDateLabel: string;
  cancelUrl: string;
  rescheduleUrl: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const professionalName = formatProfessionalName(data.professionalName, lang);

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Votre rendez-vous est dans 72 heures"
        : "Your appointment is in 72 hours",
    subtitle:
      lang === "fr"
        ? "Vous pouvez encore annuler ou reporter sans frais"
        : "You can still cancel or reschedule free of charge",
    theme: "info",
    badge: {
      text: lang === "fr" ? "🗓️ Rappel — 72 h" : "🗓️ Reminder — 72h",
      theme: "info",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? `Petit rappel : votre rendez-vous avec ${professionalName} est prévu le ${data.appointmentDateLabel}. Vous êtes encore dans la fenêtre d'annulation gratuite (jusqu'à 48 h avant la séance).`
        : `Friendly reminder: your appointment with ${professionalName} is scheduled on ${data.appointmentDateLabel}. You are still within the free-cancellation window (until 48h before the session).`,
    infoBox: {
      title:
        lang === "fr" ? "Besoin de changer vos plans ?" : "Need to change your plans?",
      content:
        lang === "fr"
          ? "Annulez votre rendez-vous sans frais ou demandez une nouvelle date. Passé le délai de 48 h avant la séance, l'annulation entraînera des frais de 15 %."
          : "Cancel your appointment free of charge or request a new date. After the 48h window before the session, cancellation will incur a 15% fee.",
    },
    button: {
      text:
        lang === "fr" ? "Annuler mon rendez-vous" : "Cancel my appointment",
      url: data.cancelUrl,
    },
    secondaryButton: {
      preamble:
        lang === "fr"
          ? "Vous souhaitez plutôt déplacer la séance ? Demandez un autre rendez-vous :"
          : "Prefer to move the session? Request another appointment:",
      text:
        lang === "fr"
          ? "Demander un autre rendez-vous"
          : "Request another appointment",
      url: data.rescheduleUrl,
    },
    outro:
      lang === "fr"
        ? "Nous avons hâte de vous accompagner. À très bientôt !"
        : "We look forward to supporting you. See you soon!",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Rappel — votre rendez-vous est dans 72 heures",
          `Bonjour ${data.clientName},`,
          `Rendez-vous avec ${professionalName} le ${data.appointmentDateLabel}.`,
          "Vous pouvez encore annuler ou reporter sans frais.",
          `Annuler : ${data.cancelUrl}`,
          `Demander un autre rendez-vous : ${data.rescheduleUrl}`,
        ]
      : [
          "Reminder — your appointment is in 72 hours",
          `Hello ${data.clientName},`,
          `Appointment with ${professionalName} on ${data.appointmentDateLabel}.`,
          "You can still cancel or reschedule free of charge.",
          `Cancel: ${data.cancelUrl}`,
          `Request another appointment: ${data.rescheduleUrl}`,
        ],
    lang,
  );

  const subject =
    lang === "fr"
      ? "Rappel : rendez-vous dans 72 heures — Je chemine"
      : "Reminder: appointment in 72 hours — Je chemine";

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "appointment_reminder_72h",
  );
}

/**
 * Email 7b — H-48 reminder. Past the free-cancellation window: no cancel /
 * reschedule buttons. The email simply confirms the session and explains the
 * cancellation policy at this point.
 */
export async function sendAppointment48hReminder(data: {
  clientName: string;
  clientEmail: string;
  professionalName?: string;
  appointmentDateLabel: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const professionalName = formatProfessionalName(data.professionalName, lang);

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Votre rendez-vous est dans 48 heures"
        : "Your appointment is in 48 hours",
    subtitle:
      lang === "fr"
        ? "Délai d'annulation gratuite dépassé"
        : "Free-cancellation window closed",
    theme: "warning",
    badge: {
      text: lang === "fr" ? "⏰ Rappel — 48 h" : "⏰ Reminder — 48h",
      theme: "warning",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? `Votre rendez-vous avec ${professionalName} aura lieu dans 48 heures (${data.appointmentDateLabel}). Merci de bien noter cette date — la séance est désormais confirmée.`
        : `Your appointment with ${professionalName} will take place in 48 hours (${data.appointmentDateLabel}). Please make note of this date — the session is now confirmed.`,
    infoBox: {
      title:
        lang === "fr"
          ? "Politique d'annulation"
          : "Cancellation policy",
      content:
        lang === "fr"
          ? "Le délai d'annulation gratuite est dépassé. Toute annulation moins de 48 h avant la séance entraîne des frais équivalents à 15 % du tarif. En cas d'absence non signalée, des frais de gestion de dossier peuvent s'appliquer."
          : "The free-cancellation window has closed. Any cancellation within 48h of the session will incur a fee equivalent to 15% of the rate. In case of an unannounced no-show, file-management fees may apply.",
    },
    outro:
      lang === "fr"
        ? "Préparez votre séance : trouvez un endroit calme, vérifiez votre connexion et soyez prêt(e) quelques minutes à l'avance. À très bientôt !"
        : "Prepare for your session: find a quiet space, check your connection, and be ready a few minutes early. See you soon!",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Rappel — votre rendez-vous est dans 48 heures",
          `Bonjour ${data.clientName},`,
          `Rendez-vous avec ${professionalName} le ${data.appointmentDateLabel}.`,
          "Le délai d'annulation gratuite est dépassé : 15 % de frais s'appliquent en cas d'annulation tardive.",
        ]
      : [
          "Reminder — your appointment is in 48 hours",
          `Hello ${data.clientName},`,
          `Appointment with ${professionalName} on ${data.appointmentDateLabel}.`,
          "The free-cancellation window has closed: a 15% fee applies for late cancellations.",
        ],
    lang,
  );

  const subject =
    lang === "fr"
      ? "Rappel : rendez-vous dans 48 heures — Je chemine"
      : "Reminder: appointment in 48 hours — Je chemine";

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "appointment_reminder_48h",
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
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";

  const amountFr = `${data.amountCad.toFixed(2)} $ CAD`;
  const amountEn = `CAD $${data.amountCad.toFixed(2)}`;

  const html = buildEmailHtml({
    title:
      data.paymentPendingTransfer
        ? lang === "fr"
          ? "Reçu de votre séance — paiement en attente"
          : "Your session receipt — payment pending"
        : lang === "fr"
          ? "Merci — paiement confirmé"
          : "Thank you — payment confirmed",
    subtitle:
      lang === "fr"
        ? "Votre reçu fiscal est en pièce jointe"
        : "Your tax receipt is attached",
    theme: data.paymentPendingTransfer ? "warning" : "success",
    badge: {
      text: data.paymentPendingTransfer
        ? lang === "fr"
          ? "⏳ Paiement en attente"
          : "⏳ Payment pending"
        : lang === "fr"
          ? "💳 Paiement reçu"
          : "💳 Payment received",
      theme: data.paymentPendingTransfer ? "warning" : "success",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro: data.paymentPendingTransfer
      ? lang === "fr"
        ? `Votre séance est enregistrée. Le montant dû est de ${amountFr} (virement Interac). Les instructions de virement ont été ou seront envoyées par courriel. Vous trouverez en pièce jointe votre reçu fiscal.`
        : `Your session is recorded. The amount due is ${amountEn} (Interac e-Transfer). The transfer instructions have been or will be sent by email. You will find your tax receipt attached.`
      : lang === "fr"
        ? `Merci ! Votre paiement de ${amountFr} a bien été traité. Toute l'équipe de Je chemine vous remercie de votre confiance. Vous trouverez votre reçu fiscal en pièce jointe — gardez-le précieusement pour vos remboursements (assurance, impôts).`
        : `Thank you! Your payment of ${amountEn} has been processed. The entire Je chemine team thanks you for your trust. Your tax receipt is attached — keep it for your reimbursements (insurance, taxes).`,
    infoBox: data.paymentPendingTransfer
      ? undefined
      : {
          title:
            lang === "fr"
              ? "À propos de votre reçu"
              : "About your receipt",
          content:
            lang === "fr"
              ? "Le PDF en pièce jointe contient les informations requises pour vos remboursements d'assurance et déclarations fiscales (numéro de licence du professionnel, date, montant)."
              : "The attached PDF contains the information required for your insurance reimbursements and tax filings (professional license number, date, amount).",
        },
    outro:
      lang === "fr"
        ? "Chaleureusement,<br>L'équipe de Je chemine"
        : "Warmly,<br>The Je chemine team",
    branding,
    lang,
  });
  const text = buildEmailText(
    lang === "fr"
      ? [
          data.paymentPendingTransfer
            ? "Reçu de séance — paiement en attente"
            : "Merci — paiement confirmé",
          `Bonjour ${data.clientName},`,
          data.paymentPendingTransfer
            ? `Montant dû (Interac) : ${amountFr}`
            : `Paiement reçu : ${amountFr} — merci de votre confiance.`,
          "Reçu fiscal en pièce jointe.",
          "Chaleureusement,",
          "L'équipe de Je chemine",
        ]
      : [
          data.paymentPendingTransfer
            ? "Session receipt — payment pending"
            : "Thank you — payment confirmed",
          `Hello ${data.clientName},`,
          data.paymentPendingTransfer
            ? `Amount due (Interac): ${amountEn}`
            : `Payment received: ${amountEn} — thank you for your trust.`,
          "Tax receipt attached.",
          "Warmly,",
          "The Je chemine team",
        ],
    lang,
  );

  const subject =
    data.paymentPendingTransfer
      ? lang === "fr"
        ? "Reçu de séance — paiement Interac en attente"
        : "Session receipt — Interac payment pending"
      : lang === "fr"
        ? "Merci — paiement confirmé et reçu fiscal"
        : "Thank you — payment confirmed and tax receipt";

  return sendEmail(
    {
      to: data.clientEmail,
      subject,
      html,
      text,
      attachments: [
        {
          filename:
            lang === "fr"
              ? `recu-${data.appointmentId.slice(-8)}.pdf`
              : `receipt-${data.appointmentId.slice(-8)}.pdf`,
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
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Rappel : choisissez votre moyen de paiement"
        : "Reminder: choose your payment method",
    subtitle:
      lang === "fr"
        ? "Il reste une étape pour finaliser votre dossier"
        : "One step left to finalize your file",
    theme: "warning",
    badge: {
      text: lang === "fr" ? "⏳ Action requise" : "⏳ Action required",
      theme: "warning",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? "Votre jumelage est confirmé, mais nous n'avons pas encore reçu votre mode de paiement (carte, prélèvement automatique ou virement Interac). Pour garantir votre rendez-vous, sélectionnez votre mode de paiement dès maintenant."
        : "Your match is confirmed, but we haven't received your payment method yet (card, pre-authorized debit, or Interac e-Transfer). To guarantee your appointment, please choose your payment method now.",
    button: {
      text:
        lang === "fr"
          ? "Choisir mon mode de paiement"
          : "Choose my payment method",
      url: data.billingUrl,
    },
    outro:
      lang === "fr"
        ? "Si vous avez déjà choisi le virement Interac, votre demande est en cours de traitement par notre administration."
        : "If you have already chosen Interac e-Transfer, your request is being processed by our administration.",
    branding,
    lang,
  });
  const text = buildEmailText(
    lang === "fr"
      ? [
          "Rappel : choisissez votre moyen de paiement",
          `Bonjour ${data.clientName},`,
          "Votre jumelage est confirmé, mais nous n'avons pas encore reçu votre mode de paiement.",
          "Choisir mon mode de paiement :",
          data.billingUrl,
        ]
      : [
          "Reminder: choose your payment method",
          `Hello ${data.clientName},`,
          "Your match is confirmed, but we haven't received your payment method yet.",
          "Choose my payment method:",
          data.billingUrl,
        ],
    lang,
  );
  const subject = await getSubject(
    "payment_guarantee_day1_reminder",
    lang === "fr"
      ? "Rappel : choisissez votre moyen de paiement — Je chemine"
      : "Reminder: choose your payment method — Je chemine",
  );
  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_guarantee_day1_reminder",
  );
}

export async function sendPaymentGuaranteeDay2Reminder(data: {
  clientName: string;
  clientEmail: string;
  billingUrl: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Dernier rappel : moyen de paiement requis"
        : "Final reminder: payment method required",
    subtitle:
      lang === "fr"
        ? "Votre dossier est en attente depuis 48 heures"
        : "Your file has been pending for 48 hours",
    theme: "danger",
    badge: {
      text: lang === "fr" ? "⚠️ Dernier rappel" : "⚠️ Final reminder",
      theme: "danger",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? "48 heures se sont écoulées depuis votre jumelage et nous n'avons toujours pas reçu votre choix de mode de paiement. Sans cette étape, nous ne pouvons pas garantir votre rendez-vous. Merci de finaliser cette dernière étape pour sécuriser votre suivi."
        : "It has been 48 hours since your match and we still haven't received your payment method choice. Without this step, we cannot guarantee your appointment. Please complete this final step to secure your follow-up.",
    infoBox: {
      title:
        lang === "fr" ? "Modes de paiement disponibles" : "Available payment methods",
      content:
        lang === "fr"
          ? "Carte de crédit (sécurisée par Stripe), prélèvement automatique canadien, ou virement Interac. Aucun montant n'est prélevé avant que votre séance ait eu lieu."
          : "Credit card (secured by Stripe), Canadian pre-authorized debit, or Interac e-Transfer. No amount is charged before your session has taken place.",
    },
    button: {
      text:
        lang === "fr"
          ? "Choisir mon mode de paiement"
          : "Choose my payment method",
      url: data.billingUrl,
    },
    outro:
      lang === "fr"
        ? "Si vous rencontrez des difficultés, contactez notre équipe via votre tableau de bord. Nous sommes là pour vous accompagner."
        : "If you encounter any difficulties, contact our team via your dashboard. We are here to support you.",
    branding,
    lang,
  });
  const text = buildEmailText(
    lang === "fr"
      ? [
          "Dernier rappel : moyen de paiement requis",
          `Bonjour ${data.clientName},`,
          "48 heures se sont écoulées depuis votre jumelage. Merci de finaliser le choix de votre mode de paiement pour sécuriser votre rendez-vous.",
          "Choisir mon mode de paiement :",
          data.billingUrl,
        ]
      : [
          "Final reminder: payment method required",
          `Hello ${data.clientName},`,
          "48 hours have passed since your match. Please complete your payment method selection to secure your appointment.",
          "Choose my payment method:",
          data.billingUrl,
        ],
    lang,
  );
  const subject = await getSubject(
    "payment_guarantee_day2_reminder",
    lang === "fr"
      ? "Dernier rappel : moyen de paiement requis — Je chemine"
      : "Final reminder: payment method required — Je chemine",
  );
  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_guarantee_day2_reminder",
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
  /** Link inviting the client to finish setting up their account (claim or complete profile). */
  completeAccountUrl?: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const billingUrl = `${base}/client/dashboard/billing?action=addPaymentMethod`;
  const companyName = branding?.companyName || "Je chemine";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@jechemine.ca";

  const editable = await loadEditableTemplate("jumelageSuccess", lang, {
    firstName: data.clientName,
    professionalName: data.professionalName ?? "",
    billingUrl,
    completeAccountUrl: data.completeAccountUrl ?? "",
    companyName,
    supportEmail,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "success",
      badge: {
        text: lang === "fr" ? "✅ Jumelage confirmé" : "✅ Match confirmed",
        theme: "success",
      },
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: billingUrl }
        : undefined,
      secondaryButton: data.completeAccountUrl
        ? {
            preamble:
              lang === "fr"
                ? "Vous pouvez aussi finaliser la configuration de votre compte pour accéder à votre tableau de bord et à toutes les fonctionnalités."
                : "You can also finish setting up your account to access your dashboard and all features.",
            text:
              lang === "fr" ? "Compléter mon compte" : "Complete my account",
            url: data.completeAccountUrl,
          }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${billingUrl}` : "",
        data.completeAccountUrl
          ? lang === "fr"
            ? `Compléter mon compte : ${data.completeAccountUrl}`
            : `Complete my account: ${data.completeAccountUrl}`
          : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "payment_invitation",
    );
  }

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
      ? "Carte de crédit : vos données sont sécurisées par Stripe. Votre carte sera validée et aucun montant n'est prélevé avant la séance.<br><br>Virement Interac : choisissez cette option si vous préférez payer par courriel Interac. L'administration validera votre dossier."
      : "Credit card: your data is secured by Stripe. Your card is validated and nothing is charged before the session.<br><br>Interac e-Transfer: choose this option if you prefer to pay by Interac email transfer. Admin will validate your file.";

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
      text:
        lang === "fr"
          ? "Choisir mon mode de paiement"
          : "Choose my payment method",
      url: billingUrl,
    },
    secondaryButton: data.completeAccountUrl
      ? {
          preamble:
            lang === "fr"
              ? "Vous pouvez aussi finaliser la configuration de votre compte pour accéder à votre tableau de bord et à toutes les fonctionnalités."
              : "You can also finish setting up your account to access your dashboard and all features.",
          text:
            lang === "fr"
              ? "Compléter mon compte"
              : "Complete my account",
          url: data.completeAccountUrl,
        }
      : undefined,
    outro:
      lang === "fr"
        ? "Si vous avez des questions, contactez notre équipe depuis votre tableau de bord."
        : "If you have questions, contact our team from your dashboard.",
    branding,
    lang,
  });

  const text = buildEmailText(
    [
      title,
      lang === "fr" ? `Bonjour ${data.clientName},` : `Dear ${data.clientName},`,
      intro,
      lang === "fr"
        ? "Choisir mon mode de paiement :"
        : "Choose my payment method:",
      billingUrl,
      data.completeAccountUrl
        ? lang === "fr"
          ? `Compléter mon compte : ${data.completeAccountUrl}`
          : `Complete my account: ${data.completeAccountUrl}`
        : "",
    ],
    lang,
  );

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
  const billingUrl = `${base}/client/dashboard/billing?action=addPaymentMethod`;

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

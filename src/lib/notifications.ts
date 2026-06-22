/**
 * Email notification utilities for appointment scheduling.
 * Sends via Nodemailer SMTP. Configurable from admin portal via PlatformSettings.
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
  DEFAULT_EMAIL_FOOTER_TEXT,
} from "@/models/PlatformSettings";
import {
  getEmailTemplate,
  renderTemplate,
} from "@/lib/email-template-registry";
import type { EmailTemplateKey } from "@/models/EmailTemplate";
import { findRealAccountByEmail } from "@/lib/account-dedup";

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
  locale?: "fr" | "en";
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

export async function getEmailSettings(): Promise<IEmailSettings> {
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
// Transport (Nodemailer SMTP) lives in src/lib/email-transport.ts.
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
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    img { border: 0; max-width: 100%; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    .container { width: 100%; max-width: 600px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
    .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${primaryColor}; }
    .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #666; font-size: 14px; }
    .detail-value { font-weight: 600; color: #333; }
    .button { display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, ${branding?.secondaryColor || "#6B5344"} 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 25px; margin: 20px 0; font-weight: 500; }
    .footer { text-align: center; color: #666; font-size: 12px; padding: 24px 20px; line-height: 1.7; }
    .footer a { color: ${primaryColor}; text-decoration: none; }
    .footer-link { color: ${primaryColor}; text-decoration: none; display: inline-block; padding: 2px 4px; }
    .footer-sep { color: #b8b0a8; padding: 0 2px; }

    /* Mobile (phone) optimisation — most clients that honour the embedded
       <style> above (Apple Mail, iOS Mail, Gmail app) also honour this query.
       !important is required so these rules beat the inline styles. */
    @media only screen and (max-width: 600px) {
      .container { padding: 10px !important; }
      .content { padding: 22px 18px !important; }
      .header { padding: 26px 18px !important; }
      .header h1 { font-size: 22px !important; }
      .header p { font-size: 15px !important; }
      .details { padding: 16px !important; }
      .button { display: block !important; width: 100% !important; box-sizing: border-box !important; padding: 16px 20px !important; margin: 18px 0 !important; text-align: center !important; }
      .footer { padding: 20px 14px !important; }
      .footer-link { display: block !important; padding: 9px 0 !important; font-size: 14px !important; }
      .footer-sep { display: none !important; }
    }
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
  stacked = false,
): string => {
  const primaryColor = branding?.primaryColor || "#8B7355";
  const valueHtml = isLink
    ? `<a href="${value}" style="color: ${primaryColor};">${value.includes("Join") ? "Join Session" : value}</a>`
    : value;
  // Stacked rows put the label on its own line above a full-width value —
  // used for long explanatory values (e.g. the Interac account-name guidance)
  // that look cramped squeezed into the right column of the flex layout. Inline
  // display:block overrides the `.detail-row` flex so it survives Gmail too.
  if (stacked) {
    return `
    <div class="detail-row" style="display: block;">
      <span class="detail-label" style="display: block; margin-bottom: 4px;">${label}&nbsp;:</span>
      <span class="detail-value" style="display: block;">${valueHtml}</span>
    </div>
  `;
  }
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
  details: Array<{
    label: string;
    value: string;
    isLink?: boolean;
    stacked?: boolean;
  }>,
  borderColor = "#8B7355",
  branding?: IEmailBranding,
): string => {
  const rows = details
    .map((d) => createDetailRow(d.label, d.value, d.isLink, branding, d.stacked))
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
  // Bulletproof email button: solid background-color is mandatory because most
  // mail clients (mobile Gmail, Outlook, Yahoo) silently drop CSS gradients.
  // Without a fallback the button rendered as invisible white-on-white. The
  // `bgcolor` attribute also helps the oldest Outlook versions. The gradient
  // is kept as a progressive enhancement for clients that support it (split
  // into background-color + background-image so the shorthand doesn't reset
  // the solid fill).
  // class="button" lets the responsive @media rule turn the CTA into a
  // full-width, easy-to-tap block on phones while the inline styles stay as
  // the bulletproof desktop/no-CSS fallback.
  return `<div style="text-align: center;"><a href="${url}" class="button" bgcolor="${primaryColor}" style="display: inline-block; background-color: ${primaryColor}; background-image: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); color: #ffffff; padding: 14px 35px; text-decoration: none; border-radius: 25px; margin: 20px 0; font-weight: 500;">${text}</a></div>`;
};

const createFooter = (branding?: IEmailBranding, lang: "fr" | "en" = "fr"): string => {
  const year = new Date().getFullYear();
  const url = process.env.NEXTAUTH_URL || "";
  const companyName = branding?.companyName || "Je chemine";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@jechemine.ca";
  const defaultTagline =
    lang === "fr"
      ? "Votre parcours vers le mieux-être commence ici."
      : DEFAULT_EMAIL_FOOTER_TEXT;
  // PlatformSettings seeds branding.footerText with the English tagline, which
  // leaked into French emails. Treat the seeded English default (and blanks) as
  // "not customised" so each email falls back to its own-language tagline; a
  // genuinely admin-edited value still wins. The sentinel is imported from the
  // model so it can never drift from the value actually seeded into the DB.
  const customTagline = branding?.footerText?.trim();
  const footerText =
    customTagline && customTagline !== DEFAULT_EMAIL_FOOTER_TEXT
      ? customTagline
      : defaultTagline;
  const primaryColor = branding?.primaryColor || "#8B7355";
  const allRights = lang === "fr" ? "Tous droits réservés." : "All rights reserved.";
  const visitSite = lang === "fr" ? "Visiter notre site web" : "Visit our website";
  const contactSupport = lang === "fr" ? "Contacter le soutien" : "Contact support";
  // Link to the Terms of Use in the footer of every platform email (client req).
  const termsLabel =
    lang === "fr" ? "Conditions d'utilisation" : "Terms of Use";

  // Links use class="footer-link" + class="footer-sep": one tidy line on
  // desktop, and on phones the @media rule stacks each link on its own
  // centred line (bigger tap target) and hides the "·" separators so none
  // are left dangling at a line break.
  // The surrounding &nbsp; preserve visible gaps between the links in clients
  // that strip the embedded <style> (e.g. Gmail web for non-Google accounts);
  // on phones the .footer-sep display:none rule hides the dot and the spaces
  // collapse harmlessly since each link becomes its own block.
  const sep = `&nbsp;<span class="footer-sep">&middot;</span>&nbsp;`;
  return `
    <div class="footer">
      <p style="margin: 0 0 6px;">${footerText}</p>
      <p style="margin: 0 0 12px;">&copy; ${year} ${companyName}. ${allRights}</p>
      <p style="margin: 0;"><a href="${url}" class="footer-link" style="color: ${primaryColor};">${visitSite}</a>${sep}<a href="mailto:${supportEmail}" class="footer-link" style="color: ${primaryColor};">${contactSupport}</a>${sep}<a href="${url}/terms" class="footer-link" style="color: ${primaryColor};">${termsLabel}</a></p>
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
  details?: Array<{
    label: string;
    value: string;
    isLink?: boolean;
    stacked?: boolean;
  }>;
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
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="x-apple-disable-message-reformatting">
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
        <meta name="color-scheme" content="light">
        <meta name="supported-color-schemes" content="light">
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
  const url = process.env.NEXTAUTH_URL || "";
  // Terms-of-Use link in the footer of every platform email (client req).
  const termsLine =
    lang === "fr"
      ? `Conditions d'utilisation : ${url}/terms`
      : `Terms of Use: ${url}/terms`;
  const copyright =
    lang === "fr"
      ? `© ${new Date().getFullYear()} Je chemine. Tous droits réservés.\nSoutien : ${supportEmail}\n${termsLine}`
      : `© ${new Date().getFullYear()} Je chemine. All rights reserved.\nSupport: ${supportEmail}\n${termsLine}`;
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
      // Default replies back to the shared support inbox.
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

  const editable = await loadEditableTemplate("accountVerification", lang, {
    name: data.name,
    singleFactor: isSingleFactor ? "true" : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.verifyUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${data.verifyUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.email, subject: editable.subject, html, text },
      "email_verification",
    );
  }

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
  const companyName = branding?.companyName || "Je chemine";
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

  const subject = await getSubject("welcome", "Bienvenue sur Je chemine !");

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
  data: PasswordResetEmailData & { locale?: "fr" | "en" },
): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("passwordReset", lang, {
    name: data.name,
    resetLink: data.resetLink,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.resetLink }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${data.resetLink}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.email, subject: editable.subject, html, text },
      "password_reset",
    );
  }

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Réinitialisation du mot de passe"
        : "Password reset",
    theme: "info",
    greeting:
      lang === "fr" ? `Bonjour ${data.name},` : `Hello ${data.name},`,
    intro:
      lang === "fr"
        ? "Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe."
        : "We received a request to reset your password. Click the button below to create a new password.",
    button: {
      text:
        lang === "fr"
          ? "Réinitialiser mon mot de passe"
          : "Reset my password",
      url: data.resetLink,
    },
    infoBox: {
      title:
        lang === "fr"
          ? "Vous n'avez pas fait cette demande ?"
          : "Didn't request this?",
      content:
        lang === "fr"
          ? "Si vous n'avez pas demandé de réinitialisation, ignorez simplement ce message. Votre mot de passe reste inchangé."
          : "If you didn't request a reset, simply ignore this message. Your password remains unchanged.",
      theme: "warning",
    },
    outro:
      lang === "fr"
        ? "Ce lien expirera dans 1 heure pour des raisons de sécurité."
        : "This link will expire in 1 hour for security reasons.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Demande de réinitialisation du mot de passe",
          `Bonjour ${data.name},`,
          "Nous avons reçu une demande de réinitialisation de votre mot de passe.",
          `Réinitialisez votre mot de passe : ${data.resetLink}`,
          "Ce lien expirera dans 1 heure.",
          "Si vous n'avez pas fait cette demande, ignorez ce message.",
        ]
      : [
          "Password reset request",
          `Hello ${data.name},`,
          "We received a request to reset your password.",
          `Reset your password: ${data.resetLink}`,
          "This link will expire in 1 hour.",
          "If you didn't make this request, ignore this message.",
        ],
    lang,
  );

  const subject = await getSubject(
    "password_reset",
    lang === "fr"
      ? "Réinitialisation de votre mot de passe — Je chemine"
      : "Your password reset — Je chemine",
  );

  return sendEmail({ to: data.email, subject, html, text }, "password_reset");
}

/**
 * Sent when an admin manually creates an account and wants the user to set
 * their own password. Distinct from sendPasswordResetEmail because the user
 * didn't initiate this — copy must reassure them why they got it.
 */
export async function sendPasswordSetupLinkEmail(data: {
  name: string;
  email: string;
  setupLink: string;
  locale?: "fr" | "en";
  /** "setup" = admin created the account; "reset" = user requested a reset. */
  variant?: "setup" | "reset";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const isReset = data.variant === "reset";

  const title = isReset
    ? lang === "fr"
      ? "Réinitialisez votre mot de passe"
      : "Reset your password"
    : lang === "fr"
      ? "Définissez votre mot de passe"
      : "Set your password";

  const intro = isReset
    ? lang === "fr"
      ? "Vous avez demandé la réinitialisation de votre mot de passe Je chemine. Cliquez sur le bouton ci-dessous pour en choisir un nouveau."
      : "You requested a password reset for your Je chemine account. Click the button below to choose a new one."
    : lang === "fr"
      ? "Un administrateur de Je chemine a créé un compte pour vous. Cliquez sur le bouton ci-dessous pour définir votre propre mot de passe et accéder à votre espace en toute sécurité."
      : "A Je chemine administrator created an account for you. Click the button below to set your own password and securely access your dashboard.";

  const buttonText = isReset
    ? lang === "fr"
      ? "Réinitialiser mon mot de passe"
      : "Reset my password"
    : lang === "fr"
      ? "Définir mon mot de passe"
      : "Set my password";

  const infoBox =
    lang === "fr"
      ? {
          title: "Et ensuite ?",
          content:
            "Une fois votre mot de passe défini, vous pourrez vous connecter à Je chemine avec votre adresse courriel et le mot de passe que vous venez de choisir.",
          theme: "info" as const,
        }
      : {
          title: "What's next?",
          content:
            "Once your password is set, you can sign in to Je chemine with your email and the new password.",
          theme: "info" as const,
        };

  const outro =
    lang === "fr"
      ? "Ce lien expirera dans 1 heure pour des raisons de sécurité. Si vous n'attendiez pas ce courriel, ignorez-le."
      : "This link will expire in 1 hour for security reasons. If you weren't expecting this email, you can safely ignore it.";

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("passwordSetup", lang, {
    name: data.name,
    isReset: isReset ? "true" : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.setupLink }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${data.setupLink}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.email, subject: editable.subject, html, text },
      "password_reset",
    );
  }

  const html = buildEmailHtml({
    title,
    theme: "info",
    greeting: lang === "fr" ? `Bonjour ${data.name},` : `Hello ${data.name},`,
    intro,
    button: { text: buttonText, url: data.setupLink },
    buttonAboveInfo: true,
    infoBox,
    outro,
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          title,
          `Bonjour ${data.name},`,
          isReset
            ? "Vous avez demandé la réinitialisation de votre mot de passe Je chemine. Choisissez un nouveau mot de passe à l'aide du lien ci-dessous (valide 1 heure) :"
            : "Un administrateur de Je chemine a créé un compte pour vous. Définissez votre propre mot de passe à l'aide du lien ci-dessous (valide 1 heure) :",
          data.setupLink,
          "Une fois votre mot de passe défini, connectez-vous avec votre adresse courriel et ce nouveau mot de passe.",
          "Si vous n'attendiez pas ce courriel, ignorez-le.",
        ]
      : [
          title,
          `Hello ${data.name},`,
          isReset
            ? "You requested a password reset for your Je chemine account. Choose a new password using the link below (valid for 1 hour):"
            : "A Je chemine administrator created an account for you. Set your own password using the link below (valid for 1 hour):",
          data.setupLink,
          "Once your password is set, sign in with your email and your new password.",
          "If you weren't expecting this email, you can safely ignore it.",
        ],
    lang,
  );

  const fallbackSubject = isReset
    ? lang === "fr"
      ? "Réinitialisation de votre mot de passe — Je chemine"
      : "Reset your password — Je chemine"
    : lang === "fr"
      ? "Définissez votre mot de passe — Je chemine"
      : "Set your password — Je chemine";
  const subject = await getSubject("password_reset", fallbackSubject);

  return sendEmail(
    { to: data.email, subject, html, text },
    "password_reset",
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
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const baseUrl = process.env.NEXTAUTH_URL || "";
  const memberSignupUrl = `${baseUrl}/signup/member?email=${encodeURIComponent(
    data.toEmail,
  )}`;

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("serviceRequestOnboarding", lang, {
    toName: data.toName,
    companyName: branding?.companyName || "Je chemine",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: memberSignupUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${memberSignupUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.toEmail, subject: editable.subject, html, text },
      "service_request_onboarding",
    );
  }

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Votre demande est bien reçue !"
        : "We've received your request!",
    subtitle:
      lang === "fr"
        ? "Nous recherchons le bon professionnel pour vous"
        : "We're finding the right professional for you",
    theme: "info",
    badge: {
      text: lang === "fr" ? "✅ Demande reçue" : "✅ Request received",
      theme: "success",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.toName},` : `Hello ${data.toName},`,
    intro:
      lang === "fr"
        ? "Nous avons bien reçu votre demande de rendez-vous — merci de nous avoir choisis pour vous accompagner. Notre équipe recherche dès maintenant le professionnel qui correspond le mieux à votre situation. Vous recevrez un courriel dès qu'un professionnel aura accepté votre demande."
        : "We've received your appointment request — thank you for choosing us to support you. Our team is now looking for the professional who best fits your situation. You'll receive an email as soon as a professional has accepted your request.",
    infoBox: {
      title:
        lang === "fr"
          ? "🔍 Votre demande est entre de bonnes mains"
          : "🔍 Your request is in good hands",
      content:
        lang === "fr"
          ? "Nous vous jumelons dès maintenant avec un professionnel adapté à vos besoins. Dès qu'un professionnel aura accepté votre demande, nous vous écrirons pour la prochaine étape : confirmer et garantir votre rendez-vous.<br><br><strong>Aidez-nous à vous jumeler plus vite</strong><br>En complétant votre profil de membre, vous nous donnez les détails nécessaires pour vous mettre en relation avec le bon professionnel. Cela ne prend que quelques minutes."
          : "We're now matching you with a professional suited to your needs. As soon as a professional accepts your request, we'll email you the next step: confirming and securing your appointment.<br><br><strong>Help us match you faster</strong><br>Completing your member profile gives us the details we need to connect you with the right professional. It only takes a few minutes.",
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
        ? "<strong>Pourquoi prendre ces quelques minutes ?</strong> Mieux nous vous connaissons, mieux nous pouvons vous jumeler avec un professionnel possédant l'expertise précise dont vous avez besoin.<br><br>Nous vous recontacterons dès qu'un professionnel aura accepté votre demande.<br><br>Merci de faire équipe avec nous pour votre bien-être.<br><br>Chaleureusement,<br>L'équipe de Je chemine"
        : "<strong>Why take a few minutes?</strong> The more we know about you, the better we can match you with a professional who has the exact expertise you need.<br><br>We'll be in touch as soon as a professional accepts your request.<br><br>Thank you for teaming up with us for your well-being.<br><br>Warmly,<br>The Je chemine team",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Votre demande est bien reçue !",
          `Bonjour ${data.toName},`,
          "Nous avons bien reçu votre demande de rendez-vous — merci de nous avoir choisis pour vous accompagner. Notre équipe recherche dès maintenant le professionnel qui correspond le mieux à votre situation. Vous recevrez un courriel dès qu'un professionnel aura accepté votre demande.",
          "🔍 Votre demande est entre de bonnes mains",
          "Nous vous jumelons dès maintenant avec un professionnel adapté à vos besoins. Dès qu'un professionnel aura accepté votre demande, nous vous écrirons pour la prochaine étape : confirmer et garantir votre rendez-vous.",
          "Aidez-nous à vous jumeler plus vite",
          "En complétant votre profil de membre, vous nous donnez les détails nécessaires pour vous mettre en relation avec le bon professionnel. Cela ne prend que quelques minutes :",
          memberSignupUrl,
          "Pourquoi prendre ces quelques minutes ? Mieux nous vous connaissons, mieux nous pouvons vous jumeler avec un professionnel possédant l'expertise précise dont vous avez besoin.",
          "Nous vous recontacterons dès qu'un professionnel aura accepté votre demande.",
          "Merci de faire équipe avec nous pour votre bien-être.",
          "Chaleureusement,",
          "L'équipe de Je chemine",
        ]
      : [
          "We've received your request!",
          `Hello ${data.toName},`,
          "We've received your appointment request — thank you for choosing us to support you. Our team is now looking for the professional who best fits your situation. You'll receive an email as soon as a professional has accepted your request.",
          "🔍 Your request is in good hands",
          "We're now matching you with a professional suited to your needs. As soon as a professional accepts your request, we'll email you the next step: confirming and securing your appointment.",
          "Help us match you faster",
          "Completing your member profile gives us the details we need to connect you with the right professional. It only takes a few minutes:",
          memberSignupUrl,
          "Why take a few minutes? The more we know about you, the better we can match you with a professional who has the exact expertise you need.",
          "We'll be in touch as soon as a professional accepts your request.",
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

/**
 * Referral confirmation — sent to the PATIENT when a professional books on their
 * behalf (bookingFor="patient"). Picks one of two admin-editable templates based
 * on whether the patient already has a REAL (loginable) Je chemine account:
 *   - existing member → "referralExistingMember" (CTA → their space / log in)
 *   - new patient     → "referralNewPatient"      (CTA → member sign-up)
 * The referrer's name is woven in when available (optional {{referrerName}}).
 */
export async function sendReferralConfirmationEmail(data: {
  toName: string;
  toEmail: string;
  referrerName?: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const baseUrl = process.env.NEXTAUTH_URL || "";
  const companyName = branding?.companyName || "Je chemine";

  // Has the referred patient already signed up (real account, not a passwordless
  // lead-capture shell)? Drives which variant + CTA we send.
  let hasAccount = false;
  try {
    hasAccount = Boolean(await findRealAccountByEmail(data.toEmail));
  } catch (err) {
    // On lookup failure, default to the sign-up variant (safe: an existing
    // member can still sign in from the sign-up page).
    console.warn("Referral account lookup failed:", err);
  }

  const templateKey: EmailTemplateKey = hasAccount
    ? "referralExistingMember"
    : "referralNewPatient";
  const ctaUrl = hasAccount
    ? `${baseUrl}/client/dashboard`
    : `${baseUrl}/signup/member?email=${encodeURIComponent(data.toEmail)}`;
  const referrerSuffix = data.referrerName?.trim()
    ? ` (${data.referrerName.trim()})`
    : "";

  const editable = await loadEditableTemplate(templateKey, lang, {
    toName: data.toName,
    referrerName: data.referrerName?.trim() || "",
    companyName,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: ctaUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${ctaUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.toEmail, subject: editable.subject, html, text },
      "service_request_onboarding",
    );
  }

  // Hardcoded fallback (used only if the editable template fails to load).
  const html = buildEmailHtml({
    title: hasAccount
      ? lang === "fr"
        ? "Une demande a été faite en votre nom"
        : "A request was made on your behalf"
      : lang === "fr"
        ? "Vous avez été référé à Je chemine"
        : "You've been referred to Je chemine",
    subtitle: hasAccount
      ? lang === "fr"
        ? "Connectez-vous à votre espace pour la suivre"
        : "Log in to your space to follow it"
      : lang === "fr"
        ? "Créez votre compte pour suivre votre demande"
        : "Create your account to follow your request",
    theme: "info",
    greeting: lang === "fr" ? `Bonjour ${data.toName},` : `Hello ${data.toName},`,
    intro:
      lang === "fr"
        ? `Un professionnel${referrerSuffix} a soumis une demande de rendez-vous en votre nom sur ${companyName}. Notre équipe recherche dès maintenant le professionnel qui correspond le mieux à votre situation.`
        : `A professional${referrerSuffix} submitted an appointment request on your behalf on ${companyName}. Our team is now looking for the professional who best fits your situation.`,
    infoBox: {
      title: hasAccount
        ? lang === "fr"
          ? "Suivez votre demande"
          : "Follow your request"
        : lang === "fr"
          ? "Prochaine étape"
          : "Next step",
      content: hasAccount
        ? lang === "fr"
          ? "Comme vous possédez déjà un compte, connectez-vous à votre espace pour suivre l'avancement de votre demande et confirmer les prochaines étapes dès qu'un professionnel l'aura acceptée."
          : "Since you already have an account, log in to your space to follow your request and confirm the next steps as soon as a professional has accepted it."
        : lang === "fr"
          ? "Pour suivre votre demande et recevoir les prochaines étapes, créez votre compte de membre — cela ne prend que quelques minutes."
          : "To follow your request and receive the next steps, create your member account — it only takes a few minutes.",
    },
    button: {
      text: hasAccount
        ? lang === "fr"
          ? "Accéder à mon espace"
          : "Go to my space"
        : lang === "fr"
          ? "Créer mon compte"
          : "Create my account",
      url: ctaUrl,
    },
    outro:
      lang === "fr"
        ? "Chaleureusement,<br>L'équipe de Je chemine"
        : "Warmly,<br>The Je chemine team",
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      hasAccount
        ? lang === "fr"
          ? "Une demande a été faite en votre nom"
          : "A request was made on your behalf"
        : lang === "fr"
          ? "Vous avez été référé à Je chemine"
          : "You've been referred to Je chemine",
      lang === "fr" ? `Bonjour ${data.toName},` : `Hello ${data.toName},`,
      lang === "fr"
        ? `Un professionnel${referrerSuffix} a soumis une demande de rendez-vous en votre nom sur ${companyName}.`
        : `A professional${referrerSuffix} submitted an appointment request on your behalf on ${companyName}.`,
      ctaUrl,
      lang === "fr" ? "Chaleureusement," : "Warmly,",
      lang === "fr" ? "L'équipe de Je chemine" : "The Je chemine team",
    ],
    lang,
  );
  const subject = await getSubject(
    "service_request_onboarding",
    lang === "fr"
      ? "Une demande de rendez-vous a été faite en votre nom — Je chemine"
      : "An appointment request was made on your behalf — Je chemine",
  );
  return sendEmail(
    { to: data.toEmail, subject, html, text },
    "service_request_onboarding",
  );
}

export async function sendGuestPaymentConfirmation(
  data: GuestBookingEmailData & {
    /** Claim/complete-account link. When set, the RDV confirmation also nudges
     * the guest to finalize their account (parallel to the jumelage email). */
    completeAccountUrl?: string;
  },
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const formattedDate = formatEmailDate(data.date, lang);
  const formattedTime = formatTime(data.time, lang);
  const professionalName = formatProfessionalName(data.professionalName, lang);
  const sessionType = formatSessionType(data.therapyType, lang);
  const appointmentType = formatAppointmentType(data.type, lang);

  // Account-completion nudge (same intent as the jumelage email): encourage the
  // guest to finalize their account to manage appointments + payments online.
  // Hardcoded secondary button so it shows regardless of the editable template.
  const accountNudge = data.completeAccountUrl
    ? {
        preamble:
          lang === "fr"
            ? "Pour suivre votre demande et gérer vos rendez-vous et paiements en ligne, complétez votre compte. Ignorez ce message si c'est déjà fait."
            : "To track your request and manage your appointments and payments online, complete your account. Ignore this message if it's already done.",
        text:
          lang === "fr" ? "Compléter mon compte" : "Complete my account",
        url: data.completeAccountUrl,
      }
    : undefined;

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

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("guestPaymentConfirmation", lang, {
    guestName: data.guestName,
    sessionType,
    appointmentType,
    professionalName,
    appointmentDate: formattedDate,
    appointmentTime: formattedTime,
    appointmentDuration: `${data.duration} minutes`,
    price: data.price.toFixed(2),
    currency,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button:
        data.paymentLink && editable.ctaText
          ? { text: editable.ctaText, url: data.paymentLink }
          : undefined,
      secondaryButton: accountNudge,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        data.paymentLink && editable.ctaText
          ? `${editable.ctaText} : ${data.paymentLink}`
          : "",
        accountNudge
          ? `${accountNudge.preamble}\n${accountNudge.text} : ${accountNudge.url}`
          : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.guestEmail, subject: editable.subject, html, text },
      "guest_payment_confirmation",
    );
  }

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
    secondaryButton: accountNudge,
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
          accountNudge
            ? `${accountNudge.preamble}\n${accountNudge.text} : ${accountNudge.url}`
            : "",
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
          accountNudge
            ? `${accountNudge.preamble}\n${accountNudge.text} : ${accountNudge.url}`
            : "",
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
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const formattedDate = formatEmailDate(data.date, lang);
  const formattedTime = formatTime(data.time, lang);
  const professionalName = formatProfessionalName(data.professionalName, lang);
  const sessionType = formatSessionType(data.therapyType, lang);
  const appointmentType = formatAppointmentType(data.type, lang);

  const details: Array<{ label: string; value: string; isLink?: boolean }> =
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

  if (data.meetingLink) {
    details.push({
      label: lang === "fr" ? "Lien de réunion" : "Meeting link",
      value: data.meetingLink,
      isLink: true,
    });
  }

  const editable = await loadEditableTemplate("guestPaymentComplete", lang, {
    guestName: data.guestName,
    sessionType,
    appointmentType,
    professionalName,
    appointmentDate: formattedDate,
    appointmentTime: formattedTime,
    appointmentDuration: `${data.duration} minutes`,
    price: data.price.toFixed(2),
    currency,
    meetingLink: data.meetingLink || "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "success",
      greeting: "",
      intro: editable.bodyHtml,
      button:
        data.meetingLink && editable.ctaText
          ? { text: editable.ctaText, url: data.meetingLink }
          : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        data.meetingLink && editable.ctaText
          ? `${editable.ctaText} : ${data.meetingLink}`
          : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.guestEmail, subject: editable.subject, html, text },
      "guest_payment_complete",
    );
  }

  const html = buildEmailHtml({
    title: lang === "fr" ? "Paiement confirmé" : "Payment confirmed",
    subtitle:
      lang === "fr"
        ? "Vous êtes prêt pour votre séance"
        : "You're ready for your session",
    theme: "success",
    badge: {
      text: lang === "fr" ? "💳 Paiement complété" : "💳 Payment completed",
      theme: "success",
    },
    greeting:
      lang === "fr"
        ? `Bonjour ${data.guestName},`
        : `Hello ${data.guestName},`,
    intro:
      lang === "fr"
        ? "Merci ! Votre paiement a été traité avec succès. Votre rendez-vous est maintenant pleinement confirmé."
        : "Thank you! Your payment has been processed successfully. Your appointment is now fully confirmed.",
    details,
    detailsBorderColor: "#22c55e",
    price: {
      amount: data.price,
      note:
        lang === "fr" ? "Paiement reçu — Merci !" : "Payment received — Thank you!",
      theme: "success",
      currency,
    },
    button: data.meetingLink
      ? {
          text:
            lang === "fr" ? "Rejoindre la séance" : "Join the session",
          url: data.meetingLink,
        }
      : undefined,
    infoBox: {
      title: lang === "fr" ? "Avant votre séance" : "Before your session",
      content: data.meetingLink
        ? lang === "fr"
          ? "Votre lien de réunion est prêt. Assurez-vous de vous connecter quelques minutes avant et d'avoir une connexion internet stable."
          : "Your meeting link is ready. Make sure to connect a few minutes early and have a stable internet connection."
        : lang === "fr"
          ? "Votre lien de réunion vous sera envoyé avant l'heure prévue de votre séance."
          : "Your meeting link will be sent before your scheduled session time.",
    },
    outro:
      lang === "fr"
        ? "Nous avons hâte de vous accompagner dans votre parcours de mieux-être. Si vous devez reporter, contactez-nous au moins 48 heures à l'avance."
        : "We look forward to supporting you on your wellness journey. If you need to reschedule, contact us at least 48 hours in advance.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
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
        ]
      : [
          "Payment confirmed — You're ready!",
          `Hello ${data.guestName},`,
          "Your payment has been processed successfully.",
          "APPOINTMENT DETAILS:",
          `Session type: ${sessionType}`,
          `Professional: ${professionalName}`,
          `Date: ${formattedDate}`,
          `Time: ${formattedTime}`,
          `Duration: ${data.duration} minutes`,
          `Amount paid: ${currency} $${data.price.toFixed(2)}`,
          data.meetingLink ? `Meeting link: ${data.meetingLink}` : "",
        ],
    lang,
  );

  const subject = await getSubject(
    "guest_payment_complete",
    lang === "fr"
      ? "Paiement confirmé — Je chemine"
      : "Payment confirmed — Je chemine",
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
  data: AppointmentEmailData & { locale?: "fr" | "en" },
): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const formattedDate = formatEmailDate(data.date, lang);
  const formattedTime = formatTime(data.time, lang);
  const professionalName = formatProfessionalName(data.professionalName, lang);
  const appointmentType = formatAppointmentType(data.type, lang);

  const details: Array<{ label: string; value: string; isLink?: boolean }> =
    lang === "fr"
      ? [
          { label: "Professionnel", value: professionalName },
          { label: "Date", value: formattedDate },
          { label: "Heure", value: formattedTime },
          { label: "Durée", value: `${data.duration} minutes` },
        ]
      : [
          { label: "Professional", value: professionalName },
          { label: "Date", value: formattedDate },
          { label: "Time", value: formattedTime },
          { label: "Duration", value: `${data.duration} minutes` },
        ];

  if (data.meetingLink) {
    details.push({
      label: lang === "fr" ? "Lien de réunion" : "Meeting link",
      value: data.meetingLink,
      isLink: true,
    });
  } else if (data.location) {
    details.push({
      label: lang === "fr" ? "Lieu" : "Location",
      value: data.location,
    });
  }

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("appointmentConfirmation", lang, {
    clientName: data.clientName,
    professionalName,
    appointmentType: appointmentType.toLowerCase(),
    appointmentDate: formattedDate,
    appointmentTime: formattedTime,
    appointmentDuration: `${data.duration} minutes`,
    meetingUrl: data.meetingLink || "",
    location: data.location || "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "success",
      greeting: "",
      intro: editable.bodyHtml,
      button:
        data.meetingLink && editable.ctaText
          ? { text: editable.ctaText, url: data.meetingLink }
          : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        data.meetingLink && editable.ctaText
          ? `${editable.ctaText} : ${data.meetingLink}`
          : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "appointment_confirmation",
    );
  }

  const html = buildEmailHtml({
    title:
      lang === "fr" ? "Rendez-vous confirmé" : "Appointment confirmed",
    theme: "success",
    greeting:
      lang === "fr"
        ? `Bonjour ${data.clientName},`
        : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? `Votre rendez-vous (${appointmentType.toLowerCase()}) est confirmé.`
        : `Your ${appointmentType.toLowerCase()} appointment is confirmed.`,
    details,
    button: data.meetingLink
      ? {
          text:
            lang === "fr" ? "Rejoindre la séance" : "Join the session",
          url: data.meetingLink,
        }
      : undefined,
    outro:
      lang === "fr"
        ? "Si vous devez reporter ou annuler, veuillez le faire au moins 48 heures à l'avance."
        : "If you need to reschedule or cancel, please do so at least 48 hours in advance.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
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
        ]
      : [
          "Appointment confirmed",
          `Hello ${data.clientName},`,
          `Your ${appointmentType.toLowerCase()} appointment is confirmed.`,
          "DETAILS:",
          `Professional: ${professionalName}`,
          `Date: ${formattedDate}`,
          `Time: ${formattedTime}`,
          `Duration: ${data.duration} minutes`,
          data.meetingLink ? `Meeting link: ${data.meetingLink}` : "",
          data.location ? `Location: ${data.location}` : "",
        ],
    lang,
  );

  const subject = await getSubject(
    "appointment_confirmation",
    lang === "fr"
      ? "Rendez-vous confirmé — Je chemine"
      : "Appointment confirmed — Je chemine",
  );

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "appointment_confirmation",
  );
}

export async function sendPaymentInvitation(
  data: AppointmentEmailData & {
    price: number;
    paymentUrl?: string;
    locale?: "fr" | "en";
    /**
     * "Complete my profile" deep-link. This 1st-RDV email already drives the
     * payment method (primary button), so the secondary nudge here is the
     * profile-completion half. Only sent by callers for active clients (the
     * dashboard is auth-gated); guests are handled by their own flow.
     */
    completeProfileUrl?: string;
  },
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const formattedDate = formatEmailDate(data.date, lang);
  const formattedTime = formatTime(data.time, lang);
  const professionalName = formatProfessionalName(data.professionalName, lang);
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/client/dashboard/appointments`;

  // Symmetric to the jumelage email: payment is already the primary CTA here,
  // so this secondary button nudges the OTHER half — completing the profile —
  // with the same "skip if already done" reassurance. Not part of the editable
  // template, so no DB reseed; added to both editable and fallback branches.
  const profileNudge = data.completeProfileUrl
    ? {
        preamble:
          lang === "fr"
            ? "Pensez aussi à compléter votre profil pour faciliter votre suivi avec votre professionnel. Si c'est déjà fait, ignorez simplement ce message."
            : "Don't forget to complete your profile to help your professional support you. If it's already done, simply ignore this message.",
        text:
          lang === "fr" ? "Compléter mon profil" : "Complete my profile",
        url: data.completeProfileUrl,
      }
    : undefined;

  const details: Array<{ label: string; value: string; isLink?: boolean }> =
    lang === "fr"
      ? [
          { label: "Professionnel", value: professionalName },
          { label: "Date", value: formattedDate },
          { label: "Heure", value: formattedTime },
          { label: "Durée", value: `${data.duration} minutes` },
        ]
      : [
          { label: "Professional", value: professionalName },
          { label: "Date", value: formattedDate },
          { label: "Time", value: formattedTime },
          { label: "Duration", value: `${data.duration} minutes` },
        ];

  if (data.meetingLink) {
    details.push({
      label: lang === "fr" ? "Lien de réunion" : "Meeting link",
      value: data.meetingLink,
      isLink: true,
    });
  } else if (data.location) {
    details.push({
      label: lang === "fr" ? "Lieu" : "Location",
      value: data.location,
    });
  }

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("paymentInvitation", lang, {
    clientName: data.clientName,
    professionalName,
    appointmentDate: formattedDate,
    appointmentTime: formattedTime,
    appointmentDuration: String(data.duration),
    meetingLinkOrLocation: data.meetingLink || data.location || "",
    price: data.price.toFixed(2),
    currency,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.paymentUrl || dashboardUrl }
        : undefined,
      secondaryButton: profileNudge,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText
          ? `${editable.ctaText} : ${data.paymentUrl || dashboardUrl}`
          : "",
        profileNudge
          ? `${profileNudge.preamble}\n${profileNudge.text} : ${profileNudge.url}`
          : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "payment_invitation",
    );
  }

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
      lang === "fr"
        ? `Bonjour ${data.clientName},`
        : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? "Votre rendez-vous est confirmé. Veuillez ajouter vos coordonnées de paiement (carte, virement Interac via Stripe, ou prélèvement automatique canadien) pour finaliser votre réservation. Aucun montant n'est prélevé avant que votre séance ait eu lieu et que votre professionnel la marque comme complétée. Les données de carte et bancaires sont traitées par Stripe — nous ne les stockons pas sur notre plateforme."
        : "Your appointment is confirmed. Please add your payment details (card, Interac e-Transfer via Stripe, or Canadian pre-authorized debit) to finalize your booking. No amount is charged before your session has taken place and your professional marks it as completed. Card and banking data are processed by Stripe — we do not store them on our platform.",
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
    button: data.paymentUrl
      ? {
          text:
            lang === "fr"
              ? "Ouvrir la facturation et confirmer"
              : "Open billing and confirm",
          url: data.paymentUrl,
        }
      : {
          text: lang === "fr" ? "Voir le rendez-vous" : "View appointment",
          url: dashboardUrl,
        },
    secondaryButton: profileNudge,
    infoBox: {
      title:
        lang === "fr"
          ? "Paiements sécurisés avec Stripe"
          : "Secure payments with Stripe",
      content:
        lang === "fr"
          ? "Vous recevrez votre lien de réunion une fois votre moyen de paiement enregistré. Le montant n'est prélevé qu'après confirmation de la séance par votre professionnel."
          : "You will receive your meeting link once your payment method is saved. The amount is only charged after your professional confirms the session.",
    },
    outro:
      lang === "fr"
        ? "Pour toute question, répondez à ce courriel ou contactez le soutien depuis votre tableau de bord."
        : "For any questions, reply to this email or contact support from your dashboard.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
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
          profileNudge
            ? `${profileNudge.preamble}\n${profileNudge.text} : ${profileNudge.url}`
            : "",
        ]
      : [
          "Confirm your appointment (payment after the session)",
          `Hello ${data.clientName},`,
          "Your appointment is confirmed. Add your payment method via the link below to finalize your booking. You won't be charged until after your session is completed. Stripe handles your banking details; we do not store them.",
          "APPOINTMENT DETAILS:",
          `Professional: ${professionalName}`,
          `Date: ${formattedDate}`,
          `Time: ${formattedTime}`,
          `Duration: ${data.duration} minutes`,
          `Amount due: ${currency} $${data.price.toFixed(2)}`,
          data.paymentUrl
            ? `Confirm payment: ${data.paymentUrl}`
            : `View appointment: ${dashboardUrl}`,
          profileNudge
            ? `${profileNudge.preamble}\n${profileNudge.text} : ${profileNudge.url}`
            : "",
        ],
    lang,
  );

  const subject = await getSubject(
    "payment_invitation",
    lang === "fr"
      ? "Votre rendez-vous est confirmé — prochaine étape"
      : "Your appointment is confirmed — next step",
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
  // Body is 100% French; lock formatters to fr-CA so dates/labels match.
  const formattedDate = formatEmailDate(data.date, "fr");
  const formattedTime = formatTime(data.time, "fr");
  const professionalName = formatProfessionalName(data.professionalName, "fr");
  const appointmentType = formatAppointmentType(data.type, "fr");
  // "/requests" never existed → the email CTA landed on a blank 404. Point it at
  // the real "Propositions" page. The professional layout bounces a logged-out
  // pro to /login?callbackUrl=… (preserving this destination), so the link
  // resolves to the login page and then deep-links to the request after sign-in.
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/professional/dashboard/proposals`;

  // Admin-editable template (subject/title/subtitle/body/CTA); the hardcoded
  // block below is the fallback if the DB row can't be loaded. Body is French.
  const editable = await loadEditableTemplate("professionalNewRequest", "fr", {
    professionalName,
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    appointmentType,
    appointmentDate: formattedDate,
    appointmentTime: formattedTime,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: dashboardUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${dashboardUrl}` : "",
      ],
      "fr",
    );
    return sendEmail(
      { to: data.professionalEmail, subject: editable.subject, html, text },
      "appointment_professional_notification",
    );
  }

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
    "Nouvelle demande de rendez-vous — Je chemine",
  );

  return sendEmail(
    { to: data.professionalEmail, subject, html, text },
    "appointment_professional_notification",
  );
}

/**
 * Relance envoyée au professionnel qui a accepté un client (jumelé) mais n'a
 * pas encore confirmé la date du 1er rendez-vous après quelques jours. Le
 * client attend : on rappelle au pro de planifier depuis l'onglet "À planifier".
 */
export async function sendUnscheduledMatchReminder(data: {
  professionalName: string;
  professionalEmail: string;
  clientName: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/professional/dashboard/proposals`;
  const name =
    data.professionalName?.trim() ||
    (lang === "fr" ? "cher professionnel" : "there");
  const clientName = data.clientName?.trim() || (lang === "fr" ? "un client" : "a client");

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("unscheduledMatchReminder", lang, {
    professionalName: name,
    clientName,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
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
      { to: data.professionalEmail, subject: editable.subject, html, text },
      "appointment_professional_notification",
    );
  }

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Un client attend la date de son 1er rendez-vous"
        : "A client is waiting for their 1st appointment date",
    subtitle:
      lang === "fr"
        ? "Confirmez le premier rendez-vous"
        : "Confirm the first appointment",
    theme: "info",
    badge: {
      text: lang === "fr" ? "⏳ À planifier" : "⏳ To schedule",
      theme: "info",
    },
    greeting: lang === "fr" ? `Bonjour ${name},` : `Hello ${name},`,
    intro:
      lang === "fr"
        ? `Vous avez accepté la demande de ${clientName}, mais la date du premier rendez-vous n'est pas encore fixée. ${clientName} attend de vos nouvelles — confirmez la date depuis l'onglet « À planifier » de votre tableau de bord.`
        : `You accepted ${clientName}'s request, but the first appointment date isn't set yet. ${clientName} is waiting to hear from you — confirm the date from the "To Schedule" tab of your dashboard.`,
    button: {
      text: lang === "fr" ? "Confirmer le 1er RDV" : "Confirm the 1st appointment",
      url: dashboardUrl,
    },
    outro:
      lang === "fr"
        ? "Vous pouvez communiquer avec le client avant de fixer une date officielle."
        : "You may contact the client before setting an official date.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Un client attend la date de son 1er rendez-vous",
          `Bonjour ${name},`,
          `Vous avez accepté la demande de ${clientName}, mais la date du premier rendez-vous n'est pas encore fixée.`,
          `Confirmer le 1er RDV : ${dashboardUrl}`,
          "Vous pouvez communiquer avec le client avant de fixer une date officielle.",
        ]
      : [
          "A client is waiting for their 1st appointment date",
          `Hello ${name},`,
          `You accepted ${clientName}'s request, but the first appointment date isn't set yet.`,
          `Confirm the 1st appointment: ${dashboardUrl}`,
          "You may contact the client before setting an official date.",
        ],
    lang,
  );

  const subject = await getSubject(
    "appointment_professional_notification",
    lang === "fr"
      ? "Rappel — confirmez la date du 1er rendez-vous"
      : "Reminder — confirm the 1st appointment date",
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
  // Body is 100% French; lock formatters to fr-CA so dates/labels match.
  const formattedDate = formatEmailDate(data.date, "fr");
  const formattedTime = formatTime(data.time, "fr");
  const professionalName = formatProfessionalName(data.professionalName, "fr");

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

  // Admin-editable template (subject/title/subtitle/body/CTA); the hardcoded
  // block below is the fallback if the DB row can't be loaded. Body is French.
  const editable = await loadEditableTemplate("appointmentReminderGeneric", "fr", {
    clientName: data.clientName,
    professionalName,
    appointmentDate: formattedDate,
    appointmentTime: formattedTime,
    meetingLink: data.meetingLink || "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button:
        data.meetingLink && editable.ctaText
          ? { text: editable.ctaText, url: data.meetingLink }
          : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        data.meetingLink && editable.ctaText
          ? `${editable.ctaText} : ${data.meetingLink}`
          : "",
      ],
      "fr",
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "appointment_reminder",
    );
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
    "Rappel de rendez-vous — Je chemine",
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

  // Admin-editable template (subject/title/subtitle/body/CTA); the hardcoded
  // block below is the fallback if the DB row can't be loaded.
  const editable = await loadEditableTemplate("reminder72h", lang, {
    clientName: data.clientName,
    professionalName,
    appointmentDate: data.appointmentDateLabel,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.cancelUrl }
        : undefined,
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
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${data.cancelUrl}` : "",
        (lang === "fr"
          ? "Demander un autre rendez-vous : "
          : "Request another appointment: ") + data.rescheduleUrl,
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "appointment_reminder_72h",
    );
  }

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
        ? `Petit rappel : votre rendez-vous avec ${professionalName} est prévu le ${data.appointmentDateLabel}. Vous êtes encore dans la fenêtre d'annulation sans frais (jusqu'à 48 h avant la séance).`
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
 * Email 7b — H-48 reminder. Past the strict 48h cancellation window:
 *  - No "confirm attendance" CTA (removed per client request): this is now a
 *    pure reminder, not an action email.
 *  - Secondary CTA (conditional): "Choisir mon mode de paiement" when the
 *    client still has no payment method on file at H-48.
 *  - No cancel/reschedule button: the policy now strictly blocks self-cancel
 *    at <48h; the only path is direct admin/pro contact.
 */
export async function sendAppointment48hReminder(data: {
  clientName: string;
  clientEmail: string;
  professionalName?: string;
  appointmentId: string;
  appointmentDateLabel: string;
  /** True when the client has no card / direct debit / Interac choice yet. */
  noPaymentMethod?: boolean;
  locale?: "fr" | "en";
  /**
   * "Choose my payment method" CTA target (only used when noPaymentMethod).
   * Caller resolves it — auth-gated dashboard URL for active clients,
   * tokenized `/pay?token=…` for unclaimed.
   */
  billingUrl?: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const professionalName = formatProfessionalName(data.professionalName, lang);
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const billingUrl =
    data.billingUrl ??
    `${base}/client/dashboard/billing?action=addPaymentMethod`;

  // Admin-editable template (subject/title/subtitle/body); the hardcoded block
  // below is the fallback if the DB row can't be loaded.
  const editable = await loadEditableTemplate("reminder48h", lang, {
    clientName: data.clientName,
    professionalName,
    appointmentDate: data.appointmentDateLabel,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: billingUrl }
        : undefined,
      secondaryButton: data.noPaymentMethod
        ? {
            preamble:
              lang === "fr"
                ? "Vous n'avez pas encore choisi votre mode de paiement. C'est obligatoire pour valider la séance."
                : "You haven't chosen your payment method yet. This is required to validate the session.",
            text:
              lang === "fr"
                ? "Choisir mon mode de paiement"
                : "Choose my payment method",
            url: billingUrl,
          }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        data.noPaymentMethod
          ? (lang === "fr"
              ? "Choisir mon mode de paiement : "
              : "Choose my payment method: ") + billingUrl
          : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "appointment_reminder_48h",
    );
  }

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Votre rendez-vous est dans 48 heures"
        : "Your appointment is in 48 hours",
    subtitle:
      lang === "fr"
        ? "Rappel de votre rendez-vous"
        : "Appointment reminder",
    theme: "warning",
    badge: {
      text: lang === "fr" ? "⏰ Rappel — 48 h" : "⏰ Reminder — 48h",
      theme: "warning",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? `Votre rendez-vous avec ${professionalName} aura lieu dans 48 heures (${data.appointmentDateLabel}).`
        : `Your appointment with ${professionalName} will take place in 48 hours (${data.appointmentDateLabel}).`,
    secondaryButton: data.noPaymentMethod
      ? {
          preamble:
            lang === "fr"
              ? "Vous n'avez pas encore choisi votre mode de paiement. C'est obligatoire pour valider la séance."
              : "You haven't chosen your payment method yet. This is required to validate the session.",
          text:
            lang === "fr"
              ? "Choisir mon mode de paiement"
              : "Choose my payment method",
          url: billingUrl,
        }
      : undefined,
    infoBox: {
      title:
        lang === "fr"
          ? "Politique d'annulation"
          : "Cancellation policy",
      content:
        lang === "fr"
          ? "Le délai d'annulation sans frais est dépassé. Toute annulation à moins de 48 h doit passer par notre équipe ou votre professionnel — l'option d'annulation en libre-service n'est plus disponible."
          : "The free-cancellation window has closed. Any cancellation within 48h must go through our team or your professional — the self-service cancellation option is no longer available.",
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
          data.noPaymentMethod
            ? `Choisir mon mode de paiement : ${billingUrl}`
            : "",
          "Annulation libre-service indisponible à moins de 48 h. Contactez notre équipe ou votre professionnel pour toute modification.",
        ]
      : [
          "Reminder — your appointment is in 48 hours",
          `Hello ${data.clientName},`,
          `Appointment with ${professionalName} on ${data.appointmentDateLabel}.`,
          data.noPaymentMethod
            ? `Choose my payment method: ${billingUrl}`
            : "",
          "Self-service cancellation is unavailable within 48h. Contact our team or your professional for any change.",
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
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const formattedDate = formatEmailDate(data.date, lang);
  const formattedTime = formatTime(data.time, lang);
  const professionalName = formatProfessionalName(data.professionalName, lang);
  const appointmentType = formatAppointmentType(data.type, lang);

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("meetingLinkReady", lang, {
    guestName: data.guestName,
    professionalName,
    appointmentType,
    appointmentDate: formattedDate,
    appointmentTime: formattedTime,
    duration: String(data.duration),
    meetingUrl: data.meetingLink,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "success",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.meetingLink }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${data.meetingLink}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.guestEmail, subject: editable.subject, html, text },
      "meeting_link",
    );
  }

  const html = buildEmailHtml({
    title: lang === "fr" ? "Lien de réunion prêt" : "Meeting link ready",
    subtitle:
      lang === "fr" ? "Détails de votre séance" : "Your session details",
    theme: "success",
    badge: {
      text: lang === "fr" ? "🔗 Lien prêt" : "🔗 Link ready",
      theme: "success",
    },
    greeting:
      lang === "fr"
        ? `Bonjour ${data.guestName},`
        : `Hello ${data.guestName},`,
    intro:
      lang === "fr"
        ? "Votre lien de réunion est maintenant disponible. Vous pouvez rejoindre la séance via le lien ci-dessous."
        : "Your meeting link is now available. You can join the session via the link below.",
    details:
      lang === "fr"
        ? [
            { label: "Professionnel", value: professionalName },
            { label: "Type", value: appointmentType },
            { label: "Date", value: formattedDate },
            { label: "Heure", value: formattedTime },
            { label: "Durée", value: `${data.duration} minutes` },
            { label: "Lien de réunion", value: data.meetingLink, isLink: true },
          ]
        : [
            { label: "Professional", value: professionalName },
            { label: "Type", value: appointmentType },
            { label: "Date", value: formattedDate },
            { label: "Time", value: formattedTime },
            { label: "Duration", value: `${data.duration} minutes` },
            { label: "Meeting link", value: data.meetingLink, isLink: true },
          ],
    detailsBorderColor: "#22c55e",
    button: {
      text: lang === "fr" ? "Rejoindre la séance" : "Join the session",
      url: data.meetingLink,
    },
    outro:
      lang === "fr"
        ? "Veuillez vous connecter quelques minutes avant et vous assurer d'avoir une connexion internet stable."
        : "Please connect a few minutes early and make sure you have a stable internet connection.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Votre lien de réunion est prêt",
          `Bonjour ${data.guestName},`,
          "Détails de votre séance :",
          `Professionnel : ${professionalName}`,
          `Type : ${appointmentType}`,
          `Date : ${formattedDate}`,
          `Heure : ${formattedTime}`,
          `Durée : ${data.duration} minutes`,
          `Lien de réunion : ${data.meetingLink}`,
        ]
      : [
          "Your meeting link is ready",
          `Hello ${data.guestName},`,
          "Your session details:",
          `Professional: ${professionalName}`,
          `Type: ${appointmentType}`,
          `Date: ${formattedDate}`,
          `Time: ${formattedTime}`,
          `Duration: ${data.duration} minutes`,
          `Meeting link: ${data.meetingLink}`,
        ],
    lang,
  );

  const subject = await getSubject(
    "meeting_link",
    lang === "fr"
      ? "Votre lien de réunion est prêt — Je chemine"
      : "Your meeting link is ready — Je chemine",
  );

  return sendEmail(
    { to: data.guestEmail, subject, html, text },
    "meeting_link",
  );
}

export async function sendCancellationNotification(
  data: AppointmentEmailData & {
    cancelledBy: "client" | "professional";
    locale?: "fr" | "en";
  },
): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const formattedDate = formatEmailDate(data.date, lang);
  const formattedTime = formatTime(data.time, lang);
  const isClientCancellation = data.cancelledBy === "client";
  const recipientEmail = isClientCancellation
    ? data.professionalEmail
    : data.clientEmail;
  const recipientName = isClientCancellation
    ? formatProfessionalName(data.professionalName, lang)
    : data.clientName;
  const cancellerName = isClientCancellation
    ? data.clientName
    : formatProfessionalName(data.professionalName, lang);

  const hasSchedule = data.date && data.time;
  const intro = hasSchedule
    ? lang === "fr"
      ? `Le rendez-vous prévu le ${formattedDate} à ${formattedTime} a été annulé par ${cancellerName}.`
      : `The appointment scheduled on ${formattedDate} at ${formattedTime} has been cancelled by ${cancellerName}.`
    : lang === "fr"
      ? `Une demande de rendez-vous a été annulée par ${cancellerName}.`
      : `An appointment request has been cancelled by ${cancellerName}.`;

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("cancellationNotice", lang, {
    recipientName,
    cancellerName,
    appointmentDate: hasSchedule ? formattedDate : "",
    appointmentTime: hasSchedule ? formattedTime : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "danger",
      greeting: "",
      intro: editable.bodyHtml,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      ],
      lang,
    );
    return sendEmail(
      { to: recipientEmail, subject: editable.subject, html, text },
      "appointment_cancellation",
    );
  }

  const html = buildEmailHtml({
    title: lang === "fr" ? "Rendez-vous annulé" : "Appointment cancelled",
    theme: "danger",
    greeting:
      lang === "fr" ? `Bonjour ${recipientName},` : `Hello ${recipientName},`,
    intro,
    details: hasSchedule
      ? lang === "fr"
        ? [
            { label: "Date initiale", value: formattedDate },
            { label: "Heure initiale", value: formattedTime },
            { label: "Annulé par", value: cancellerName },
          ]
        : [
            { label: "Original date", value: formattedDate },
            { label: "Original time", value: formattedTime },
            { label: "Cancelled by", value: cancellerName },
          ]
      : undefined,
    detailsBorderColor: "#ef4444",
    outro:
      lang === "fr"
        ? "Si vous avez des questions ou souhaitez reporter, veuillez nous contacter."
        : "If you have any questions or would like to reschedule, please contact us.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Rendez-vous annulé",
          `Bonjour ${recipientName},`,
          intro,
          hasSchedule ? `Date initiale : ${formattedDate}` : "",
          hasSchedule ? `Heure initiale : ${formattedTime}` : "",
        ]
      : [
          "Appointment cancelled",
          `Hello ${recipientName},`,
          intro,
          hasSchedule ? `Original date: ${formattedDate}` : "",
          hasSchedule ? `Original time: ${formattedTime}` : "",
        ],
    lang,
  );

  const subject = await getSubject(
    "appointment_cancellation",
    lang === "fr"
      ? `Rendez-vous annulé${isClientCancellation ? " par le client" : ""} — Je chemine`
      : `Appointment cancelled${isClientCancellation ? " by client" : ""} — Je chemine`,
  );

  return sendEmail(
    { to: recipientEmail, subject, html, text },
    "appointment_cancellation",
  );
}

/**
 * Appointment change notice for substitution edits. When an admin or a
 * professional reschedules / cancels an appointment, the affected parties are
 * emailed (each in their own locale).
 *   - actor "admin"        → both the client AND the professional are notified;
 *                            attribution reads "by the Je chemine team".
 *   - actor "professional" → only the client is notified (the pro performed the
 *                            change themselves, so they already know).
 * Reuses the existing confirmation/cancellation email types for global
 * enable-gating + branding. Returns per-recipient success flags.
 */
export async function sendAppointmentChangeNotification(data: {
  action: "rescheduled" | "cancelled";
  actor: "admin" | "professional";
  clientName: string;
  clientEmail: string;
  clientLocale?: "fr" | "en";
  professionalName: string;
  professionalEmail?: string;
  professionalLocale?: "fr" | "en";
  date?: string;
  time?: string;
  type?: "video" | "in-person" | "phone" | "both";
  location?: string;
  previousDate?: string;
  previousTime?: string;
}): Promise<{ clientOk: boolean; proOk: boolean }> {
  const branding = await getBranding();

  const sendToRecipient = async (
    recipient: "client" | "professional",
  ): Promise<boolean> => {
    // The professional is only notified when an admin made the change.
    if (recipient === "professional" && data.actor !== "admin") return false;

    const toEmail =
      recipient === "client" ? data.clientEmail : data.professionalEmail;
    if (!toEmail) return false;
    const lang: "fr" | "en" =
      (recipient === "client" ? data.clientLocale : data.professionalLocale) ===
      "en"
        ? "en"
        : "fr";

    const teamName =
      lang === "fr" ? "l'équipe Je chemine" : "the Je chemine team";
    const recipientName =
      recipient === "client"
        ? data.clientName
        : formatProfessionalName(data.professionalName, lang);
    const otherParty =
      recipient === "client"
        ? formatProfessionalName(data.professionalName, lang)
        : data.clientName;
    const greeting =
      lang === "fr" ? `Bonjour ${recipientName},` : `Hello ${recipientName},`;
    // Attribution only appears in the professional's email (admin case). The
    // client's email simply states the change with the professional's name, so
    // it reads cleanly whether an admin or the professional made it.
    const byTeam =
      recipient === "professional"
        ? lang === "fr"
          ? ` par ${teamName}`
          : ` by ${teamName}`
        : "";

    const newDate = formatEmailDate(data.date, lang);
    const newTime = formatTime(data.time, lang);
    const prevDate = data.previousDate
      ? formatEmailDate(data.previousDate, lang)
      : null;
    const prevTime = data.previousTime
      ? formatTime(data.previousTime, lang)
      : null;
    const typeLabel = data.type ? formatAppointmentType(data.type, lang) : null;

    if (data.action === "rescheduled") {
      // Admin-editable template; hardcoded block below is the fallback.
      const prevDateTime = prevDate
        ? prevTime
          ? lang === "fr"
            ? `${prevDate} à ${prevTime}`
            : `${prevDate} at ${prevTime}`
          : prevDate
        : "";
      const editableR = await loadEditableTemplate("appointmentRescheduled", lang, {
        recipientName,
        otherParty,
        byTeam,
        prevDateTime,
        newDate,
        newTime,
        type: typeLabel || "",
        location: data.location || "",
      });
      if (editableR) {
        const html = buildEmailHtml({
          title: editableR.title,
          subtitle: editableR.subtitle,
          theme: "info",
          greeting: "",
          intro: editableR.bodyHtml,
          branding,
          lang,
        });
        const text = buildEmailText(
          [
            editableR.title,
            editableR.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          ],
          lang,
        );
        return sendEmail(
          { to: toEmail, subject: editableR.subject, html, text },
          "appointment_confirmation",
        );
      }

      const intro =
        lang === "fr"
          ? `Votre rendez-vous avec ${otherParty} a été reporté${byTeam}.`
          : `Your appointment with ${otherParty} has been rescheduled${byTeam}.`;
      const details =
        lang === "fr"
          ? [
              ...(prevDate
                ? [
                    {
                      label: "Ancien rendez-vous",
                      value: prevTime ? `${prevDate} à ${prevTime}` : prevDate,
                    },
                  ]
                : []),
              { label: "Nouvelle date", value: newDate },
              { label: "Nouvelle heure", value: newTime },
              ...(typeLabel ? [{ label: "Type", value: typeLabel }] : []),
              ...(data.location ? [{ label: "Lieu", value: data.location }] : []),
            ]
          : [
              ...(prevDate
                ? [
                    {
                      label: "Previous appointment",
                      value: prevTime ? `${prevDate} at ${prevTime}` : prevDate,
                    },
                  ]
                : []),
              { label: "New date", value: newDate },
              { label: "New time", value: newTime },
              ...(typeLabel ? [{ label: "Type", value: typeLabel }] : []),
              ...(data.location
                ? [{ label: "Location", value: data.location }]
                : []),
            ];
      const outro =
        lang === "fr"
          ? "Si cette nouvelle plage ne vous convient pas, veuillez nous contacter."
          : "If this new time does not suit you, please contact us.";
      const html = buildEmailHtml({
        title:
          lang === "fr" ? "Rendez-vous reporté" : "Appointment rescheduled",
        theme: "info",
        greeting,
        intro,
        details,
        outro,
        branding,
        lang,
      });
      const text = buildEmailText(
        [
          lang === "fr" ? "Rendez-vous reporté" : "Appointment rescheduled",
          greeting,
          intro,
          ...details.map((d) => `${d.label} : ${d.value}`),
          outro,
        ],
        lang,
      );
      const subject = await getSubject(
        "appointment_confirmation",
        lang === "fr"
          ? "Votre rendez-vous a été reporté — Je chemine"
          : "Your appointment was rescheduled — Je chemine",
      );
      return sendEmail(
        { to: toEmail, subject, html, text },
        "appointment_confirmation",
      );
    }

    // cancelled
    const whenStr = prevDate
      ? prevTime
        ? lang === "fr"
          ? ` du ${prevDate} à ${prevTime}`
          : ` on ${prevDate} at ${prevTime}`
        : lang === "fr"
          ? ` du ${prevDate}`
          : ` on ${prevDate}`
      : "";
    // Admin-editable template; hardcoded block below is the fallback.
    const editableC = await loadEditableTemplate("appointmentChangeCancelled", lang, {
      recipientName,
      whenStr,
      otherParty,
      byTeam,
      prevDate: prevDate || "",
      prevTime: prevTime || "",
    });
    if (editableC) {
      const html = buildEmailHtml({
        title: editableC.title,
        subtitle: editableC.subtitle,
        theme: "danger",
        greeting: "",
        intro: editableC.bodyHtml,
        branding,
        lang,
      });
      const text = buildEmailText(
        [
          editableC.title,
          editableC.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        ],
        lang,
      );
      return sendEmail(
        { to: toEmail, subject: editableC.subject, html, text },
        "appointment_cancellation",
      );
    }

    const intro =
      lang === "fr"
        ? `Votre rendez-vous${whenStr} avec ${otherParty} a été annulé${byTeam}.`
        : `Your appointment${whenStr} with ${otherParty} has been cancelled${byTeam}.`;
    const details = prevDate
      ? lang === "fr"
        ? [
            { label: "Date initiale", value: prevDate },
            ...(prevTime ? [{ label: "Heure initiale", value: prevTime }] : []),
          ]
        : [
            { label: "Original date", value: prevDate },
            ...(prevTime ? [{ label: "Original time", value: prevTime }] : []),
          ]
      : undefined;
    const outro =
      lang === "fr"
        ? "Si vous avez des questions ou souhaitez reprendre rendez-vous, veuillez nous contacter."
        : "If you have any questions or would like to rebook, please contact us.";
    const html = buildEmailHtml({
      title: lang === "fr" ? "Rendez-vous annulé" : "Appointment cancelled",
      theme: "danger",
      greeting,
      intro,
      details,
      detailsBorderColor: "#ef4444",
      outro,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        lang === "fr" ? "Rendez-vous annulé" : "Appointment cancelled",
        greeting,
        intro,
        ...(details ? details.map((d) => `${d.label} : ${d.value}`) : []),
        outro,
      ],
      lang,
    );
    const subject = await getSubject(
      "appointment_cancellation",
      lang === "fr"
        ? "Rendez-vous annulé — Je chemine"
        : "Appointment cancelled — Je chemine",
    );
    return sendEmail(
      { to: toEmail, subject, html, text },
      "appointment_cancellation",
    );
  };

  const [clientOk, proOk] = await Promise.all([
    sendToRecipient("client"),
    sendToRecipient("professional"),
  ]);
  return { clientOk, proOk };
}

// =============================================================================
// Public Email Functions - Payments
// =============================================================================

export async function sendPaymentFailedNotification(
  data: PaymentEmailData & { locale?: "fr" | "en" },
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const paymentUrl = `${process.env.NEXTAUTH_URL}/payment`;

  const amountStr =
    lang === "fr"
      ? `${data.amount.toFixed(2)} $ ${currency}`
      : `${currency} $${data.amount.toFixed(2)}`;

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("paymentFailed", lang, {
    clientName: data.name,
    amount: amountStr,
    appointmentDate: data.appointmentDate
      ? formatEmailDate(data.appointmentDate, lang)
      : "",
    professionalName: data.professionalName
      ? formatProfessionalName(data.professionalName, lang)
      : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "danger",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: paymentUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${paymentUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.email, subject: editable.subject, html, text },
      "payment_failed",
    );
  }

  const html = buildEmailHtml({
    title: lang === "fr" ? "Paiement échoué" : "Payment failed",
    subtitle: lang === "fr" ? "Action requise" : "Action required",
    theme: "danger",
    greeting:
      lang === "fr" ? `Bonjour ${data.name},` : `Hello ${data.name},`,
    intro:
      lang === "fr"
        ? "Malheureusement, nous n'avons pas pu traiter votre paiement. Veuillez mettre à jour votre moyen de paiement et réessayer."
        : "Unfortunately, we were unable to process your payment. Please update your payment method and try again.",
    details: data.appointmentDate
      ? lang === "fr"
        ? [
            { label: "Montant", value: amountStr },
            {
              label: "Date du rendez-vous",
              value: formatEmailDate(data.appointmentDate, "fr"),
            },
            {
              label: "Professionnel",
              value: formatProfessionalName(data.professionalName, "fr"),
            },
          ]
        : [
            { label: "Amount", value: amountStr },
            {
              label: "Appointment date",
              value: formatEmailDate(data.appointmentDate, "en"),
            },
            {
              label: "Professional",
              value: formatProfessionalName(data.professionalName, "en"),
            },
          ]
      : [
          {
            label: lang === "fr" ? "Montant" : "Amount",
            value: amountStr,
          },
        ],
    button: {
      text: lang === "fr" ? "Réessayer le paiement" : "Retry payment",
      url: paymentUrl,
    },
    infoBox: {
      title: lang === "fr" ? "Besoin d'aide ?" : "Need help?",
      content:
        lang === "fr"
          ? "Si les problèmes persistent, veuillez contacter notre équipe de soutien."
          : "If the problem persists, please contact our support team.",
      theme: "info",
    },
    outro:
      lang === "fr"
        ? "Veuillez résoudre ce problème dans les 24 heures pour conserver votre plage horaire."
        : "Please resolve this within 24 hours to keep your appointment slot.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Paiement échoué — Action requise",
          `Bonjour ${data.name},`,
          "Votre paiement n'a pas pu être traité.",
          `Montant : ${amountStr}`,
          `Réessayer le paiement : ${paymentUrl}`,
        ]
      : [
          "Payment failed — Action required",
          `Hello ${data.name},`,
          "Your payment could not be processed.",
          `Amount: ${amountStr}`,
          `Retry payment: ${paymentUrl}`,
        ],
    lang,
  );

  const subject = await getSubject(
    "payment_failed",
    lang === "fr"
      ? "Paiement échoué — Action requise"
      : "Payment failed — Action required",
  );

  return sendEmail({ to: data.email, subject, html, text }, "payment_failed");
}

export async function sendRefundConfirmation(
  data: PaymentEmailData & { locale?: "fr" | "en" },
): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";

  const amountStr =
    lang === "fr"
      ? `${data.amount.toFixed(2)} $ ${currency}`
      : `${currency} $${data.amount.toFixed(2)}`;

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("refundConfirmation", lang, {
    name: data.name,
    amount: amountStr,
    appointmentDate: data.appointmentDate
      ? formatEmailDate(data.appointmentDate, lang)
      : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      ],
      lang,
    );
    return sendEmail(
      { to: data.email, subject: editable.subject, html, text },
      "payment_refund",
    );
  }

  const html = buildEmailHtml({
    title: lang === "fr" ? "Remboursement traité" : "Refund processed",
    theme: "info",
    greeting:
      lang === "fr" ? `Bonjour ${data.name},` : `Hello ${data.name},`,
    intro:
      lang === "fr"
        ? "Votre remboursement a été traité avec succès. Les fonds devraient apparaître dans votre compte dans un délai de 5 à 10 jours ouvrables."
        : "Your refund has been processed successfully. The funds should appear in your account within 5 to 10 business days.",
    details: [
      {
        label: lang === "fr" ? "Montant remboursé" : "Refunded amount",
        value: amountStr,
      },
      ...(data.appointmentDate
        ? [
            {
              label:
                lang === "fr"
                  ? "Rendez-vous initial"
                  : "Original appointment",
              value: formatEmailDate(data.appointmentDate, lang),
            },
          ]
        : []),
    ],
    infoBox: {
      title:
        lang === "fr" ? "Délai de traitement" : "Processing time",
      content:
        lang === "fr"
          ? "Les remboursements prennent généralement 5 à 10 jours ouvrables pour apparaître sur votre relevé, selon votre institution bancaire."
          : "Refunds typically take 5 to 10 business days to appear on your statement, depending on your bank.",
    },
    outro:
      lang === "fr"
        ? "Si vous avez des questions concernant ce remboursement, veuillez contacter notre équipe de soutien."
        : "If you have any questions about this refund, please contact our support team.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Remboursement traité",
          `Bonjour ${data.name},`,
          "Votre remboursement a été traité.",
          `Montant : ${amountStr}`,
          "Les fonds devraient apparaître dans votre compte dans un délai de 5 à 10 jours ouvrables.",
        ]
      : [
          "Refund processed",
          `Hello ${data.name},`,
          "Your refund has been processed.",
          `Amount: ${amountStr}`,
          "The funds should appear in your account within 5 to 10 business days.",
        ],
    lang,
  );

  const subject = await getSubject(
    "payment_refund",
    lang === "fr"
      ? "Remboursement traité — Je chemine"
      : "Refund processed — Je chemine",
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
  const lang = "fr";

  const editable = await loadEditableTemplate("professionalApproval", lang, {
    name: data.name,
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
      "professional_approval",
    );
  }

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

  // Admin-editable template (subject/title/body); the hardcoded block below is
  // the fallback if the DB row can't be loaded. French-only, no CTA button.
  const editable = await loadEditableTemplate("professionalRejection", "fr", {
    name: data.name,
    reason: data.reason ?? "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      ],
      "fr",
    );
    return sendEmail(
      { to: data.email, subject: editable.subject, html, text },
      "professional_rejection",
    );
  }

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
    "Mise à jour de votre candidature — Je chemine",
  );

  return sendEmail(
    { to: data.email, subject, html, text },
    "professional_rejection",
  );
}

/** Alerte admins : un client a choisi Interac / virement (entente de confiance à valider). */
/**
 * Resolve where platform/admin alerts are delivered. An admin-configured
 * dedicated address (PlatformSettings.adminAlertEmail) takes PRECEDENCE so the
 * team can route ALL transactional notifications to one mailbox (client §3.2)
 * instead of personal admin accounts. Comma-separated values allowed. Falls back
 * to admin user accounts, then the ADMIN_ALERT_EMAIL env var. Callers must have
 * an open DB connection (they all call connectToDatabase() first).
 */
async function getAdminAlertRecipients(): Promise<string[]> {
  const settings = await PlatformSettings.findOne()
    .select("adminAlertEmail")
    .lean();
  const configured = (settings?.adminAlertEmail ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;

  const adminUsers = await User.find({ isAdmin: true, role: "admin" })
    .select("email")
    .lean();
  const userEmails = adminUsers
    .map((a) => a.email)
    .filter((e): e is string => Boolean(e));
  if (userEmails.length > 0) return userEmails;

  if (process.env.ADMIN_ALERT_EMAIL) {
    return process.env.ADMIN_ALERT_EMAIL.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function sendAdminInteracTrustRequestAlert(data: {
  clientName: string;
  clientEmail: string;
  appointmentId: string;
}): Promise<void> {
  await connectToDatabase();
  const emails = await getAdminAlertRecipients();
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

  // Admin-editable template; the hardcoded block below is the fallback. Body is
  // French (admin alert).
  const editable = await loadEditableTemplate("adminInteracTrustRequest", "fr", {
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    appointmentId: data.appointmentId,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: reviewUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${reviewUrl}` : "",
      ],
      "fr",
    );
    for (const to of emails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "admin_interac_trust_request",
      );
    }
    return;
  }

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

/**
 * Admin alert when a post-session invoice hits H+48 unpaid (after the two
 * automatic reminders) and flips to "Paiement en retard" — human follow-up
 * required. French (admin-facing). Reuses the admin-alert recipients + the
 * admin_interac_trust_request category for logging.
 */
export async function sendAdminPaymentOverdueAlert(data: {
  clientName: string;
  clientEmail: string;
  professionalName: string;
  amountCad: number;
  invoiceNumber: string;
  appointmentId: string;
}): Promise<void> {
  await connectToDatabase();
  const emails = await getAdminAlertRecipients();
  if (emails.length === 0) {
    console.warn(
      "[admin_payment_overdue] No admin emails — set ADMIN_ALERT_EMAIL or admin users.",
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
    title: "Paiement en retard — suivi requis",
    subtitle: `Facture n° ${data.invoiceNumber}`,
    theme: "warning",
    greeting: "Bonjour,",
    intro:
      "Une facture est restée impayée 48 heures après la séance, malgré deux relances automatiques (courriel + SMS). Elle est passée au statut « Paiement en retard » et nécessite un suivi humain.",
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Professionnel", value: data.professionalName || "—" },
      { label: "Montant", value: `${data.amountCad.toFixed(2)} $ CAD` },
      { label: "Facture", value: data.invoiceNumber },
    ],
    button: { text: "Ouvrir la réconciliation des paiements", url: reviewUrl },
    outro:
      "Vérifiez si un virement Interac est arrivé (même sous un autre nom), puis associez le paiement et marquez la facture payée depuis l'écran de réconciliation — ou relancez le client.",
    branding,
  });

  const text = buildEmailText([
    "Paiement en retard — action admin requise",
    `Facture : ${data.invoiceNumber}`,
    `Client : ${data.clientName} (${data.clientEmail})`,
    `Professionnel : ${data.professionalName || "—"}`,
    `Montant : ${data.amountCad.toFixed(2)} $ CAD`,
    `Suivi : ${reviewUrl}`,
  ]);

  const subject = `Paiement en retard — facture ${data.invoiceNumber} (suivi requis)`;

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
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const company = branding?.companyName || "Je chemine";
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";

  const smsBlock = (
    lang === "fr"
      ? [
          "Paiement Interac Rapide ⚡",
          `📧 Courriel : ${data.depositEmail}`,
          `💰 Montant : ${data.amountCad.toFixed(2)} $`,
          `📝 Message obligatoire : ${data.interacReferenceCode}`,
          "",
          "Le système pourra associer votre virement à votre dossier grâce à ce code.",
        ]
      : [
          "Quick Interac e-Transfer ⚡",
          `📧 Email: ${data.depositEmail}`,
          `💰 Amount: CAD $${data.amountCad.toFixed(2)}`,
          `📝 Mandatory message: ${data.interacReferenceCode}`,
          "",
          "The system uses this code to match your transfer to your file.",
        ]
  ).join("\n");

  const amountStr =
    lang === "fr"
      ? `${data.amountCad.toFixed(2)} $`
      : `CAD $${data.amountCad.toFixed(2)}`;

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("interacInstructions", lang, {
    clientName: data.clientName,
    clientLegalName: data.clientLegalName,
    professionalName: data.professionalName,
    appointmentDateLabel: data.appointmentDateLabel,
    depositEmail: data.depositEmail,
    amount: amountStr,
    interacReferenceCode: data.interacReferenceCode,
    companyName: company,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "interac_transfer_instructions",
    );
  }

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "Instructions — virement Interac"
        : "Instructions — Interac e-Transfer",
    theme: "info",
    greeting:
      lang === "fr"
        ? `Bonjour ${data.clientName},`
        : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? `Voici comment envoyer votre virement pour votre séance avec ${data.professionalName} (${data.appointmentDateLabel}).`
        : `Here is how to send your transfer for your session with ${data.professionalName} (${data.appointmentDateLabel}).`,
    details:
      lang === "fr"
        ? [
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
          ]
        : [
            {
              label: "1. Send your transfer to",
              value: data.depositEmail,
            },
            {
              label: "2. Name verification",
              value: `The name on your bank account must match the one on file: ${data.clientLegalName}.`,
            },
            {
              label: "3. Third-party or business account",
              value:
                "Add your full name in the e-Transfer Message field so we can identify your payment.",
            },
            {
              label: "4. Mandatory message (unique reference)",
              value: data.interacReferenceCode,
            },
          ],
    infoBox: {
      title:
        lang === "fr"
          ? "Format court (idéal mobile / SMS)"
          : "Short format (ideal for mobile / SMS)",
      content: smsBlock.split("\n").join("<br/>"),
      theme: "info",
    },
    outro:
      lang === "fr"
        ? `PAD et carte : vous pouvez aussi enregistrer un moyen de paiement sécurisé (Stripe) depuis votre espace Facturation. Pour les PME, des solutions type prélèvement avec mandat (ex. intégrations bancaires spécialisées) peuvent s’ajouter — contactez ${company} pour plus d’informations.`
        : `PAD and card: you can also save a secure payment method (Stripe) from your Billing area. For small businesses, mandate-based pre-authorized debit options may be available — contact ${company} for details.`,
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
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
        ]
      : [
          "Interac e-Transfer instructions",
          `Hello ${data.clientName},`,
          `Session with ${data.professionalName} — ${data.appointmentDateLabel}`,
          "",
          `1. Send transfer to: ${data.depositEmail}`,
          `2. Name: must match "${data.clientLegalName}"`,
          "3. Third-party / business: add your full name in the transfer Message field.",
          `4. Mandatory message: ${data.interacReferenceCode}`,
          `Amount: CAD $${data.amountCad.toFixed(2)}`,
          "",
          "— SMS format —",
          smsBlock,
        ],
    lang,
  );

  const subject = await getSubject(
    "interac_transfer_instructions",
    lang === "fr"
      ? "Instructions virement Interac — Je chemine"
      : "Interac e-Transfer instructions — Je chemine",
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
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const company = branding?.companyName || "Je chemine";
  const isUrgent = data.reminderNumber === 2;
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";

  const smsBlock = (
    lang === "fr"
      ? [
          "Paiement Interac Rapide ⚡",
          `📧 Courriel : ${data.depositEmail}`,
          `💰 Montant : ${data.amountCad.toFixed(2)} $`,
          `📝 Message obligatoire : ${data.interacReferenceCode}`,
          "",
          "Le système associera votre virement à votre dossier grâce à ce code.",
        ]
      : [
          "Quick Interac e-Transfer ⚡",
          `📧 Email: ${data.depositEmail}`,
          `💰 Amount: CAD $${data.amountCad.toFixed(2)}`,
          `📝 Mandatory message: ${data.interacReferenceCode}`,
          "",
          "The system uses this code to match your transfer to your file.",
        ]
  ).join("\n");

  const amountStr =
    lang === "fr"
      ? `${data.amountCad.toFixed(2)} $ CAD`
      : `CAD $${data.amountCad.toFixed(2)}`;

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("interacReminder", lang, {
    clientName: data.clientName,
    appointmentDateLabel: data.appointmentDateLabel,
    depositEmail: data.depositEmail,
    amount: amountStr,
    interacReferenceCode: data.interacReferenceCode,
    companyName: company,
    reminderNumber: String(data.reminderNumber),
    isUrgent: isUrgent ? "true" : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: isUrgent ? "warning" : "info",
      greeting: "",
      intro: editable.bodyHtml,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "interac_payment_reminder",
    );
  }

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? `Rappel de paiement — Interac (${data.reminderNumber === 1 ? "J+1" : "J+2"})`
        : `Payment reminder — Interac (${data.reminderNumber === 1 ? "Day +1" : "Day +2"})`,
    theme: isUrgent ? "warning" : "info",
    greeting:
      lang === "fr"
        ? `Bonjour ${data.clientName},`
        : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? isUrgent
          ? `Deuxième rappel : votre paiement Interac pour la séance du ${data.appointmentDateLabel} est toujours en attente. Veuillez envoyer votre virement dès que possible afin d'éviter un signalement de retard.`
          : `Nous n'avons pas encore reçu votre virement Interac pour votre séance du ${data.appointmentDateLabel}. Voici un rappel des instructions de paiement.`
        : isUrgent
          ? `Second reminder: your Interac transfer for the session on ${data.appointmentDateLabel} is still pending. Please send your transfer as soon as possible to avoid a late-payment flag.`
          : `We haven't received your Interac transfer for your session on ${data.appointmentDateLabel} yet. Here is a reminder of the payment instructions.`,
    details:
      lang === "fr"
        ? [
            { label: "1. Envoyer à", value: data.depositEmail },
            {
              label: "2. Nom",
              value: `Le nom de votre compte bancaire doit correspondre à celui de votre dossier : ${data.clientName}.`,
            },
            {
              label: "3. Compte tiers / entreprise",
              value:
                "Indiquez votre nom complet dans le champ « Message » du virement.",
            },
            {
              label: "4. Message obligatoire (code unique)",
              value: data.interacReferenceCode,
            },
            {
              label: "Montant",
              value: `${data.amountCad.toFixed(2)} $ CAD`,
            },
          ]
        : [
            { label: "1. Send to", value: data.depositEmail },
            {
              label: "2. Name",
              value: `Your bank account name must match the one on file: ${data.clientName}.`,
            },
            {
              label: "3. Third-party / business account",
              value:
                "Add your full name in the e-Transfer Message field.",
            },
            {
              label: "4. Mandatory message (unique code)",
              value: data.interacReferenceCode,
            },
            {
              label: "Amount",
              value: `CAD $${data.amountCad.toFixed(2)}`,
            },
          ],
    infoBox: {
      title:
        lang === "fr"
          ? "Format court (idéal mobile / SMS)"
          : "Short format (ideal for mobile / SMS)",
      content: smsBlock.split("\n").join("<br/>"),
      theme: isUrgent ? "warning" : "info",
    },
    outro:
      lang === "fr"
        ? isUrgent
          ? `Votre paiement est en retard. Si vous rencontrez des difficultés, contactez le soutien de ${company} immédiatement.`
          : `En cas de difficulté, contactez-nous à l'adresse de support de ${company}.`
        : isUrgent
          ? `Your payment is overdue. If you run into any trouble, contact ${company} support immediately.`
          : `If you encounter any difficulty, reach ${company} support.`,
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
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
        ]
      : [
          `Interac payment reminder (reminder #${data.reminderNumber})`,
          `Hello ${data.clientName},`,
          `Session on ${data.appointmentDateLabel}`,
          "",
          `1. Send to: ${data.depositEmail}`,
          `2. Name: must match "${data.clientName}"`,
          "3. Third-party / business: add your name in the Message field.",
          `4. Mandatory message: ${data.interacReferenceCode}`,
          `Amount: CAD $${data.amountCad.toFixed(2)}`,
          "",
          "— SMS format —",
          smsBlock,
        ],
    lang,
  );

  const subject = await getSubject(
    "interac_payment_reminder",
    lang === "fr"
      ? `Rappel paiement Interac — ${company}`
      : `Interac payment reminder — ${company}`,
  );

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "interac_payment_reminder",
  );
}

/**
 * Demande de paiement post-séance (carte de crédit) — courriel épuré envoyé dès
 * que le professionnel valide la séance, AVANT toute confirmation de paiement.
 * Référence le numéro de facture unique et propose un bouton « Payer
 * maintenant » (passerelle Stripe). Le reçu officiel n'est PAS joint : il suit
 * uniquement après la confirmation réelle du paiement (règle d'or).
 */
export async function sendSessionInvoiceEmail(data: {
  clientEmail: string;
  clientName: string;
  amountCad: number;
  invoiceNumber: string;
  appointmentDateLabel: string;
  payUrl: string;
  /** Interac deposit address (admin-configurable). */
  depositEmail: string;
  /** Client's legal name — for the Interac name-match guidance. */
  clientLegalName: string;
  /** Professional who delivered the session — for context + admin reconciliation. */
  professionalName: string;
  /** When set, frame the email as an automatic dunning reminder (1 = H+12, 2 = H+36). */
  reminderNumber?: 1 | 2;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const reminder = Boolean(data.reminderNumber);
  const amount =
    lang === "fr"
      ? `${data.amountCad.toFixed(2)} $ CAD`
      : `CAD $${data.amountCad.toFixed(2)}`;

  const html = buildEmailHtml({
    title: reminder
      ? lang === "fr"
        ? "Rappel — paiement de votre séance"
        : "Reminder — payment for your session"
      : lang === "fr"
        ? "Paiement de votre séance"
        : "Payment for your session",
    subtitle:
      lang === "fr"
        ? `Facture n° ${data.invoiceNumber}`
        : `Invoice no. ${data.invoiceNumber}`,
    theme: reminder ? "warning" : "info",
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? `${reminder ? "Rappel : votre facture est toujours impayée. " : ""}Votre séance du ${data.appointmentDateLabel} avec ${data.professionalName} est terminée. Montant à régler : ${amount} (facture n° ${data.invoiceNumber}). Choisissez votre mode de paiement : par carte de crédit (bouton ci-dessous) ou par virement Interac (instructions plus bas). Aucun compte n'est nécessaire. Votre reçu officiel vous sera transmis dès la confirmation du paiement.`
        : `${reminder ? "Reminder: your invoice is still unpaid. " : ""}Your session on ${data.appointmentDateLabel} with ${data.professionalName} is complete. Amount due: ${amount} (invoice no. ${data.invoiceNumber}). Choose how to pay: by credit card (button below) or by Interac e-Transfer (instructions below). No account required. Your official receipt will be sent as soon as the payment is confirmed.`,
    button: {
      text: lang === "fr" ? "Payer par carte de crédit" : "Pay by credit card",
      url: data.payUrl,
    },
    // Card CTA above the Interac instructions so the quickest option is first.
    buttonAboveInfo: true,
    details:
      lang === "fr"
        ? [
            { label: "Virement Interac — 1. Envoyez à", value: data.depositEmail },
            { label: "2. Montant", value: amount },
            {
              label: "3. Note obligatoire du virement",
              value: data.invoiceNumber,
            },
            {
              label: "4. Nom du compte bancaire",
              value: `Idéalement identique à « ${data.clientLegalName} ». Si le virement provient d'un autre nom (ex. conjoint), inscrivez bien le numéro de facture ${data.invoiceNumber} dans la note pour que nous puissions associer votre paiement.`,
              stacked: true,
            },
          ]
        : [
            { label: "Interac e-Transfer — 1. Send to", value: data.depositEmail },
            { label: "2. Amount", value: amount },
            {
              label: "3. Mandatory transfer note",
              value: data.invoiceNumber,
            },
            {
              label: "4. Bank account name",
              value: `Ideally identical to "${data.clientLegalName}". If the transfer comes from another name (e.g. a spouse), be sure to add invoice number ${data.invoiceNumber} in the note so we can match your payment.`,
              stacked: true,
            },
          ],
    // The short copy-pasteable Interac block ("Format court") was removed from
    // this email — it duplicated the numbered instructions above. The mobile
    // short format now lives only in the companion SMS (sendSessionInvoiceSms).
    outro:
      lang === "fr"
        ? "Merci,<br>L'équipe de Je chemine"
        : "Thank you,<br>The Je chemine team",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          `Facture n° ${data.invoiceNumber}`,
          `Bonjour ${data.clientName},`,
          `Votre séance du ${data.appointmentDateLabel} avec ${data.professionalName} est terminée. Montant à régler : ${amount}.`,
          "Payer par carte de crédit (aucun compte requis) :",
          data.payUrl,
          "",
          "Ou par virement Interac :",
          `• Envoyez à : ${data.depositEmail}`,
          `• Montant : ${amount}`,
          `• Note obligatoire du virement : ${data.invoiceNumber}`,
          `• Nom du compte : idéalement « ${data.clientLegalName} » (sinon, indiquez bien le numéro de facture dans la note).`,
          "",
          "Votre reçu officiel suivra dès la confirmation du paiement.",
        ]
      : [
          `Invoice no. ${data.invoiceNumber}`,
          `Hello ${data.clientName},`,
          `Your session on ${data.appointmentDateLabel} with ${data.professionalName} is complete. Amount due: ${amount}.`,
          "Pay by credit card (no account required):",
          data.payUrl,
          "",
          "Or by Interac e-Transfer:",
          `• Send to: ${data.depositEmail}`,
          `• Amount: ${amount}`,
          `• Mandatory transfer note: ${data.invoiceNumber}`,
          `• Account name: ideally "${data.clientLegalName}" (otherwise add the invoice number in the note).`,
          "",
          "Your official receipt will follow once the payment is confirmed.",
        ],
    lang,
  );

  const subject = reminder
    ? lang === "fr"
      ? `Rappel : facture ${data.invoiceNumber} impayée`
      : `Reminder: invoice ${data.invoiceNumber} unpaid`
    : lang === "fr"
      ? `Facture ${data.invoiceNumber} — paiement de votre séance`
      : `Invoice ${data.invoiceNumber} — payment for your session`;

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_invitation",
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

  const editable = await loadEditableTemplate("fiscalReceipt", lang, {
    clientName: data.clientName,
    amount: lang === "fr" ? amountFr : amountEn,
    paymentPendingTransfer: data.paymentPendingTransfer ? "true" : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: data.paymentPendingTransfer ? "warning" : "success",
      greeting: "",
      intro: editable.bodyHtml,
      button: undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      ],
      lang,
    );
    return sendEmail(
      {
        to: data.clientEmail,
        subject: editable.subject,
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
  const editable = await loadEditableTemplate("paymentGuaranteeDay1", lang, {
    clientName: data.clientName,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.billingUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${data.billingUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "payment_guarantee_day1_reminder",
    );
  }

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
  const editable = await loadEditableTemplate("paymentGuaranteeDay2", lang, {
    clientName: data.clientName,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "danger",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.billingUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${data.billingUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "payment_guarantee_day2_reminder",
    );
  }

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
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const editable = await loadEditableTemplate("paymentGuarantee48hClient", lang, {
    clientName: data.clientName,
    appointmentDateLabel: data.appointmentDateLabel,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "danger",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: data.billingUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${data.billingUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "payment_guarantee_48h_client",
    );
  }
  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "URGENT — rendez-vous proche"
        : "URGENT — appointment approaching",
    theme: "danger",
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? `Votre rendez-vous du ${data.appointmentDateLabel} approche. Aucune garantie de paiement (carte/PAD) n’est en place. Merci d’agir immédiatement pour éviter tout report.`
        : `Your appointment on ${data.appointmentDateLabel} is approaching. No payment guarantee (card/PAD) is on file. Please act immediately to avoid any rescheduling.`,
    button: {
      text:
        lang === "fr"
          ? "Ajouter un moyen de paiement"
          : "Add a payment method",
      url: data.billingUrl,
    },
    branding,
    lang,
  });
  const text = buildEmailText(
    lang === "fr"
      ? [
          "URGENT — moyen de paiement",
          `Bonjour ${data.clientName},`,
          `Rendez-vous : ${data.appointmentDateLabel}`,
          data.billingUrl,
        ]
      : [
          "URGENT — payment method required",
          `Hello ${data.clientName},`,
          `Appointment: ${data.appointmentDateLabel}`,
          data.billingUrl,
        ],
    lang,
  );
  const subject = await getSubject(
    "payment_guarantee_48h_client",
    lang === "fr"
      ? "URGENT : moyen de paiement — Je chemine"
      : "URGENT: payment method — Je chemine",
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
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const dashboardUrl = `${base}/professional/dashboard/sessions`;

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("paymentGuarantee48hPro", lang, {
    professionalName: data.professionalName,
    clientName: data.clientName,
    appointmentDateLabel: data.appointmentDateLabel,
    appointmentId: data.appointmentId,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "danger",
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
      { to: data.professionalEmail, subject: editable.subject, html, text },
      "payment_guarantee_48h_professional",
    );
  }

  const html = buildEmailHtml({
    title:
      lang === "fr"
        ? "ALERTE — client sans garantie de paiement"
        : "ALERT — client without payment guarantee",
    theme: "danger",
    greeting:
      lang === "fr"
        ? `Bonjour ${data.professionalName},`
        : `Hello ${data.professionalName},`,
    intro:
      lang === "fr"
        ? `Le client ${data.clientName} n’a toujours pas de carte ni prélèvement enregistré pour le rendez-vous du ${data.appointmentDateLabel}. Dernière relance automatique envoyée au client.`
        : `Client ${data.clientName} still has no card or pre-authorized debit on file for the appointment on ${data.appointmentDateLabel}. Final automatic reminder sent to the client.`,
    details: [
      {
        label: lang === "fr" ? "Rendez-vous" : "Appointment",
        value: data.appointmentId,
      },
    ],
    button: {
      text: lang === "fr" ? "Voir les séances" : "View sessions",
      url: dashboardUrl,
    },
    branding,
    lang,
  });
  const text = buildEmailText(
    lang === "fr"
      ? [
          "ALERTE garantie paiement",
          `Bonjour ${data.professionalName},`,
          `Client : ${data.clientName}`,
          `Date : ${data.appointmentDateLabel}`,
          dashboardUrl,
        ]
      : [
          "ALERT — payment guarantee",
          `Hello ${data.professionalName},`,
          `Client: ${data.clientName}`,
          `Date: ${data.appointmentDateLabel}`,
          dashboardUrl,
        ],
    lang,
  );
  const subject = await getSubject(
    "payment_guarantee_48h_professional",
    lang === "fr"
      ? "ALERTE : client sans garantie — rendez-vous proche"
      : "ALERT: client without payment guarantee — appointment approaching",
  );
  return sendEmail(
    { to: data.professionalEmail, subject, html, text },
    "payment_guarantee_48h_professional",
  );
}

/**
 * Envoyé au client dès qu'un professionnel accepte sa demande (jumelage réussi).
 * N'invite PAS au paiement : la date du 1er RDV n'est pas encore fixée. Le
 * professionnel contactera le client pour convenir d'une date, après quoi le
 * courriel de confirmation du 1er RDV (avec l'invitation au paiement) part
 * depuis l'étape de planification (POST /api/appointments/[id]/schedule-first).
 */
export async function sendJumelageSuccessEmail(data: {
  clientName: string;
  clientEmail: string;
  professionalName?: string;
  locale?: "fr" | "en";
  /** Link inviting the client to finish setting up their account (claim or complete profile). */
  completeAccountUrl?: string;
  /**
   * "Add a payment method" deep-link (Interac or card). Passed by callers ONLY
   * for active clients — the dashboard billing page is auth-gated, so a
   * guest/prospect (who must claim their account first via completeAccountUrl)
   * gets no payment button. When present, renders a soft secondary CTA
   * encouraging the client to add a payment method, with a "skip if already
   * done" note. Optional on purpose: nothing is required at jumelage time.
   */
  addPaymentMethodUrl?: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";

  // Soft, optional nudge (active clients only): complete your profile + add a
  // payment method now to save time before the first appointment. Rendered as a
  // secondary button in BOTH the editable and fallback branches — it is NOT part
  // of the editable template (which carries only the primary "complete account"
  // CTA), so it needs no DB reseed. Reaches the client the moment they're matched.
  const paymentNudge = data.addPaymentMethodUrl
    ? {
        preamble:
          lang === "fr"
            ? "Pour gagner du temps avant votre premier rendez-vous, vous pouvez dès maintenant compléter votre profil et ajouter votre moyen de paiement (Interac ou carte de crédit). Si c'est déjà fait, ignorez simplement ce message."
            : "To save time before your first appointment, you can already complete your profile and add your payment method (Interac or credit card). If it's already done, simply ignore this message.",
        text:
          lang === "fr"
            ? "Ajouter un moyen de paiement"
            : "Add a payment method",
        url: data.addPaymentMethodUrl,
      }
    : undefined;

  // Admin-editable template; hardcoded block below is the fallback.
  // NOTE: jumelageSuccess is the one template that may have a PRE-EXISTING
  // (stale-seeded) DB row using the original placeholder names
  // ({{firstName}}, {{supportEmail}}, {{companyName}}). Pass those legacy
  // aliases alongside the current names so the email renders correctly whether
  // or not the DB row has been re-seeded to the corrected default.
  const editable = await loadEditableTemplate("jumelageSuccess", lang, {
    clientName: data.clientName,
    firstName: data.clientName,
    professionalName: data.professionalName || "",
    supportEmail: process.env.SUPPORT_EMAIL || "support@jechemine.ca",
    companyName: branding?.companyName || "Je chemine",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "success",
      greeting: "",
      intro: editable.bodyHtml,
      button:
        data.completeAccountUrl && editable.ctaText
          ? { text: editable.ctaText, url: data.completeAccountUrl }
          : undefined,
      secondaryButton: paymentNudge,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        data.completeAccountUrl && editable.ctaText
          ? `${editable.ctaText} : ${data.completeAccountUrl}`
          : "",
        paymentNudge
          ? `${paymentNudge.preamble}\n${paymentNudge.text} : ${paymentNudge.url}`
          : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "payment_invitation",
    );
  }

  const title = lang === "fr" ? "Jumelage réussi !" : "You've been matched!";
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
      ? "Bonne nouvelle : un professionnel a accepté votre demande. Il communiquera bientôt avec vous pour convenir ensemble de la date de votre premier rendez-vous."
      : "Good news: a professional has accepted your request. They will reach out to you shortly to agree together on the date of your first appointment.";
  const infoContent =
    lang === "fr"
      ? "Dès que la date de votre premier rendez-vous sera fixée avec votre professionnel, vous recevrez un courriel de confirmation avec les détails de paiement."
      : "As soon as the date of your first appointment is set with your professional, you'll receive a confirmation email with the payment details.";

  const html = buildEmailHtml({
    title,
    subtitle,
    theme: "success",
    badge: {
      text: lang === "fr" ? "✅ Jumelage confirmé" : "✅ Match confirmed",
      theme: "success",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Dear ${data.clientName},`,
    intro,
    infoBox: {
      title: lang === "fr" ? "Prochaines étapes" : "What happens next",
      content: infoContent,
    },
    button: data.completeAccountUrl
      ? {
          text: lang === "fr" ? "Compléter mon compte" : "Complete my account",
          url: data.completeAccountUrl,
        }
      : undefined,
    secondaryButton: paymentNudge,
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
        ? "Prochaines étapes : votre professionnel vous contactera pour fixer la date du premier rendez-vous. Vous recevrez ensuite un courriel de confirmation avec l'invitation au paiement."
        : "Next steps: your professional will contact you to set the date of your first appointment. You'll then receive a confirmation email with the payment invitation.",
      data.completeAccountUrl
        ? lang === "fr"
          ? `Compléter mon compte : ${data.completeAccountUrl}`
          : `Complete my account: ${data.completeAccountUrl}`
        : "",
      paymentNudge
        ? `${paymentNudge.preamble}\n${paymentNudge.text} : ${paymentNudge.url}`
        : "",
    ],
    lang,
  );

  const subject =
    lang === "fr"
      ? "Jumelage réussi — un professionnel a accepté votre demande"
      : "You've been matched — a professional accepted your request";

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "payment_invitation",
  );
}

/**
 * Sent to the client when their match changes BEFORE a first appointment is
 * scheduled: the assigned professional released the request (désistement) or an
 * admin reassigned it. Reassures the client that we're (re)connecting them with
 * a professional — no action required. Locale-aware; the caller resolves the
 * correct recipient (LSSSS art. 14) via resolveAppointmentRecipient, so this
 * works for self, loved-one and patient bookings alike.
 */
export async function sendMatchUpdatedEmail(data: {
  clientName: string;
  clientEmail: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";

  const html = buildEmailHtml({
    title:
      lang === "fr" ? "Mise à jour de votre jumelage" : "Update on your match",
    subtitle:
      lang === "fr"
        ? "Nous vous mettons en relation avec un professionnel"
        : "We're connecting you with a professional",
    theme: "info",
    badge: {
      text: lang === "fr" ? "🔄 Jumelage en cours" : "🔄 Re-matching",
      theme: "info",
    },
    greeting:
      lang === "fr" ? `Bonjour ${data.clientName},` : `Hello ${data.clientName},`,
    intro:
      lang === "fr"
        ? "Il y a eu un changement concernant votre jumelage. Pas d'inquiétude : notre équipe vous met en relation avec un professionnel adapté à vos besoins. Celui-ci communiquera avec vous pour convenir de la date de votre premier rendez-vous."
        : "There's been a change to your match. Don't worry — our team is connecting you with a professional suited to your needs. They will contact you to arrange the date of your first appointment.",
    outro:
      lang === "fr"
        ? "Aucune action n'est requise de votre part pour le moment. Merci de votre patience."
        : "Nothing is required from you for now. Thank you for your patience.",
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Mise à jour de votre jumelage",
          `Bonjour ${data.clientName},`,
          "Il y a eu un changement concernant votre jumelage. Notre équipe vous met en relation avec un professionnel adapté à vos besoins, qui communiquera avec vous pour fixer votre premier rendez-vous.",
          "Aucune action n'est requise de votre part pour le moment.",
        ]
      : [
          "Update on your match",
          `Hello ${data.clientName},`,
          "There's been a change to your match. Our team is connecting you with a professional suited to your needs, who will contact you to set your first appointment.",
          "Nothing is required from you for now.",
        ],
    lang,
  );

  const subject =
    lang === "fr"
      ? "Mise à jour de votre jumelage — Je chemine"
      : "Update on your match — Je chemine";

  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "service_request_onboarding",
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
  /**
   * Override the dashboard CTA URL. For unclaimed accounts the caller mints a
   * tokenized `/pay?token=…` via `resolveBillingUrl()`; active clients keep
   * the auth-gated dashboard deep-link. Falls back to the dashboard URL when
   * not provided (legacy callers).
   */
  billingUrl?: string;
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const billingUrl =
    data.billingUrl ??
    `${base}/client/dashboard/billing?action=addPaymentMethod`;

  const intro =
    lang === "fr"
      ? `Votre séance du ${data.appointmentDateLabel} a eu lieu, mais aucun mode de paiement n'a encore été configuré sur votre compte. Veuillez régulariser votre situation dès que possible.`
      : `Your session on ${data.appointmentDateLabel} has taken place, but no payment method has been set up on your account yet. Please settle this as soon as possible.`;

  // Admin-editable template; hardcoded block below is the fallback.
  const editable = await loadEditableTemplate("postMeetingPayment", lang, {
    clientName: data.clientName,
    appointmentDateLabel: data.appointmentDateLabel,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "danger",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: billingUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${billingUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.clientEmail, subject: editable.subject, html, text },
      "payment_invitation",
    );
  }

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
    lang,
  });

  const text = buildEmailText([
    lang === "fr" ? "Paiement en attente après votre séance" : "Payment pending after your session",
    lang === "fr" ? `Bonjour ${data.clientName},` : `Dear ${data.clientName},`,
    intro,
    lang === "fr" ? "Configurer votre paiement :" : "Set up your payment:",
    billingUrl,
  ], lang);

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
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/patients`;

  // Admin-editable template; the hardcoded block below is the fallback. Body is
  // French (admin alert).
  const editable = await loadEditableTemplate("adminNoPaymentBeforeMeeting", "fr", {
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    appointmentDateLabel: data.appointmentDateLabel,
    appointmentId: data.appointmentId,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "danger",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: adminUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "admin_interac_trust_request",
      ).catch((e) =>
        console.error("sendAdminNoPaymentBeforeMeetingAlert:", e),
      );
    }
    return;
  }

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
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const loginUrl = `${base}/login`;

  const titles = {
    fr: "Finalisez votre inscription",
    en: "Finalize your registration",
  };
  const greetings = {
    fr: `Bonjour ${data.name},`,
    en: `Hello ${data.name},`,
  };
  const intros = {
    fr: `Vous avez été invité à rejoindre ${branding?.companyName || "Je chemine"}. Veuillez vous connecter pour compléter votre profil et accéder à votre tableau de bord.`,
    en: `You have been invited to join ${branding?.companyName || "Je chemine"}. Please log in to complete your profile and access your dashboard.`,
  };
  const buttons = {
    fr: "Se connecter au site",
    en: "Log in to the site",
  };
  const outros = {
    fr: "Si vous avez des questions, n'hésitez pas à nous contacter.",
    en: "If you have any questions, feel free to contact us.",
  };

  const companyName = branding?.companyName || "Je chemine";

  const editable = await loadEditableTemplate("resendInvitation", lang, {
    name: data.name,
    companyName,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: loginUrl }
        : undefined,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${loginUrl}` : "",
      ],
      lang,
    );
    return sendEmail(
      { to: data.email, subject: editable.subject, html, text },
      "welcome",
    );
  }

  const html = buildEmailHtml({
    title: titles[lang],
    subtitle: branding?.companyName || "Je chemine",
    theme: "info",
    greeting: greetings[lang],
    intro: intros[lang],
    button: { text: buttons[lang], url: loginUrl },
    outro: outros[lang],
    branding,
    lang,
  });

  const text = buildEmailText([
    titles[lang],
    branding?.companyName || "Je chemine",
    greetings[lang],
    intros[lang],
    `${buttons[lang]}: ${loginUrl}`,
    outros[lang],
  ], lang);

  const subject =
    lang === "fr"
      ? `Invitation à rejoindre ${branding?.companyName || "Je chemine"}`
      : `Invitation to join ${branding?.companyName || "Je chemine"}`;

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
  isEmergency?: boolean;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/service-requests`;

  // Urgent requests get a louder email (warning theme + flagged subject/intro)
  // so admins triage them ahead of standard demandes.
  const isEmergency = Boolean(data.isEmergency);

  // Admin-editable template (subject/title/body/CTA); the hardcoded block below
  // is the fallback if the DB row can't be loaded. French-only admin alert.
  const editable = await loadEditableTemplate("adminNewServiceRequest", "fr", {
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    bookingFor: data.bookingFor,
    motifs: data.motifs.join(", ") || "—",
    appointmentId: data.appointmentId,
    isEmergency: isEmergency ? "1" : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: isEmergency ? "warning" : "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: adminUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "service_request_onboarding",
      ).catch((e) => console.error("sendAdminNewServiceRequestAlert:", e));
    }
    return;
  }

  const html = buildEmailHtml({
    title: isEmergency
      ? "⚠ Nouvelle demande URGENTE"
      : "Nouvelle demande de service",
    theme: isEmergency ? "warning" : "info",
    greeting: "Bonjour,",
    intro: isEmergency
      ? `⚠ Demande de rendez-vous D'URGENCE soumise par ${data.clientName} (${data.clientEmail}). À traiter en priorité.`
      : `Une nouvelle demande de service a été soumise par ${data.clientName} (${data.clientEmail}).`,
    details: [
      ...(isEmergency
        ? [{ label: "Priorité", value: "⚠ URGENCE" }]
        : []),
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
    isEmergency
      ? "Nouvelle demande de service — URGENCE"
      : "Nouvelle demande de service",
    ...(isEmergency ? ["Priorité : URGENCE — à traiter en priorité"] : []),
    `Client : ${data.clientName} — ${data.clientEmail}`,
    `Pour : ${data.bookingFor}`,
    `Motif(s) : ${data.motifs.join(", ") || "—"}`,
    `ID : ${data.appointmentId}`,
    adminUrl,
  ]);

  const subject = isEmergency
    ? `⚠ URGENCE — Nouvelle demande — ${data.clientName}`
    : `Nouvelle demande — ${data.clientName}`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) => console.error("sendAdminNewServiceRequestAlert:", e));
  }
}

/**
 * Alert admins when every proposed professional has refused an appointment
 * and the routing has cascaded to `routingStatus: "general"`. Without this
 * notification the request silently drops into the general queue with no
 * one watching — admins miss the chance to intervene (manually assign a
 * specific pro, escalate, or contact the client).
 */
export async function sendAdminAppointmentMovedToGeneralAlert(data: {
  clientName: string;
  clientEmail: string;
  motif?: string;
  appointmentId: string;
  refusalCount: number;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/service-requests`;

  // Admin-editable template (subject/title/subtitle/body/CTA); the hardcoded
  // block below is the fallback if the DB row can't be loaded. Body is French.
  const editable = await loadEditableTemplate(
    "adminAppointmentMovedToGeneral",
    "fr",
    {
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      motif: data.motif || "—",
      refusalCount: String(data.refusalCount),
      appointmentId: data.appointmentId,
    },
  );
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: adminUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "service_request_onboarding",
      ).catch((e) =>
        console.error("sendAdminAppointmentMovedToGeneralAlert:", e),
      );
    }
    return;
  }

  const html = buildEmailHtml({
    title: "Demande basculée en liste générale",
    theme: "warning",
    greeting: "Bonjour,",
    intro: `La demande de ${data.clientName} a été refusée par tous les professionnels proposés (${data.refusalCount}). Elle est maintenant visible dans la liste générale, accessible à tous les pros — mais elle peut rester sans suite si personne ne la prend.`,
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Motif", value: data.motif || "—" },
      { label: "Refus reçus", value: String(data.refusalCount) },
      { label: "ID Rendez-vous", value: data.appointmentId },
    ],
    button: { text: "Assigner manuellement", url: adminUrl },
    outro:
      "Vous pouvez assigner manuellement un professionnel depuis le tableau des demandes, ou contacter le client pour ajuster sa demande.",
    branding,
  });

  const text = buildEmailText([
    "Demande basculée en liste générale",
    `Client : ${data.clientName} — ${data.clientEmail}`,
    `Motif : ${data.motif || "—"}`,
    `Refus reçus : ${data.refusalCount}`,
    `ID : ${data.appointmentId}`,
    adminUrl,
  ]);

  const subject = `Liste générale — refus en cascade pour ${data.clientName}`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) =>
      console.error("sendAdminAppointmentMovedToGeneralAlert:", e),
    );
  }
}

/**
 * §3.2: a jumelage attempt that ERRORS out (a technical failure in the matcher,
 * as opposed to simply finding no eligible professional) must alert the admin so
 * they can verify the dossier — otherwise the request sits "pending" with no
 * proposal and no signal. French (admin-facing). Reuses the admin-alert
 * recipients + the service_request_onboarding category for logging.
 */
export async function sendAdminJumelageProblemAlert(data: {
  clientName: string;
  clientEmail: string;
  appointmentId: string;
  reason: string;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/service-requests`;

  const html = buildEmailHtml({
    title: "Problème de jumelage — vérification requise",
    theme: "warning",
    greeting: "Bonjour,",
    intro: `Une tentative de jumelage automatique pour la demande de ${data.clientName} a échoué en raison d'un problème technique. La demande reste « en attente » dans « Demandes de service » et n'a été proposée à aucun professionnel — un suivi humain est requis.`,
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Problème", value: data.reason },
      { label: "ID Rendez-vous", value: data.appointmentId },
    ],
    button: { text: "Ouvrir la demande", url: adminUrl },
    outro:
      "Vérifiez la demande (données manquantes ou incohérentes), puis relancez le « Jumelage automatique » ou assignez un professionnel manuellement.",
    branding,
  });

  const text = buildEmailText([
    "Problème de jumelage — vérification requise",
    `Client : ${data.clientName} — ${data.clientEmail}`,
    `Problème : ${data.reason}`,
    `ID : ${data.appointmentId}`,
    adminUrl,
  ]);

  const subject = `Problème de jumelage — ${data.clientName} (vérification requise)`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) => console.error("sendAdminJumelageProblemAlert:", e));
  }
}

/**
 * Sent when the auto-match cascade is exhausted (2 failed attempts — by refusal
 * or 48h no-response) or no eligible professional exists, so the dossier is
 * RETURNED to the admin "Demande de service" queue for a MANUAL decision (assign
 * a specific pro, or send it to the general pool). Unlike the moved-to-general
 * alert, the request is NOT yet visible to professionals — it waits for the admin.
 */
export async function sendAdminRequestReturnedToQueueAlert(data: {
  clientName: string;
  clientEmail: string;
  motif?: string;
  appointmentId: string;
  attempts: number;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/service-requests`;

  // Admin-editable template (subject/title/subtitle/body/CTA); the hardcoded
  // block below is the fallback if the DB row can't be loaded. Body is French.
  const editable = await loadEditableTemplate("adminRequestReturnedToQueue", "fr", {
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    motif: data.motif || "—",
    attempts: String(data.attempts),
    appointmentId: data.appointmentId,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: adminUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "service_request_onboarding",
      ).catch((e) =>
        console.error("sendAdminRequestReturnedToQueueAlert:", e),
      );
    }
    return;
  }

  const html = buildEmailHtml({
    title: "Demande à jumeler manuellement",
    theme: "warning",
    greeting: "Bonjour,",
    intro: `La demande de ${data.clientName} n'a pas pu être jumelée automatiquement (${data.attempts} tentative(s) échouée(s) — refus ou délai de 48 h dépassé). Elle est de retour dans « Demande de service » et attend une décision manuelle : assigner un professionnel ou l'envoyer à la liste générale.`,
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Motif", value: data.motif || "—" },
      { label: "Tentatives", value: String(data.attempts) },
      { label: "ID Rendez-vous", value: data.appointmentId },
    ],
    button: { text: "Traiter la demande", url: adminUrl },
    outro:
      "Tant qu'aucune action manuelle n'est prise, cette demande n'est PAS visible des professionnels.",
    branding,
  });

  const text = buildEmailText([
    "Demande à jumeler manuellement",
    `Client : ${data.clientName} — ${data.clientEmail}`,
    `Motif : ${data.motif || "—"}`,
    `Tentatives échouées : ${data.attempts}`,
    `ID : ${data.appointmentId}`,
    adminUrl,
  ]);

  const subject = `À jumeler manuellement — ${data.clientName}`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) =>
      console.error("sendAdminRequestReturnedToQueueAlert:", e),
    );
  }
}

/**
 * §3.2: notify the admin team by email when a new external message (contact /
 * school-manager / enterprise form) is submitted, so a submission isn't missed
 * if nobody is watching the in-app inbox. Routes through getAdminAlertRecipients
 * so the admin-configurable `adminAlertEmail` governs it like every other alert.
 */
export async function sendAdminNewExternalMessageAlert(data: {
  source: string;
  senderName: string;
  senderEmail: string;
  senderPhone?: string;
  subject?: string;
  message: string;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/external-messages`;

  const sourceLabel =
    data.source === "enterprise"
      ? "Entreprise"
      : data.source === "school-manager"
        ? "Établissement scolaire"
        : "Contact";
  const preview =
    data.message.length > 600 ? `${data.message.slice(0, 600)}…` : data.message;

  // Admin-editable template (subject/title/subtitle/body/CTA); the hardcoded
  // block below is the fallback if the DB row can't be loaded. French-only.
  const editable = await loadEditableTemplate("adminNewExternalMessage", "fr", {
    sourceLabel,
    senderName: data.senderName,
    senderEmail: data.senderEmail,
    senderPhone: data.senderPhone ?? "",
    messageSubject: data.subject ?? "",
    preview,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: adminUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "service_request_onboarding",
      ).catch((e) =>
        console.error("sendAdminNewExternalMessageAlert:", e),
      );
    }
    return;
  }

  const html = buildEmailHtml({
    title: "Nouveau message de contact",
    theme: "info",
    greeting: "Bonjour,",
    intro: `Un nouveau message (${sourceLabel}) a été reçu de ${data.senderName} (${data.senderEmail}).`,
    details: [
      { label: "Source", value: sourceLabel },
      { label: "Nom", value: data.senderName },
      { label: "Courriel", value: data.senderEmail },
      ...(data.senderPhone
        ? [{ label: "Téléphone", value: data.senderPhone }]
        : []),
      ...(data.subject ? [{ label: "Sujet", value: data.subject }] : []),
      { label: "Message", value: preview },
    ],
    button: { text: "Voir les messages", url: adminUrl },
    branding,
  });

  const text = buildEmailText([
    "Nouveau message de contact",
    `Source : ${sourceLabel}`,
    `De : ${data.senderName} — ${data.senderEmail}`,
    ...(data.senderPhone ? [`Téléphone : ${data.senderPhone}`] : []),
    ...(data.subject ? [`Sujet : ${data.subject}`] : []),
    "",
    preview,
    "",
    adminUrl,
  ]);

  const subject = `Nouveau message — ${sourceLabel} — ${data.senderName}`;

  for (const to of adminEmails) {
    await sendEmail({ to, subject, html, text }, "service_request_onboarding").catch(
      (e) => console.error("sendAdminNewExternalMessageAlert:", e),
    );
  }
}

/**
 * Droit à l'oubli : alerte l'équipe admin quand un utilisateur (client ou
 * professionnel) soumet, depuis ses paramètres, une demande de DÉSACTIVATION
 * ou de SUPPRESSION DÉFINITIVE de son compte. Routé par getAdminAlertRecipients
 * (adminAlertEmail configurable) comme toutes les autres alertes admin. Le CTA
 * pointe vers la fiche du compte concerné (réactivation côté admin, ou
 * traitement de la demande de suppression).
 */
export async function sendAdminAccountActionAlert(data: {
  kind: "deactivation" | "deletion_request";
  userName: string;
  userEmail: string;
  userRole: string;
  userId: string;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) {
    console.warn(
      "[admin_account_action] No admin emails — set ADMIN_ALERT_EMAIL or admin users.",
    );
    return;
  }

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const detailSegment =
    data.userRole === "professional" ? "professionals" : "patients";
  const adminUrl = `${base}/admin/dashboard/${detailSegment}/${data.userId}`;

  const isDeletion = data.kind === "deletion_request";
  const requestLabel = isDeletion
    ? "Suppression définitive"
    : "Désactivation";

  const intro = isDeletion
    ? `${data.userName} (${data.userEmail}) a demandé la SUPPRESSION DÉFINITIVE de son compte depuis ses paramètres. Les factures et données financières doivent être conservées de façon sécurisée conformément aux obligations légales; les autres données personnelles doivent être effacées après traitement.`
    : `${data.userName} (${data.userEmail}) a DÉSACTIVÉ son compte depuis ses paramètres. L'accès est bloqué et les données sont conservées; le compte peut être réactivé par un administrateur.`;

  const html = buildEmailHtml({
    title: isDeletion
      ? "⚠ Demande de suppression définitive de compte"
      : "Désactivation de compte",
    theme: isDeletion ? "warning" : "info",
    greeting: "Bonjour,",
    intro,
    details: [
      { label: "Utilisateur", value: data.userName },
      { label: "Courriel", value: data.userEmail },
      { label: "Rôle", value: data.userRole },
      { label: "Type de demande", value: requestLabel },
    ],
    button: { text: "Voir le compte", url: adminUrl },
    branding,
  });

  const text = buildEmailText([
    isDeletion
      ? "Demande de suppression définitive de compte"
      : "Désactivation de compte",
    intro,
    `Utilisateur : ${data.userName} — ${data.userEmail}`,
    `Rôle : ${data.userRole}`,
    `Type de demande : ${requestLabel}`,
    adminUrl,
  ]);

  const subject = isDeletion
    ? `⚠ Suppression définitive demandée — ${data.userName}`
    : `Désactivation de compte — ${data.userName}`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) => console.error("sendAdminAccountActionAlert:", e));
  }
}

/**
 * Escalade admin : un professionnel a accepté un client (jumelé) mais n'a
 * toujours pas confirmé la date du 1er rendez-vous après le délai de relance.
 * L'admin peut relancer le pro ou réassigner la demande.
 */
export async function sendAdminUnscheduledMatchEscalation(data: {
  clientName: string;
  clientEmail: string;
  professionalName: string;
  motif?: string;
  appointmentId: string;
  daysWaiting: number;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/service-requests`;

  // Admin-editable template; the hardcoded block below is the fallback if the
  // DB row can't be loaded. French-only admin alert.
  const editable = await loadEditableTemplate("adminUnscheduledMatchEscalation", "fr", {
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    professionalName: data.professionalName,
    motif: data.motif || "—",
    daysWaiting: String(data.daysWaiting),
    appointmentId: data.appointmentId,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: adminUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "service_request_onboarding",
      ).catch((e) =>
        console.error("sendAdminUnscheduledMatchEscalation:", e),
      );
    }
    return;
  }

  const html = buildEmailHtml({
    title: "Jumelage sans 1er rendez-vous",
    theme: "warning",
    greeting: "Bonjour,",
    intro: `Le professionnel ${data.professionalName} a accepté la demande de ${data.clientName} il y a ${data.daysWaiting} jour(s), mais n'a toujours pas confirmé la date du premier rendez-vous. Le client attend — une relance du pro ou une réassignation peut être nécessaire.`,
    details: [
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Professionnel", value: data.professionalName },
      { label: "Motif", value: data.motif || "—" },
      { label: "Jours d'attente", value: String(data.daysWaiting) },
      { label: "ID Rendez-vous", value: data.appointmentId },
    ],
    button: { text: "Voir la demande", url: adminUrl },
    outro:
      "Vous pouvez relancer le professionnel, ou réassigner la demande à un autre professionnel depuis le tableau des demandes.",
    branding,
  });

  const text = buildEmailText([
    "Jumelage sans 1er rendez-vous",
    `Professionnel : ${data.professionalName}`,
    `Client : ${data.clientName} — ${data.clientEmail}`,
    `Motif : ${data.motif || "—"}`,
    `Jours d'attente : ${data.daysWaiting}`,
    `ID : ${data.appointmentId}`,
    adminUrl,
  ]);

  const subject = `Jumelage en attente de planification — ${data.clientName} (${data.daysWaiting} j)`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) =>
      console.error("sendAdminUnscheduledMatchEscalation:", e),
    );
  }
}

/**
 * Soft-SLA reminder to the PROFESSIONAL for an URGENT "Consultation ponctuelle
 * rapide" request whose response deadline has lapsed. Two stages:
 *   - "accept":     offered but not accepted within 12h (commitment: accept ≤12h).
 *   - "takeCharge": accepted but 1st RDV not confirmed within 12h (commitment:
 *                   take charge ≤12h).
 * Soft enforcement: the request stays assigned — this is a nudge, not a re-route.
 */
export async function sendEmergencyProSlaAlert(data: {
  stage: "accept" | "takeCharge";
  professionalName: string;
  professionalEmail: string;
  clientName: string;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "fr" ? "fr" : "en";
  const dashboardUrl = `${process.env.NEXTAUTH_URL}/professional/dashboard/proposals`;
  const name =
    data.professionalName?.trim() ||
    (lang === "fr" ? "cher professionnel" : "there");
  const clientName =
    data.clientName?.trim() || (lang === "fr" ? "un client" : "a client");
  const isAccept = data.stage === "accept";

  const title = isAccept
    ? lang === "fr"
      ? "Demande urgente en attente de votre réponse"
      : "Urgent request awaiting your response"
    : lang === "fr"
      ? "Consultation rapide à planifier"
      : "Quick consultation to schedule";
  const intro = isAccept
    ? lang === "fr"
      ? `Une consultation ponctuelle rapide (urgente) de ${clientName} vous a été proposée et attend toujours votre réponse. L'engagement pour ces demandes est de les accepter dans un délai de 12 heures. Merci de l'accepter ou de la refuser dès que possible depuis vos propositions.`
      : `An urgent quick consultation from ${clientName} was proposed to you and is still awaiting your response. The commitment for these requests is to accept within 12 hours. Please accept or decline it as soon as possible from your proposals.`
    : lang === "fr"
      ? `Vous avez accepté une consultation ponctuelle rapide (urgente) de ${clientName}, mais le 1er rendez-vous n'est pas encore confirmé. L'engagement pour ces demandes est de prendre en charge le dossier dans un délai de 12 heures. Merci de confirmer la date depuis l'onglet « À planifier ».`
      : `You accepted an urgent quick consultation from ${clientName}, but the 1st appointment isn't confirmed yet. The commitment for these requests is to take charge within 12 hours. Please confirm the date from the "To Schedule" tab.`;
  const buttonText = isAccept
    ? lang === "fr"
      ? "Voir la demande"
      : "View the request"
    : lang === "fr"
      ? "Confirmer le 1er RDV"
      : "Confirm the 1st appointment";

  const editable = await loadEditableTemplate("emergencyProSla", lang, {
    name,
    clientName,
    isAccept: isAccept ? "true" : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
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
      { to: data.professionalEmail, subject: editable.subject, html, text },
      "appointment_professional_notification",
    );
  }

  const html = buildEmailHtml({
    title,
    theme: "warning",
    badge: {
      text: lang === "fr" ? "⚠ Urgence" : "⚠ Urgent",
      theme: "warning",
    },
    greeting: lang === "fr" ? `Bonjour ${name},` : `Hello ${name},`,
    intro,
    button: { text: buttonText, url: dashboardUrl },
    branding,
    lang,
  });

  const text = buildEmailText(
    [
      title,
      lang === "fr" ? `Bonjour ${name},` : `Hello ${name},`,
      intro,
      `${buttonText} : ${dashboardUrl}`,
    ],
    lang,
  );

  const subject = await getSubject(
    "appointment_professional_notification",
    isAccept
      ? lang === "fr"
        ? "⚠ Urgence — demande à accepter (12 h)"
        : "⚠ Urgent — request to accept (12h)"
      : lang === "fr"
        ? "⚠ Urgence — 1er RDV à confirmer (12 h)"
        : "⚠ Urgent — 1st appointment to confirm (12h)",
  );

  return sendEmail(
    { to: data.professionalEmail, subject, html, text },
    "appointment_professional_notification",
  );
}

/**
 * Alert admins that an URGENT "Consultation ponctuelle rapide" SLA deadline was
 * missed (the pro was already nudged via sendEmergencyProSlaAlert). The request
 * stays assigned; admins decide whether to reassign quickly. Stage mirrors the
 * pro alert ("accept" = 12h to accept, "takeCharge" = 12h to confirm 1st RDV).
 */
export async function sendAdminEmergencySlaBreachAlert(data: {
  stage: "accept" | "takeCharge";
  clientName: string;
  clientEmail: string;
  professionalName: string;
  motif?: string;
  appointmentId: string;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return;

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/service-requests`;
  const isAccept = data.stage === "accept";
  const stageLabel = isAccept ? "Acceptation (12 h)" : "Prise en charge (12 h)";
  const proName = data.professionalName?.trim() || "—";

  // Admin-editable template (subject/title/body/CTA); the hardcoded block below
  // is the fallback if the DB row can't be loaded. French-only admin alert.
  const editable = await loadEditableTemplate("adminEmergencySlaBreach", "fr", {
    stageLabel,
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    proName,
    proNamePresent: proName !== "—" ? "1" : "",
    motif: data.motif || "—",
    appointmentId: data.appointmentId,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: adminUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "service_request_onboarding",
      ).catch((e) => console.error("sendAdminEmergencySlaBreachAlert:", e));
    }
    return;
  }

  const html = buildEmailHtml({
    title: "⚠ Délai dépassé — consultation ponctuelle rapide",
    theme: "warning",
    greeting: "Bonjour,",
    intro: `Le délai de « ${stageLabel} » d'une consultation ponctuelle rapide (urgente) de ${data.clientName} est dépassé${proName !== "—" ? ` (professionnel : ${proName})` : ""}. Le professionnel a été relancé — une réassignation rapide peut être nécessaire.`,
    details: [
      { label: "Priorité", value: "⚠ URGENCE" },
      { label: "Étape", value: stageLabel },
      { label: "Client", value: data.clientName },
      { label: "Courriel", value: data.clientEmail },
      { label: "Professionnel", value: proName },
      { label: "Motif", value: data.motif || "—" },
      { label: "ID Rendez-vous", value: data.appointmentId },
    ],
    button: { text: "Voir les demandes", url: adminUrl },
    outro:
      "Vous pouvez réassigner la demande depuis le tableau des demandes de service.",
    branding,
  });

  const text = buildEmailText([
    "Délai dépassé — consultation ponctuelle rapide (URGENCE)",
    `Étape : ${stageLabel}`,
    `Client : ${data.clientName} — ${data.clientEmail}`,
    `Professionnel : ${proName}`,
    `Motif : ${data.motif || "—"}`,
    `ID : ${data.appointmentId}`,
    adminUrl,
  ]);

  const subject = `⚠ URGENCE — délai ${isAccept ? "acceptation" : "prise en charge"} dépassé — ${data.clientName}`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) => console.error("sendAdminEmergencySlaBreachAlert:", e));
  }
}

/**
 * Alert admins when a new professional has submitted a signup application.
 * Admins can then validate / activate from /admin/dashboard/professionals.
 */
export async function sendAdminNewProfessionalSignupAlert(data: {
  professionalName: string;
  professionalEmail: string;
  professionalId: string;
  phone?: string;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) {
    console.warn("[sendAdminNewProfessionalSignupAlert] no admin recipients");
    return;
  }

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/professionals/${data.professionalId}`;

  const details: Array<{ label: string; value: string }> = [
    { label: "Nom", value: data.professionalName },
    { label: "Courriel", value: data.professionalEmail },
  ];
  if (data.phone) details.push({ label: "Téléphone", value: data.phone });

  // Admin-editable template (subject/title/body/CTA); the hardcoded block below
  // is the fallback if the DB row can't be loaded. French-only admin alert.
  const editable = await loadEditableTemplate("adminNewProfessionalSignup", "fr", {
    professionalName: data.professionalName,
    professionalEmail: data.professionalEmail,
    phone: data.phone || "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "info",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: adminUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "service_request_onboarding",
      ).catch((e) =>
        console.error("sendAdminNewProfessionalSignupAlert:", e),
      );
    }
    return;
  }

  const html = buildEmailHtml({
    title: "Nouvelle inscription professionnel(le)",
    theme: "info",
    greeting: "Bonjour,",
    intro: `Un(e) professionnel(le) vient de s'inscrire sur la plateforme et attend la validation de l'admin pour activer son compte.`,
    details,
    button: { text: "Examiner le dossier", url: adminUrl },
    outro:
      "Vous pouvez choisir d'envoyer le courriel d'activation 2FA ou d'activer le compte manuellement.",
    branding,
  });

  const text = buildEmailText([
    "Nouvelle inscription professionnel(le)",
    `Nom : ${data.professionalName}`,
    `Courriel : ${data.professionalEmail}`,
    data.phone ? `Téléphone : ${data.phone}` : "",
    `Examiner : ${adminUrl}`,
  ]);

  const subject = `Nouveau professionnel — ${data.professionalName}`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "service_request_onboarding",
    ).catch((e) =>
      console.error("sendAdminNewProfessionalSignupAlert:", e),
    );
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

  // Admin-editable template (subject/title/body/CTA); the hardcoded block below
  // is the fallback if the DB row can't be loaded. Body is French.
  const editable = await loadEditableTemplate("appointmentTaken", "fr", {
    professionalName: data.professionalName,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "warning",
      greeting: "",
      intro: editable.bodyHtml,
      button: editable.ctaText
        ? { text: editable.ctaText, url: dashboardUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${dashboardUrl}` : "",
      ],
      "fr",
    );
    return sendEmail(
      { to: data.professionalEmail, subject: editable.subject, html, text },
      "appointment_professional_notification",
    );
  }

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

  const subject = "Demande attribuée à un autre professionnel — Je chemine";

  return sendEmail(
    { to: data.professionalEmail, subject, html, text },
    "appointment_professional_notification",
  );
}


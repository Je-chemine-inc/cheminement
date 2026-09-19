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
import { escapeHtml } from "@/lib/legal-sections";
import { buildReceiptNumber } from "@/lib/receipt-number";
import { resolveProfessionalNotifeeParty } from "@/lib/guardian-utils";
import {
  formatCanadianPhone,
  formatStandardAddressBlock,
} from "@/lib/format-platform-contact";
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
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import { organizationFormFileName } from "@/lib/organization-invoice-form";
import type { ShowcaseEditableField } from "@/lib/showcase-workflow";

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
  /**
   * True when the request is a "Consultation ponctuelle rapide" (emergency).
   * The professional notification then flags it loudly and states the 12 h
   * response window (the take-charge SLA for urgent requests).
   */
  isEmergency?: boolean;
  /**
   * For loved-one ("proche") bookings: who the pro will actually treat. The
   * professional notification names the LOVED ONE (not the requester) and uses
   * the LSSSS-correct contact. clientName/clientEmail above stay the requester's.
   */
  bookingFor?: "self" | "patient" | "loved-one" | string;
  lovedOneInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    dateOfBirth?: Date | string;
  } | null;
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
  // Bulletproof banner. The SOLID fill must survive EVERY client: Yahoo, Outlook
  // web and mobile Gmail silently drop CSS gradients, and Outlook *desktop* (the
  // Word rendering engine) additionally ignores `background-color` on a <div> —
  // only `bgcolor` on a <td> is honored there. Without this the white
  // title/subtitle rendered white-on-white (invisible), which is exactly what
  // surfaced in Yahoo. So we render the banner as a <table>/<td> carrying BOTH
  // `bgcolor` and an inline `background-color`; the gradient stays as a
  // progressive enhancement via `background-image` (kept separate so it doesn't
  // reset the solid fill). class="header" preserves the responsive @media rules.
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%;">
      <tr>
        <td class="header" align="center" bgcolor="${colors.primary}" style="background-color: ${colors.primary}; background-image: linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%); color: #ffffff; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
          ${branding?.logoUrl ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="max-height: 40px; margin-bottom: 15px;">` : ""}
          <h1 style="margin: 0; font-weight: 300; font-size: 28px; color: #ffffff;">${title}</h1>
          ${subtitle ? `<p style="margin: 10px 0 0; opacity: 0.9; font-size: 16px; color: #ffffff;">${subtitle}</p>` : ""}
        </td>
      </tr>
    </table>
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
  // Bulletproof price card (mirrors createHeader). The amount + note are white,
  // so the colored fill MUST survive every client or it renders white-on-white —
  // and this block carries the dollar amount on money emails (payment invitation,
  // receipts), so an invisible fill hides the single most important line.
  // Outlook desktop's Word engine drops background/background-color on a <div>
  // (only `bgcolor` on a <td> is honored), so render as a <table>/<td bgcolor>
  // with explicit #ffffff on the inner text. `opacity` is dropped (Word ignores
  // it) — full white reads fine on the colored fill.
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; margin: 20px 0;">
      <tr>
        <td align="center" bgcolor="${colors.primary}" style="background-color: ${colors.primary}; color: #ffffff; padding: 15px 20px; border-radius: 8px; text-align: center;">
          <div style="font-size: 24px; font-weight: 600; color: #ffffff;">$${amount.toFixed(2)} ${currency}</div>
          <div style="font-size: 12px; color: #ffffff; margin-top: 5px;">${note}</div>
        </td>
      </tr>
    </table>
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
    <div style="background: ${colors.bg}; border: 1px solid ${colors.primary}; padding: 15px 20px; border-radius: 8px; margin: 20px 0;">
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
  // Platform coordonnées (admin-configured, merged onto branding by getBranding):
  // the real postal address, phone and contact email, shown on every email.
  const addressLines = branding?.contactAddressLines ?? [];
  const contactBits = [
    branding?.contactPhone,
    branding?.contactEmail,
  ].filter((s): s is string => Boolean(s && s.trim()));
  // Plain "·" separator (NOT the footer-sep span, which the mobile @media rule
  // hides for the stacked link row — that would merge phone and email on phones).
  const coordonnees =
    addressLines.length > 0 || contactBits.length > 0
      ? `<p style="margin: 0 0 12px; color: #6b6b6b;">${[
          ...addressLines,
          contactBits.join(" &middot; "),
        ]
          .filter(Boolean)
          .join("<br>")}</p>`
      : "";
  return `
    <div class="footer">
      <p style="margin: 0 0 6px;">${footerText}</p>
      <p style="margin: 0 0 12px;">&copy; ${year} ${companyName}. ${allRights}</p>
      ${coordonnees}
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

/**
 * Payment-category emails reply to the dedicated payment inbox (paiement@…, the
 * Interac deposit address) instead of support@, so client payment questions land
 * with whoever handles money — not the general support queue.
 */
const PAYMENT_EMAIL_TYPES = new Set<EmailNotificationType>([
  "interac_transfer_instructions",
  "interac_payment_reminder",
  "payment_invitation",
  "payment_failed",
  "payment_refund",
  "fiscal_receipt",
  "guest_payment_confirmation",
  "guest_payment_complete",
  "resource_purchase_complete",
  "payment_guarantee_day1_reminder",
  "payment_guarantee_day2_reminder",
  "payment_guarantee_48h_client",
  // Spec 002: questions about who pays a session go to whoever handles money.
  "client_coverage_confirmed",
  "client_coverage_cap_warning",
  "client_coverage_exhausted",
  // An organization's accounts-payable replies about an invoice go there too.
  "organization_invoice",
  "organization_statement",
  "organization_payment_reminder",
  "organization_payment_received",
  "organization_refund",
  "organization_debit_failed",
]);

/** True when replies to this email type should route to the payment inbox. */
export function isPaymentEmailType(t: EmailNotificationType): boolean {
  return PAYMENT_EMAIL_TYPES.has(t);
}

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

    // Payment emails: send replies to the dedicated payment inbox; all other
    // emails keep the default (replies fall back to the From/support address).
    const replyTo = isPaymentEmailType(emailType)
      ? await getInteracDepositEmail()
      : undefined;

    const result = await transportSendMail({
      from: resolveFromAddress(
        undefined,
        settings.branding?.companyName ?? undefined,
      ),
      to: data.to,
      replyTo,
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

// Helper to get branding. Also merges the platform's coordonnées (phone, email,
// address from PlatformSettings.platformContact) onto the branding object so the
// shared email footer shows them on every email — no per-email-function change.
async function getBranding(): Promise<IEmailBranding | undefined> {
  try {
    await connectToDatabase();
    const settings = await PlatformSettings.findOne().lean();
    const branding = settings?.emailSettings?.branding;
    if (!branding) return undefined;
    const pc = settings?.platformContact;
    // Only surface the address once a REAL street/city/postal code is set. The
    // schema seeds country:"Canada" by default, which alone would otherwise
    // render a lone "Canada" line in every email footer until an admin fills in
    // a proper address.
    const addr = pc?.physicalAddress;
    const hasRealAddress = Boolean(
      addr &&
        (addr.street?.trim() || addr.city?.trim() || addr.postalCode?.trim()),
    );
    return {
      ...branding,
      contactPhone: pc?.phoneNumber ? formatCanadianPhone(pc.phoneNumber) : undefined,
      contactEmail: pc?.supportEmail?.trim() || undefined,
      contactAddressLines: hasRealAddress
        ? formatStandardAddressBlock(addr, undefined)
        : undefined,
    };
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
// Public Email Functions - Premium resources
// =============================================================================

/**
 * Confirms a premium-resource purchase and delivers the access link.
 *
 * For a GUEST this email is the only durable way back to what they bought —
 * the link carries their bearer token. Never drop the button.
 *
 * `lang` comes from the entitlement row (the language they bought in), never
 * inferred at send time.
 */
/**
 * The TPS and TVQ lines of a resource receipt, with the registration numbers;
 * empty when no tax was added at checkout.
 */
function resourceReceiptTaxRows(
  taxes: {
    subtotalCents: number;
    tpsCents: number;
    tvqCents: number;
    tpsRatePercent: number;
    tvqRatePercent: number;
    tpsNumber: string;
    tvqNumber: string;
  } | null | undefined,
  lang: "fr" | "en",
): { label: string; value: string }[] {
  if (!taxes) return [];
  const rate = (value: number) =>
    value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA", { maximumFractionDigits: 3 });
  // The total is already the email's "amount paid"; these lines say what it is made of.
  return lang === "fr"
    ? [
        { label: "Prix", value: formatCents(taxes.subtotalCents, lang) },
        { label: `TPS (${rate(taxes.tpsRatePercent)} %) — n° ${taxes.tpsNumber}`, value: formatCents(taxes.tpsCents, lang) },
        { label: `TVQ (${rate(taxes.tvqRatePercent)} %) — n° ${taxes.tvqNumber}`, value: formatCents(taxes.tvqCents, lang) },
      ]
    : [
        { label: "Price", value: formatCents(taxes.subtotalCents, lang) },
        { label: `GST (${rate(taxes.tpsRatePercent)}%) — No. ${taxes.tpsNumber}`, value: formatCents(taxes.tpsCents, lang) },
        { label: `QST (${rate(taxes.tvqRatePercent)}%) — No. ${taxes.tvqNumber}`, value: formatCents(taxes.tvqCents, lang) },
      ];
}

export async function sendResourcePurchaseComplete(data: {
  buyerEmail: string;
  buyerName?: string;
  resourceTitle: string;
  /** What was charged: the price plus TPS and TVQ when they were added. */
  amountCents: number;
  accessUrl: string;
  locale: "fr" | "en";
  /** TPS and TVQ added at checkout, with the registration numbers a receipt must show. */
  taxes?: {
    subtotalCents: number;
    tpsCents: number;
    tvqCents: number;
    tpsRatePercent: number;
    tvqRatePercent: number;
    tpsNumber: string;
    tvqNumber: string;
  } | null;
}): Promise<boolean> {
  const branding = await getBranding();
  const currency = await getCurrency();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const buyerName = data.buyerName?.trim() || (lang === "fr" ? "bonjour" : "there");
  const price = (data.amountCents / 100).toFixed(2);
  // The receipt lines for TPS and TVQ, shown whatever the editable template says.
  const taxRows = resourceReceiptTaxRows(data.taxes, lang);

  const editable = await loadEditableTemplate("resourcePurchaseComplete", lang, {
    buyerName,
    resourceTitle: data.resourceTitle,
    price,
    currency,
    accessUrl: data.accessUrl,
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: editable.subtitle,
      theme: "success",
      greeting: "",
      intro: editable.bodyHtml,
      ...(taxRows.length ? { details: taxRows, detailsBorderColor: "#22c55e" } : {}),
      button: { text: editable.ctaText || (lang === "fr" ? "Lire la ressource" : "Read the resource"), url: data.accessUrl },
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/s+/g, " ").trim(),
        ...taxRows.map((row) => (lang === "fr" ? `${row.label} : ${row.value}` : `${row.label}: ${row.value}`)),
        `${data.resourceTitle} : ${data.accessUrl}`,
      ],
      lang,
    );
    return sendEmail(
      { to: data.buyerEmail, subject: editable.subject, html, text },
      "resource_purchase_complete",
    );
  }

  const html = buildEmailHtml({
    title: lang === "fr" ? "Votre ressource est débloquée" : "Your resource is unlocked",
    subtitle: lang === "fr" ? "Merci pour votre achat" : "Thank you for your purchase",
    theme: "success",
    greeting: lang === "fr" ? `Bonjour ${buyerName},` : `Hello ${buyerName},`,
    intro:
      lang === "fr"
        ? `Merci ! Votre paiement a été traité et « ${data.resourceTitle} » vous est maintenant accessible.`
        : `Thank you! Your payment went through and “${data.resourceTitle}” is now yours to read.`,
    details: [
      {
        label: lang === "fr" ? "Ressource" : "Resource",
        value: data.resourceTitle,
      },
      ...taxRows,
    ],
    detailsBorderColor: "#22c55e",
    price: {
      amount: data.amountCents / 100,
      note: lang === "fr" ? "Paiement reçu — Merci !" : "Payment received — Thank you!",
      theme: "success",
      currency,
    },
    button: {
      text: lang === "fr" ? "Lire la ressource" : "Read the resource",
      url: data.accessUrl,
    },
    infoBox: {
      title: lang === "fr" ? "Conservez ce courriel" : "Keep this email",
      content:
        lang === "fr"
          ? "Le lien ci-dessus est personnel et vous redonne accès à la ressource à tout moment, sur n'importe quel appareil. Si vous avez un compte Je chemine, connectez-vous avec la même adresse courriel et la ressource apparaîtra dans votre bibliothèque."
          : "The link above is personal and lets you back into the resource at any time, on any device. If you have a Je chemine account, sign in with the same email address and the resource will appear in your library.",
    },
    branding,
    lang,
  });

  const text = buildEmailText(
    lang === "fr"
      ? [
          "Votre ressource est débloquée",
          `Bonjour ${buyerName},`,
          `Ressource : ${data.resourceTitle}`,
          ...taxRows.map((row) => `${row.label} : ${row.value}`),
          `Montant payé : ${price} $ ${currency}`,
          `Lien d'accès : ${data.accessUrl}`,
          "Conservez ce courriel : ce lien est personnel.",
        ]
      : [
          "Your resource is unlocked",
          `Hello ${buyerName},`,
          `Resource: ${data.resourceTitle}`,
          ...taxRows.map((row) => `${row.label}: ${row.value}`),
          `Amount paid: ${currency} ${price}`,
          `Access link: ${data.accessUrl}`,
          "Keep this email: the link is personal.",
        ],
    lang,
  );

  const subject = await getSubject(
    "resource_purchase_complete",
    lang === "fr"
      ? "Votre ressource est débloquée — Je chemine"
      : "Your resource is unlocked — Je chemine",
  );

  return sendEmail(
    { to: data.buyerEmail, subject, html, text },
    "resource_purchase_complete",
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

  // Primary CTA → the payment-method choice (paymentUrl deep-links straight to
  // "add a payment method"). Hardcoded so the label always names the payment
  // step (not the vaguer "Ouvrir la facturation") and never reads like the
  // profile-completion secondary button, regardless of the editable template.
  const payCtaText =
    lang === "fr" ? "Choisir mon mode de paiement" : "Choose my payment method";

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
      button: {
        text: payCtaText,
        url: data.paymentUrl || dashboardUrl,
      },
      secondaryButton: profileNudge,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        `${payCtaText} : ${data.paymentUrl || dashboardUrl}`,
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
          text: payCtaText,
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

  // "Consultation ponctuelle rapide" (emergency) requests must stand out and
  // state the 12 h response window (the urgent take-charge SLA). We surface the
  // urgency in BOTH render paths via a warning theme + a dedicated info box, so
  // it shows even when an admin has customised the editable template body.
  const isEmergency = Boolean(data.isEmergency);
  // For a loved-one ("proche") booking, the pro must see WHO they'll treat — the
  // loved one — not the requester's name + personal email. resolveProfessional-
  // NotifeeParty returns the loved one's name (always) + the LSSSS-correct
  // contact; self/patient bookings return the requester unchanged.
  const party = resolveProfessionalNotifeeParty({
    bookingFor: data.bookingFor,
    lovedOneInfo: data.lovedOneInfo,
    requesterName: data.clientName,
    requesterEmail: data.clientEmail,
  });
  const emergencyInfoBox = {
    title: "⚠ Consultation ponctuelle rapide",
    content:
      "Cette demande est une consultation ponctuelle rapide (urgente). Merci d'y répondre dans un délai de 12 heures pour la prendre en charge ou la libérer.",
    theme: "warning" as const,
  };

  // Admin-editable template (subject/title/subtitle/body/CTA); the hardcoded
  // block below is the fallback if the DB row can't be loaded. Body is French.
  const editable = await loadEditableTemplate("professionalNewRequest", "fr", {
    professionalName,
    clientName: party.name,
    clientEmail: party.email,
    appointmentType,
    appointmentDate: formattedDate,
    appointmentTime: formattedTime,
    // Lets a customised template optionally branch with {{#isEmergency}}…{{/isEmergency}}.
    isEmergency: isEmergency ? "1" : "",
  });
  if (editable) {
    const html = buildEmailHtml({
      title: editable.title,
      subtitle: isEmergency ? "Réponse requise sous 12 heures" : editable.subtitle,
      theme: isEmergency ? "warning" : "info",
      greeting: "",
      intro: editable.bodyHtml,
      infoBox: isEmergency ? emergencyInfoBox : undefined,
      button: editable.ctaText
        ? { text: editable.ctaText, url: dashboardUrl }
        : undefined,
      branding,
      lang: "fr",
    });
    const text = buildEmailText(
      [
        editable.title,
        isEmergency
          ? "Consultation ponctuelle rapide (urgente) — réponse requise sous 12 heures."
          : "",
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        editable.ctaText ? `${editable.ctaText} : ${dashboardUrl}` : "",
      ],
      "fr",
    );
    return sendEmail(
      {
        to: data.professionalEmail,
        subject: isEmergency
          ? `⚠ URGENCE — ${editable.subject}`
          : editable.subject,
        html,
        text,
      },
      "appointment_professional_notification",
    );
  }

  const html = buildEmailHtml({
    title: isEmergency
      ? "⚠ Consultation ponctuelle rapide"
      : "Nouvelle demande de rendez-vous",
    subtitle: isEmergency ? "Réponse requise sous 12 heures" : undefined,
    theme: isEmergency ? "warning" : "info",
    greeting: `Bonjour ${professionalName},`,
    intro: isEmergency
      ? "Vous avez reçu une <strong>consultation ponctuelle rapide</strong> (demande urgente). Merci d'y répondre dans un délai de <strong>12 heures</strong> pour la prendre en charge ou la libérer."
      : "Vous avez reçu une nouvelle demande de rendez-vous. Veuillez consulter les détails ci-dessous.",
    details: [
      ...(isEmergency
        ? [{ label: "Priorité", value: "⚠ URGENCE — réponse sous 12 h" }]
        : []),
      { label: "Client", value: party.name },
      { label: "Courriel", value: party.email },
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
    isEmergency
      ? "⚠ Consultation ponctuelle rapide — réponse requise sous 12 h"
      : "Nouvelle demande de rendez-vous",
    `Bonjour ${professionalName},`,
    isEmergency
      ? "Vous avez reçu une consultation ponctuelle rapide (urgente). Merci d'y répondre dans un délai de 12 heures."
      : "Vous avez une nouvelle demande de rendez-vous.",
    ...(isEmergency ? ["Priorité : URGENCE — réponse sous 12 h"] : []),
    "DÉTAILS DU CLIENT :",
    `Client : ${party.name}`,
    `Courriel : ${party.email}`,
    `Type : ${appointmentType}`,
    `Date : ${formattedDate}`,
    `Heure : ${formattedTime}`,
    `Voir les demandes : ${dashboardUrl}`,
  ]);

  const subject = await getSubject(
    "appointment_professional_notification",
    isEmergency
      ? "⚠ Consultation ponctuelle rapide (réponse sous 12 h) — Je chemine"
      : "Nouvelle demande de rendez-vous — Je chemine",
  );

  return sendEmail(
    { to: data.professionalEmail, subject, html, text },
    "appointment_professional_notification",
  );
}

/**
 * The "À planifier" tab of the pro's proposals page, where an accepted request
 * waits for its first appointment date. The page opens the tab named by
 * `?tab=`. A query (not a #hash) because the server never sees a hash, so a
 * logged-out pro would lose it on the way through /login.
 */
export const PROFESSIONAL_TO_SCHEDULE_PATH =
  "/professional/dashboard/proposals?tab=awaiting";

/**
 * An admin assigned a request directly to this professional (admin → Demandes
 * de service → « Assigner »).
 *
 * Found 2026-09-18: this used to send the generic « Nouvelle demande de
 * rendez-vous » email, whose button opened the FIRST tab (« Proposées pour
 * vous »). A direct assignment is already accepted for the pro, so it is never
 * in that tab: the pro saw an empty list and thought the request was lost. It
 * waits in « À planifier » for the first appointment date, so that is what the
 * email says and where its button goes.
 */
export async function sendProfessionalAssignedEmail(data: {
  professionalName: string;
  professionalEmail: string;
  clientName: string;
  clientEmail: string;
  type: "video" | "in-person" | "phone" | "both";
  isEmergency?: boolean;
  bookingFor?: AppointmentEmailData["bookingFor"];
  lovedOneInfo?: AppointmentEmailData["lovedOneInfo"];
  locale?: string;
}): Promise<boolean> {
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const branding = await getBranding();
  const url = `${process.env.NEXTAUTH_URL}${PROFESSIONAL_TO_SCHEDULE_PATH}`;
  const professionalName = formatProfessionalName(data.professionalName, lang);
  const appointmentType = formatAppointmentType(data.type, lang);
  // Loved-one booking: the pro sees who they'll treat, not the requester.
  const party = resolveProfessionalNotifeeParty({
    bookingFor: data.bookingFor,
    lovedOneInfo: data.lovedOneInfo,
    requesterName: data.clientName,
    requesterEmail: data.clientEmail,
  });
  const isEmergency = Boolean(data.isEmergency);

  const copy = {
    fr: {
      subject: `Un client vous a été assigné : ${party.name} — Je chemine`,
      title: "Un client vous a été assigné",
      subtitle: "Fixez la date du premier rendez-vous",
      badge: "📅 À planifier",
      greeting: `Bonjour ${professionalName},`,
      intro: `L'équipe Je chemine vous a assigné la demande de <strong>${escapeHtml(party.name)}</strong>. Vous n'avez rien à accepter : elle est déjà à vous. Elle vous attend dans l'onglet <strong>« À planifier »</strong> de vos propositions de clients, où vous fixez la date du premier rendez-vous.`,
      introText: `L'équipe Je chemine vous a assigné la demande de ${party.name}. Vous n'avez rien à accepter : elle est déjà à vous. Elle vous attend dans l'onglet « À planifier » de vos propositions de clients, où vous fixez la date du premier rendez-vous.`,
      client: "Client",
      email: "Courriel",
      typeLabel: "Type",
      priority: "Priorité",
      urgent: "⚠ URGENCE — réponse sous 12 h",
      urgentBox: {
        title: "⚠ Consultation ponctuelle rapide",
        content:
          "Cette demande est une consultation ponctuelle rapide (urgente). Merci de fixer le premier rendez-vous dans un délai de 12 heures.",
      },
      button: "Planifier le premier rendez-vous",
      outro:
        "Vous pouvez communiquer avec le client avant de fixer une date officielle.",
    },
    en: {
      subject: `A client was assigned to you: ${party.name} — Je chemine`,
      title: "A client was assigned to you",
      subtitle: "Set the first appointment date",
      badge: "📅 To Schedule",
      greeting: `Hello ${professionalName},`,
      intro: `The Je chemine team assigned <strong>${escapeHtml(party.name)}</strong>'s request to you. There is nothing to accept: it is already yours. It is waiting in the <strong>"To Schedule"</strong> tab of your client proposals, where you set the first appointment date.`,
      introText: `The Je chemine team assigned ${party.name}'s request to you. There is nothing to accept: it is already yours. It is waiting in the "To Schedule" tab of your client proposals, where you set the first appointment date.`,
      client: "Client",
      email: "Email",
      typeLabel: "Type",
      priority: "Priority",
      urgent: "⚠ URGENT — reply within 12 h",
      urgentBox: {
        title: "⚠ Rapid one-time consultation",
        content:
          "This request is a rapid one-time consultation (urgent). Please set the first appointment within 12 hours.",
      },
      button: "Schedule the first appointment",
      outro: "You may contact the client before setting an official date.",
    },
  }[lang];

  const html = buildEmailHtml({
    title: copy.title,
    subtitle: copy.subtitle,
    theme: isEmergency ? "warning" : "info",
    badge: { text: copy.badge, theme: "info" },
    greeting: copy.greeting,
    intro: copy.intro,
    infoBox: isEmergency
      ? { ...copy.urgentBox, theme: "warning" as const }
      : undefined,
    details: [
      ...(isEmergency ? [{ label: copy.priority, value: copy.urgent }] : []),
      { label: copy.client, value: party.name },
      { label: copy.email, value: party.email },
      { label: copy.typeLabel, value: appointmentType },
    ],
    button: { text: copy.button, url },
    outro: copy.outro,
    branding,
    lang,
  });

  const text = buildEmailText(
    [
      copy.title,
      copy.greeting,
      copy.introText,
      isEmergency ? copy.urgentBox.content : "",
      `${copy.client} : ${party.name}`,
      `${copy.email} : ${party.email}`,
      `${copy.typeLabel} : ${appointmentType}`,
      `${copy.button} : ${url}`,
    ],
    lang,
  );

  // The subject names the client in the pro's language, so it is built here
  // rather than read from Settings (like the showcase emails).
  return sendEmail(
    {
      to: data.professionalEmail,
      subject: isEmergency ? `⚠ ${copy.subject}` : copy.subject,
      html,
      text,
    },
    "professional_client_assigned",
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
  // The email sends the pro to « À planifier »; the bare page opened the first tab.
  const dashboardUrl = `${process.env.NEXTAUTH_URL}${PROFESSIONAL_TO_SCHEDULE_PATH}`;
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

/**
 * A labelled "Lieu" block for the reminder emails.
 *
 * Reminders previously showed no location at all, so a client booked for an
 * in-person session saw only Je chemine's address in the branding footer and
 * could travel to the wrong building. Rendered only when the caller resolved
 * a line (i.e. the appointment is in-person) — see lib/session-location.ts.
 */
function sessionLocationHtml(line: string | undefined, lang: "fr" | "en"): string {
  if (!line) return "";
  const label = lang === "en" ? "Location" : "Lieu";
  return (
    `<p style="margin:16px 0 0;"><strong>${label} :</strong><br>` +
    `${line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/ · /g, "<br>")}</p>`
  );
}
export async function sendAppointment72hReminder(data: {
  /** Where an in-person session takes place (the PROFESSIONAL's office,
   *  never the platform's). Undefined for video/phone. See
   *  lib/session-location.ts. */
  sessionLocationLine?: string;
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
      intro:
        editable.bodyHtml +
        sessionLocationHtml(data.sessionLocationLine, lang),
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
        : `Friendly reminder: your appointment with ${professionalName} is scheduled on ${data.appointmentDateLabel}. You are still within the free-cancellation window (until 48h before the session).`
        + sessionLocationHtml(data.sessionLocationLine, lang),
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
  /** Where an in-person session takes place (the PROFESSIONAL's office,
   *  never the platform's). Undefined for video/phone. See
   *  lib/session-location.ts. */
  sessionLocationLine?: string;
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
      intro:
        editable.bodyHtml +
        sessionLocationHtml(data.sessionLocationLine, lang),
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
        : `Your appointment with ${professionalName} will take place in 48 hours (${data.appointmentDateLabel}).`
        + sessionLocationHtml(data.sessionLocationLine, lang),
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
  /**
   * The SINGLE Interac reference a client is ever asked to write.
   *
   * This email used to name the INVOICE number as the mandatory transfer
   * note, while the pre-session Interac instructions named the INT- code —
   * two different "mandatory" references for the same appointment. A client
   * who paid before the session and one who paid after quoted different
   * things, and neither could be matched automatically.
   *
   * The INT- code wins because it exists from the moment Interac is chosen.
   * The invoice number cannot: `nextInvoiceNumber` is a gap-free fiscal
   * counter allocated at closure, and issuing one for a session that may
   * never happen would punch holes in the sequence.
   *
   * The invoice number stays on the email as the document reference.
   */
  interacReferenceCode: string;
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
              value: data.interacReferenceCode,
            },
            {
              label: "4. Nom du compte bancaire",
              value: `Idéalement identique à « ${data.clientLegalName} ». Si le virement provient d'un autre nom (ex. conjoint), inscrivez bien la référence ${data.interacReferenceCode} dans la note pour que nous puissions associer votre paiement.`,
              stacked: true,
            },
          ]
        : [
            { label: "Interac e-Transfer — 1. Send to", value: data.depositEmail },
            { label: "2. Amount", value: amount },
            {
              label: "3. Mandatory transfer note",
              value: data.interacReferenceCode,
            },
            {
              label: "4. Bank account name",
              value: `Ideally identical to "${data.clientLegalName}". If the transfer comes from another name (e.g. a spouse), be sure to add reference ${data.interacReferenceCode} in the note so we can match your payment.`,
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
          `• Note obligatoire du virement : ${data.interacReferenceCode}`,
          `• Nom du compte : idéalement « ${data.clientLegalName} » (sinon, indiquez bien la référence dans la note).`,
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
          `• Mandatory transfer note: ${data.interacReferenceCode}`,
          `• Account name: ideally "${data.clientLegalName}" (otherwise add the reference in the note).`,
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
            // Filename matches the receipt number on the PDF (e.g. REC-BDA8A524.pdf).
            filename: `${buildReceiptNumber(data.appointmentId)}.pdf`,
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
          // Filename matches the receipt number on the PDF (e.g. REC-BDA8A524.pdf).
          filename: `${buildReceiptNumber(data.appointmentId)}.pdf`,
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
      // The primary button goes to completeAccountUrl (account/profile
      // completion), so its LABEL is hardcoded to match — NOT editable.ctaText,
      // which a stale/admin-edited template left as a payment label ("Choisir
      // mon mode de paiement"), making the button read backwards vs the payment
      // secondary button. Label must always describe the code-fixed destination.
      button: data.completeAccountUrl
        ? {
            text:
              lang === "fr" ? "Compléter mon compte" : "Complete my account",
            url: data.completeAccountUrl,
          }
        : undefined,
      secondaryButton: paymentNudge,
      branding,
      lang,
    });
    const text = buildEmailText(
      [
        editable.title,
        editable.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
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
}): Promise<boolean> {
  // Resolves true once at least one admin copy was accepted, so the caller
  // only records the send (and starts the once-a-day clock) when it happened.
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) return false;
  let sent = false;

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
      const ok = await sendEmail(
        { to, subject: editable.subject, html, text },
        "admin_interac_trust_request",
      ).catch((e) => {
        console.error("sendAdminNoPaymentBeforeMeetingAlert:", e);
        return false;
      });
      sent = sent || ok;
    }
    return sent;
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
    const ok = await sendEmail({ to, subject, html, text }, "admin_interac_trust_request").catch((e) => {
      console.error("sendAdminNoPaymentBeforeMeetingAlert:", e);
      return false;
    });
    sent = sent || ok;
  }
  return sent;
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
  /** Spec 002: the client says a third party pays — an admin must confirm it. */
  payerDeclaration?: { organizationName: string; caseNumber?: string } | null;
}): Promise<void> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) {
    // Never return silently: with no recipients configured this warning is
    // the ONLY trace that every new demande is going unannounced.
    console.warn(
      "[admin_new_service_request] No admin recipients — set adminAlertEmail " +
        "in Admin → Settings, or ADMIN_ALERT_EMAIL. New service requests are " +
        "NOT being announced to anyone.",
    );
    return;
  }

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/service-requests`;

  // Urgent requests get a louder email (warning theme + flagged subject/intro)
  // so admins triage them ahead of standard demandes.
  const isEmergency = Boolean(data.isEmergency);

  // Client free text — escaped before it goes anywhere near the HTML.
  const declaredValue = data.payerDeclaration
    ? `${escapeHtml(data.payerDeclaration.organizationName)}${
        data.payerDeclaration.caseNumber
          ? ` (dossier ${escapeHtml(data.payerDeclaration.caseNumber)})`
          : ""
      } — à confirmer dans le dossier du client`
    : "";
  const declaredText = data.payerDeclaration
    ? `Tiers payeur déclaré : ${data.payerDeclaration.organizationName} — à confirmer`
    : "";

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
      details: declaredValue
        ? [{ label: "Tiers payeur déclaré", value: declaredValue, stacked: true }]
        : undefined,
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
        declaredText,
        editable.ctaText ? `${editable.ctaText} : ${adminUrl}` : "",
      ],
      "fr",
    );
    for (const to of adminEmails) {
      await sendEmail(
        { to, subject: editable.subject, html, text },
        "admin_new_service_request",
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
      ...(declaredValue
        ? [{ label: "Tiers payeur déclaré", value: declaredValue, stacked: true }]
        : []),
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
    ...(declaredText ? [declaredText] : []),
    `ID : ${data.appointmentId}`,
    adminUrl,
  ]);

  const subject = isEmergency
    ? `⚠ URGENCE — Nouvelle demande — ${data.clientName}`
    : `Nouvelle demande — ${data.clientName}`;

  for (const to of adminEmails) {
    await sendEmail(
      { to, subject, html, text },
      "admin_new_service_request",
    ).catch((e) => console.error("sendAdminNewServiceRequestAlert:", e));
  }
}

/** Why a closed session is being held, in words an admin can act on. */
const THIRD_PARTY_HOLD_REASONS_FR: Record<string, string> = {
  declaration_pending:
    "Le client a déclaré un organisme payeur qui n'a pas encore été confirmé.",
  per_session_undecided:
    "Couverture « au choix par séance » : aucun payeur n'a été choisi pour cette séance.",
  consent_missing:
    "Le consentement du client n'est pas enregistré : l'organisme ne peut pas être facturé.",
  organization_without_coverage:
    "« Organisme » a été choisi pour cette séance, mais aucune couverture n'est liée au client.",
};

/**
 * Spec 002: a session was closed but nobody has decided who pays, so nothing was
 * charged. Tells the team what is blocking it. Contains no clinical detail —
 * only the client, the date and the reason. Returns true once a copy went out,
 * so the caller can record that the alert was sent.
 */
export async function sendAdminThirdPartyDecisionAlert(data: {
  clientName: string;
  appointmentId: string;
  appointmentDateLabel: string;
  reason: string;
  organizationName?: string;
}): Promise<boolean> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) {
    console.warn(
      "[admin_third_party_decision_needed] No admin recipients — set adminAlertEmail. " +
        "A closed session is waiting for a payer decision and nobody was told.",
    );
    return false;
  }

  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const adminUrl = `${base}/admin/dashboard/billing`;
  const why =
    THIRD_PARTY_HOLD_REASONS_FR[data.reason] ??
    "Le payeur de cette séance est à confirmer.";

  const html = buildEmailHtml({
    title: "Payeur à confirmer",
    theme: "warning",
    greeting: "Bonjour,",
    intro: `La séance de ${data.clientName} du ${data.appointmentDateLabel} a été clôturée, mais on ne sait pas encore qui la paie. Rien n'a été facturé : un administrateur doit décider.`,
    details: [
      { label: "Client", value: data.clientName },
      { label: "Date séance", value: data.appointmentDateLabel },
      ...(data.organizationName
        ? [{ label: "Organisme déclaré", value: data.organizationName }]
        : []),
      { label: "Raison", value: why },
      { label: "ID RDV", value: data.appointmentId },
    ],
    button: { text: "Voir la facturation", url: adminUrl },
    branding,
  });
  const text = buildEmailText([
    "Payeur à confirmer — séance clôturée",
    `Client : ${data.clientName}`,
    `Date : ${data.appointmentDateLabel}`,
    `Raison : ${why}`,
    `RDV : ${data.appointmentId}`,
    adminUrl,
  ]);
  const subject = `Payeur à confirmer — ${data.clientName}`;

  let sent = false;
  for (const to of adminEmails) {
    const ok = await sendEmail(
      { to, subject, html, text },
      "admin_third_party_decision_needed",
    ).catch((e) => {
      console.error("sendAdminThirdPartyDecisionAlert:", e);
      return false;
    });
    sent = sent || ok;
  }
  return sent;
}

/**
 * Spec 002: an admin confirmed that an organization pays for the client's
 * sessions. Says who pays and what stays the client's (late cancellations and
 * no-shows). Returns true once sent.
 */
export async function sendClientCoverageConfirmedEmail(data: {
  clientEmail: string;
  clientName: string;
  organizationName: string;
  maxSessions?: number | null;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const org = escapeHtml(data.organizationName);
  const cap = data.maxSessions
    ? lang === "fr"
      ? ` jusqu’à ${data.maxSessions} séance(s)`
      : ` for up to ${data.maxSessions} session(s)`
    : "";
  const html = buildEmailHtml({
    title: lang === "fr" ? "Prise en charge confirmée" : "Coverage confirmed",
    theme: "success",
    greeting: lang === "fr" ? `Bonjour ${escapeHtml(data.clientName)},` : `Hello ${escapeHtml(data.clientName)},`,
    intro:
      lang === "fr"
        ? `Nous avons confirmé que ${org} paie vos séances${cap}. Vous n’aurez rien à régler pour ces séances, sauf si l’organisme ne couvre qu’une partie du prix.`
        : `We have confirmed that ${org} pays for your sessions${cap}. You will have nothing to pay for these sessions, unless the organization covers only part of the price.`,
    details: [
      {
        label: lang === "fr" ? "À savoir" : "Good to know",
        value:
          lang === "fr"
            ? "Votre carte reste enregistrée pour garantir vos rendez-vous : une annulation tardive ou une absence vous sera facturée, pas à l’organisme."
            : "Your card stays on file to guarantee your appointments: a late cancellation or a missed session is billed to you, not to the organization.",
        stacked: true,
      },
    ],
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      lang === "fr" ? "Prise en charge confirmée" : "Coverage confirmed",
      lang === "fr"
        ? `${data.organizationName} paie vos séances${cap}.`
        : `${data.organizationName} pays for your sessions${cap}.`,
      lang === "fr"
        ? "Une annulation tardive ou une absence vous reste facturée."
        : "A late cancellation or a missed session is still billed to you.",
    ],
    lang,
  );
  const subject =
    lang === "fr"
      ? "Vos séances sont prises en charge — Je chemine"
      : "Your sessions are covered — Je chemine";
  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    "client_coverage_confirmed",
  ).catch((e) => {
    console.error("sendClientCoverageConfirmedEmail:", e);
    return false;
  });
}

/**
 * Spec 002: one covered session left — or none. Tells the client that the
 * sessions after that are theirs to pay, so it never comes as a surprise.
 */
export async function sendClientCoverageCapEmail(data: {
  kind: "last_session" | "exhausted";
  clientEmail: string;
  clientName: string;
  organizationName: string;
  used: number;
  max: number;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const org = escapeHtml(data.organizationName);
  const last = data.kind === "last_session";
  const html = buildEmailHtml({
    title: last
      ? lang === "fr" ? "Il vous reste une séance couverte" : "One covered session left"
      : lang === "fr" ? "Vos séances couvertes sont utilisées" : "Your covered sessions are used up",
    theme: "warning",
    greeting: lang === "fr" ? `Bonjour ${escapeHtml(data.clientName)},` : `Hello ${escapeHtml(data.clientName)},`,
    intro: last
      ? lang === "fr"
        ? `Vous avez utilisé ${data.used} des ${data.max} séances payées par ${org}. Il vous en reste une. Les séances suivantes vous seront facturées, à moins que l’organisme ne prolonge sa prise en charge.`
        : `You have used ${data.used} of the ${data.max} sessions paid by ${org}. One is left. Sessions after that will be billed to you, unless the organization extends its coverage.`
      : lang === "fr"
        ? `Les ${data.max} séances payées par ${org} sont maintenant utilisées. Vos prochaines séances vous seront facturées, à moins que l’organisme ne prolonge sa prise en charge — parlez-en à votre organisme si besoin.`
        : `The ${data.max} sessions paid by ${org} are now used up. Your next sessions will be billed to you, unless the organization extends its coverage — check with your organization if needed.`,
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      last
        ? lang === "fr" ? "Il vous reste une séance couverte" : "One covered session left"
        : lang === "fr" ? "Vos séances couvertes sont utilisées" : "Your covered sessions are used up",
      `${data.organizationName} — ${data.used}/${data.max}`,
      lang === "fr"
        ? "Les séances suivantes vous seront facturées, sauf prolongation par l’organisme."
        : "Later sessions will be billed to you unless the organization extends its coverage.",
    ],
    lang,
  );
  const subject = last
    ? lang === "fr" ? "Il vous reste une séance couverte — Je chemine" : "One covered session left — Je chemine"
    : lang === "fr" ? "Vos séances couvertes sont utilisées — Je chemine" : "Your covered sessions are used up — Je chemine";
  return sendEmail(
    { to: data.clientEmail, subject, html, text },
    last ? "client_coverage_cap_warning" : "client_coverage_exhausted",
  ).catch((e) => {
    console.error("sendClientCoverageCapEmail:", e);
    return false;
  });
}

/**
 * Spec 002: a client's coverage has one session left. Gives the team time to
 * ask the organization for more sessions before the client starts paying.
 */
export async function sendAdminCoverageCapWarning(data: {
  clientName: string;
  clientId: string;
  organizationName: string;
  used: number;
  max: number;
}): Promise<boolean> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) {
    console.warn("[admin_coverage_cap_warning] No admin recipients — set adminAlertEmail.");
    return false;
  }
  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const url = `${base}/admin/dashboard/patients/${data.clientId}`;
  const html = buildEmailHtml({
    title: "Couverture : une séance restante",
    theme: "warning",
    greeting: "Bonjour,",
    intro: `${escapeHtml(data.clientName)} a utilisé ${data.used} des ${data.max} séances payées par ${escapeHtml(data.organizationName)}. Il en reste une : demandez une prolongation à l’organisme si le suivi continue.`,
    details: [
      { label: "Client", value: escapeHtml(data.clientName) },
      { label: "Organisme", value: escapeHtml(data.organizationName) },
      { label: "Séances", value: `${data.used} / ${data.max}` },
    ],
    button: { text: "Voir le dossier", url },
    branding,
  });
  const text = buildEmailText([
    "Couverture : une séance restante",
    `${data.clientName} — ${data.organizationName} — ${data.used}/${data.max}`,
    url,
  ]);
  let sent = false;
  for (const to of adminEmails) {
    const ok = await sendEmail(
      { to, subject: `Une séance couverte restante — ${data.clientName}`, html, text },
      "admin_coverage_cap_warning",
    ).catch((e) => {
      console.error("sendAdminCoverageCapWarning:", e);
      return false;
    });
    sent = sent || ok;
  }
  return sent;
}

// --- Spec 002: emails to an organization's billing address -------------------

const orgMoney = (cents: number, lang: "fr" | "en") =>
  lang === "fr"
    ? `${(cents / 100).toFixed(2).replace(".", ",")} $`
    : `$${(cents / 100).toFixed(2)}`;

const orgDate = (date: Date | null | undefined, lang: "fr" | "en") =>
  date
    ? new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
        timeZone: "America/Toronto",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(date))
    : "—";

/** The invoice number is the Interac message — one reference per invoice. */
const orgInteracLine = (email: string, number: string, lang: "fr" | "en") =>
  lang === "fr"
    ? `Virement Interac à ${email}, avec le message « ${number} ».`
    : `Interac e-Transfer to ${email}, with “${number}” as the message.`;

const orgInteracBox = (email: string, number: string, lang: "fr" | "en") => ({
  title: lang === "fr" ? "Payer par virement Interac" : "Pay by Interac e-Transfer",
  content: escapeHtml(orgInteracLine(email, number, lang)),
});

/**
 * Spec 002: an invoice or statement to an organization's billing address.
 * The body names no patient — only the organization, the number, the amounts
 * and the due date. Patient names are in the attached PDF, which may only be
 * sent with every client's consent (checked by the caller).
 *
 * `formPdf`: the organization's own claim form, attached as a second PDF under
 * a fixed name (never the name it was uploaded under).
 */
export async function sendOrganizationInvoiceEmail(data: {
  to: string;
  kind: "session" | "statement";
  organizationName: string;
  number: string;
  totalCents: number;
  balanceCents: number;
  dueAt: Date | null;
  periodKey: string | null;
  pdf: Buffer;
  formPdf?: Buffer | null;
  /** The pay link (card), when a balance is due. */
  payUrl?: string | null;
  /** Interac deposit address; the invoice number is the transfer message. */
  interacEmail?: string | null;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const money = (cents: number) => orgMoney(cents, lang);
  const due = orgDate(data.dueAt, lang);
  const statement = data.kind === "statement";
  const title = statement
    ? lang === "fr" ? "Relevé de facturation" : "Billing statement"
    : lang === "fr" ? "Facture" : "Invoice";
  const org = escapeHtml(data.organizationName);
  const withForm = Boolean(data.formPdf);
  const formSentence = withForm
    ? lang === "fr"
      ? " Le formulaire demandé par votre organisme est également joint."
      : " The form your organization asked for is also attached."
    : "";

  const html = buildEmailHtml({
    title: `${title} ${data.number}`,
    theme: "info",
    greeting: lang === "fr" ? "Bonjour," : "Hello,",
    intro:
      (lang === "fr"
        ? `Veuillez trouver ci-joint ${statement ? "le relevé" : "la facture"} ${data.number} adressé${statement ? "" : "e"} à ${org} pour des séances offertes par Je chemine.`
        : `Please find attached ${statement ? "statement" : "invoice"} ${data.number} for ${org}, for sessions provided by Je chemine.`) +
      formSentence,
    details: [
      { label: lang === "fr" ? "Numéro" : "Number", value: data.number },
      ...(data.periodKey ? [{ label: lang === "fr" ? "Période" : "Period", value: data.periodKey }] : []),
      { label: lang === "fr" ? "Montant" : "Amount", value: money(data.totalCents) },
      { label: lang === "fr" ? "Solde dû" : "Balance due", value: money(data.balanceCents) },
      { label: lang === "fr" ? "Échéance" : "Due date", value: due },
    ],
    ...(data.payUrl
      ? { button: { text: lang === "fr" ? "Payer en ligne" : "Pay online", url: data.payUrl } }
      : {}),
    ...(data.interacEmail
      ? { infoBox: orgInteracBox(data.interacEmail, data.number, lang) }
      : {}),
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      `${title} ${data.number}`,
      `${data.organizationName} — ${money(data.balanceCents)} — ${due}`,
      withForm
        ? lang === "fr"
          ? "La facture et le formulaire de votre organisme sont joints à ce courriel."
          : "The invoice and your organization's form are attached to this email."
        : lang === "fr"
          ? "Le document est joint à ce courriel."
          : "The document is attached to this email.",
      data.payUrl ? `${lang === "fr" ? "Payer en ligne" : "Pay online"} : ${data.payUrl}` : "",
      data.interacEmail ? orgInteracLine(data.interacEmail, data.number, lang) : "",
    ],
    lang,
  );
  return sendEmail(
    {
      to: data.to,
      subject: `${title} ${data.number} — Je chemine`,
      html,
      text,
      attachments: [
        { filename: `${data.number}.pdf`, content: data.pdf, contentType: "application/pdf" },
        ...(data.formPdf
          ? [
              {
                filename: organizationFormFileName(data.number, lang),
                content: data.formPdf,
                contentType: "application/pdf",
              },
            ]
          : []),
      ],
    },
    statement ? "organization_statement" : "organization_invoice",
  );
}

/**
 * Spec 002: organization invoices wait for a human to review and send them.
 * One email per run listing the new drafts — organizations, periods, session
 * counts and totals; never a patient's name.
 */
export async function sendAdminOrganizationInvoicesReview(data: {
  items: Array<{
    organizationName: string;
    kind: "session" | "statement";
    periodKey?: string | null;
    sessions: number;
    totalCents: number;
    /** The organization requires its own form and none is attached yet. */
    needsOwnForm?: boolean;
  }>;
}): Promise<boolean> {
  if (data.items.length === 0) return false;
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) {
    console.warn("[admin_organization_statement_review] No admin recipients — set adminAlertEmail.");
    return false;
  }
  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const url = `${base}/admin/dashboard/organization-invoices`;
  const money = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} $`;
  const describe = (i: (typeof data.items)[number]) =>
    `${escapeHtml(i.organizationName)} — ${i.kind === "statement" ? `relevé ${i.periodKey ?? ""}` : "facture de séance"} — ${i.sessions} séance(s), ${money(i.totalCents)}${i.needsOwnForm ? " — formulaire de l’organisme à joindre" : ""}`;
  const needForm = data.items.some((i) => i.needsOwnForm);

  const html = buildEmailHtml({
    title: "Factures aux organismes à réviser",
    theme: "info",
    greeting: "Bonjour,",
    intro: `${data.items.length} brouillon(s) de facture aux organismes attend(ent) votre révision. Rien n’est envoyé à un organisme avant que vous cliquiez « Envoyer ».${needForm ? " Certains organismes exigent leur propre formulaire : rien ne leur part, même automatiquement, avant qu’il soit joint." : ""}`,
    details: data.items.map((i, n) => ({ label: `#${n + 1}`, value: describe(i), stacked: true })),
    button: { text: "Réviser les factures", url },
    branding,
  });
  const text = buildEmailText([
    "Factures aux organismes à réviser",
    ...data.items.map((i) => describe(i).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")),
    url,
  ]);
  let sent = false;
  for (const to of adminEmails) {
    const ok = await sendEmail(
      { to, subject: `Factures aux organismes à réviser (${data.items.length})`, html, text },
      "admin_organization_statement_review",
    ).catch((e) => {
      console.error("sendAdminOrganizationInvoicesReview:", e);
      return false;
    });
    sent = sent || ok;
  }
  return sent;
}

/**
 * Spec 002: a payment reminder to an organization — at the due date, then 14
 * days later. Number, balance and due date only: no patient's name, no PDF.
 */
export async function sendOrganizationPaymentReminderEmail(data: {
  to: string;
  stage: "due" | "follow_up";
  organizationName: string;
  number: string;
  balanceCents: number;
  dueAt: Date | null;
  payUrl?: string | null;
  interacEmail?: string | null;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const balance = orgMoney(data.balanceCents, lang);
  const due = orgDate(data.dueAt, lang);
  const org = escapeHtml(data.organizationName);
  const followUp = data.stage === "follow_up";
  const title =
    lang === "fr"
      ? followUp ? `Facture ${data.number} en retard` : `Facture ${data.number} à échéance`
      : followUp ? `Invoice ${data.number} is overdue` : `Invoice ${data.number} is due`;
  const intro =
    lang === "fr"
      ? followUp
        ? `La facture ${data.number} adressée à ${org} était payable le ${due}. Un solde de ${balance} reste à régler. Si le paiement est déjà parti, merci de ne pas tenir compte de ce rappel.`
        : `La facture ${data.number} adressée à ${org} arrive à échéance le ${due}. Solde à régler : ${balance}. Si le paiement est déjà parti, merci de ne pas tenir compte de ce rappel.`
      : followUp
        ? `Invoice ${data.number} for ${org} was due on ${due}. A balance of ${balance} is outstanding. If the payment is already on its way, please disregard this reminder.`
        : `Invoice ${data.number} for ${org} is due on ${due}. Balance due: ${balance}. If the payment is already on its way, please disregard this reminder.`;
  const html = buildEmailHtml({
    title,
    theme: followUp ? "warning" : "info",
    greeting: lang === "fr" ? "Bonjour," : "Hello,",
    intro,
    details: [
      { label: lang === "fr" ? "Numéro" : "Number", value: data.number },
      { label: lang === "fr" ? "Solde dû" : "Balance due", value: balance },
      { label: lang === "fr" ? "Échéance" : "Due date", value: due },
    ],
    ...(data.payUrl
      ? { button: { text: lang === "fr" ? "Payer en ligne" : "Pay online", url: data.payUrl } }
      : {}),
    ...(data.interacEmail ? { infoBox: orgInteracBox(data.interacEmail, data.number, lang) } : {}),
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      title,
      `${data.organizationName} — ${balance} — ${due}`,
      data.payUrl ? `${lang === "fr" ? "Payer en ligne" : "Pay online"} : ${data.payUrl}` : "",
      data.interacEmail ? orgInteracLine(data.interacEmail, data.number, lang) : "",
    ],
    lang,
  );
  return sendEmail(
    { to: data.to, subject: `${title} — Je chemine`, html, text },
    "organization_payment_reminder",
  );
}

/** Spec 002: the organization's payment arrived (card, Interac or recorded by hand). */
export async function sendOrganizationPaymentReceivedEmail(data: {
  to: string;
  organizationName: string;
  number: string;
  amountCents: number;
  balanceCents: number;
  payUrl?: string | null;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const amount = orgMoney(data.amountCents, lang);
  const balance = orgMoney(data.balanceCents, lang);
  const org = escapeHtml(data.organizationName);
  const settled = data.balanceCents <= 0;
  const title = lang === "fr" ? `Paiement reçu — facture ${data.number}` : `Payment received — invoice ${data.number}`;
  const intro =
    lang === "fr"
      ? `Nous avons bien reçu ${amount} de ${org} pour la facture ${data.number}. ${settled ? "La facture est entièrement réglée. Merci !" : `Il reste ${balance} à régler.`}`
      : `We received ${amount} from ${org} for invoice ${data.number}. ${settled ? "The invoice is paid in full. Thank you!" : `${balance} remains outstanding.`}`;
  const html = buildEmailHtml({
    title,
    theme: "success",
    greeting: lang === "fr" ? "Bonjour," : "Hello,",
    intro,
    details: [
      { label: lang === "fr" ? "Numéro" : "Number", value: data.number },
      { label: lang === "fr" ? "Montant reçu" : "Amount received", value: amount },
      { label: lang === "fr" ? "Solde restant" : "Remaining balance", value: balance },
    ],
    ...(!settled && data.payUrl
      ? { button: { text: lang === "fr" ? "Payer le solde en ligne" : "Pay the balance online", url: data.payUrl } }
      : {}),
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      title,
      `${data.organizationName} — ${amount} — ${lang === "fr" ? "solde" : "balance"} ${balance}`,
      !settled && data.payUrl ? data.payUrl : "",
    ],
    lang,
  );
  return sendEmail(
    { to: data.to, subject: `${title} — Je chemine`, html, text },
    "organization_payment_received",
  );
}

/**
 * An admin refunded an organization from the invoice screen. The amount, how
 * it goes back and what remains due — never the reason (internal), never a
 * patient's name.
 */
export async function sendOrganizationRefundEmail(data: {
  to: string;
  organizationName: string;
  number: string;
  amountCents: number;
  /** "card": back on the card that paid; "bank": to the debited account; "outside": sent another way. */
  via: "card" | "bank" | "outside";
  /** Stripe accepted it but the money is still on its way. */
  pending: boolean;
  balanceCents: number;
  payUrl?: string | null;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const amount = orgMoney(data.amountCents, lang);
  const balance = orgMoney(data.balanceCents, lang);
  const org = escapeHtml(data.organizationName);
  const owing = data.balanceCents > 0;
  const title = lang === "fr" ? `Remboursement — facture ${data.number}` : `Refund — invoice ${data.number}`;
  const how =
    data.via === "card"
      ? lang === "fr"
        ? "Le montant est rendu sur la carte qui a servi au paiement ; il apparaît habituellement sur le relevé sous 5 à 10 jours ouvrables."
        : "It goes back to the card used for the payment and usually shows on the statement within 5 to 10 business days."
      : data.via === "bank"
        ? lang === "fr"
          ? "Le montant est versé dans le compte bancaire qui a été débité ; il y apparaît habituellement sous 5 à 10 jours ouvrables."
          : "It goes back to the bank account that was debited and usually shows there within 5 to 10 business days."
        : lang === "fr"
          ? "Ce remboursement a été fait hors de la plateforme (virement, chèque ou autre)."
          : "This refund was made outside the platform (transfer, cheque or other).";
  const intro =
    lang === "fr"
      ? `Nous avons remboursé ${amount} à ${org} sur la facture ${data.number}. ${how} ${owing ? `Il reste ${balance} à régler sur cette facture.` : "Rien ne reste à régler sur cette facture."}`
      : `We refunded ${amount} to ${org} on invoice ${data.number}. ${how} ${owing ? `${balance} remains outstanding on this invoice.` : "Nothing remains outstanding on this invoice."}`;
  const html = buildEmailHtml({
    title,
    theme: "info",
    greeting: lang === "fr" ? "Bonjour," : "Hello,",
    intro,
    details: [
      { label: lang === "fr" ? "Numéro" : "Number", value: data.number },
      { label: lang === "fr" ? "Montant remboursé" : "Amount refunded", value: amount },
      ...(data.pending
        ? [{ label: lang === "fr" ? "État" : "Status", value: lang === "fr" ? "en cours" : "in progress" }]
        : []),
      { label: lang === "fr" ? "Solde restant" : "Remaining balance", value: balance },
    ],
    ...(owing && data.payUrl
      ? { button: { text: lang === "fr" ? "Payer en ligne" : "Pay online", url: data.payUrl } }
      : {}),
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      title,
      `${data.organizationName} — ${amount} — ${lang === "fr" ? "solde" : "balance"} ${balance}`,
      how,
      owing && data.payUrl ? data.payUrl : "",
    ],
    lang,
  );
  return sendEmail(
    { to: data.to, subject: `${title} — Je chemine`, html, text },
    "organization_refund",
  );
}

/**
 * An organization's pre-authorized bank debit was refused by its bank: the
 * invoice is payable again. Number, amount and the pay link — no reason from
 * the bank, no patient.
 */
export async function sendOrganizationDebitFailedEmail(data: {
  to: string;
  organizationName: string;
  number: string;
  amountCents: number;
  balanceCents: number;
  payUrl?: string | null;
  locale?: "fr" | "en";
}): Promise<boolean> {
  const branding = await getBranding();
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const amount = orgMoney(data.amountCents, lang);
  const balance = orgMoney(data.balanceCents, lang);
  const org = escapeHtml(data.organizationName);
  const title = lang === "fr" ? `Débit refusé — facture ${data.number}` : `Debit declined — invoice ${data.number}`;
  const intro =
    lang === "fr"
      ? `Le débit préautorisé de ${amount} pour la facture ${data.number} de ${org} a été refusé par votre institution financière. Rien n’a été prélevé. Il reste ${balance} à régler : vous pouvez payer de nouveau en ligne, ou par l’un des autres moyens indiqués sur la facture en rappelant son numéro.`
      : `The pre-authorized debit of ${amount} for invoice ${data.number} (${org}) was declined by your financial institution. Nothing was taken. ${balance} remains outstanding: you can pay again online, or by one of the other methods shown on the invoice, quoting its number.`;
  const html = buildEmailHtml({
    title,
    theme: "warning",
    greeting: lang === "fr" ? "Bonjour," : "Hello,",
    intro,
    details: [
      { label: lang === "fr" ? "Numéro" : "Number", value: data.number },
      { label: lang === "fr" ? "Débit refusé" : "Declined debit", value: amount },
      { label: lang === "fr" ? "Solde dû" : "Balance due", value: balance },
    ],
    ...(data.payUrl ? { button: { text: lang === "fr" ? "Payer en ligne" : "Pay online", url: data.payUrl } } : {}),
    branding,
    lang,
  });
  const text = buildEmailText(
    [title, `${data.organizationName} — ${amount} — ${lang === "fr" ? "solde" : "balance"} ${balance}`, data.payUrl ?? ""],
    lang,
  );
  return sendEmail(
    { to: data.to, subject: `${title} — Je chemine`, html, text },
    "organization_debit_failed",
  );
}

/**
 * Spec 002: organization invoices 30 days past due. One email per run listing
 * them — organization, number, balance, days late; never a patient's name.
 */
export async function sendAdminOrganizationInvoicesOverdue(data: {
  items: Array<{ organizationName: string; number: string; balanceCents: number; daysLate: number }>;
}): Promise<boolean> {
  if (data.items.length === 0) return false;
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) {
    console.warn("[admin_organization_invoice_overdue] No admin recipients — set adminAlertEmail.");
    return false;
  }
  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const url = `${base}/admin/dashboard/organization-invoices`;
  const describe = (i: (typeof data.items)[number]) =>
    `${i.number} — ${i.organizationName} — ${orgMoney(i.balanceCents, "fr")} — ${i.daysLate} jours de retard`;

  const html = buildEmailHtml({
    title: "Factures aux organismes en retard",
    theme: "warning",
    greeting: "Bonjour,",
    intro: `${data.items.length} facture(s) à des organismes sont impayées 30 jours après l’échéance. Les deux rappels automatiques sont partis ; la suite (appel, mise en demeure, radiation) est à décider par une personne.`,
    details: data.items.map((i, n) => ({ label: `#${n + 1}`, value: escapeHtml(describe(i)), stacked: true })),
    button: { text: "Voir les factures", url },
    branding,
  });
  const text = buildEmailText(["Factures aux organismes en retard", ...data.items.map(describe), url]);
  let sent = false;
  for (const to of adminEmails) {
    const ok = await sendEmail(
      { to, subject: `Factures aux organismes en retard (${data.items.length})`, html, text },
      "admin_organization_invoice_overdue",
    ).catch((e) => {
      console.error("sendAdminOrganizationInvoicesOverdue:", e);
      return false;
    });
    sent = sent || ok;
  }
  return sent;
}

/**
 * Spec 002: money from an organization a person must look at — an
 * overpayment, a payment on a void invoice, a refund, a chargeback. Nothing
 * was refunded automatically.
 */
export async function sendAdminOrganizationPaymentReview(data: {
  invoiceNumber: string;
  organizationName: string;
  kind: "overpaid" | "not_payable" | "refund" | "dispute" | "debit_failed";
  detail: string;
}): Promise<boolean> {
  await connectToDatabase();
  const adminEmails = await getAdminAlertRecipients();
  if (adminEmails.length === 0) {
    console.warn("[admin_organization_payment_review] No admin recipients — set adminAlertEmail.");
    return false;
  }
  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const url = `${base}/admin/dashboard/organization-invoices`;
  const heading = {
    overpaid: "Paiement en trop",
    not_payable: "Paiement sur une facture qui n’attendait rien",
    refund: "Remboursement enregistré",
    dispute: "Paiement contesté",
    debit_failed: "Débit préautorisé refusé",
  }[data.kind];
  const html = buildEmailHtml({
    title: `${heading} — ${escapeHtml(data.invoiceNumber)}`,
    theme: "warning",
    greeting: "Bonjour,",
    intro: escapeHtml(data.detail),
    details: [
      { label: "Facture", value: escapeHtml(data.invoiceNumber) },
      { label: "Organisme", value: escapeHtml(data.organizationName) },
    ],
    button: { text: "Voir les factures", url },
    branding,
  });
  const text = buildEmailText([`${heading} — ${data.invoiceNumber}`, data.organizationName, data.detail, url]);
  let sent = false;
  for (const to of adminEmails) {
    const ok = await sendEmail(
      { to, subject: `${heading} — ${data.invoiceNumber}`, html, text },
      "admin_organization_payment_review",
    ).catch((e) => {
      console.error("sendAdminOrganizationPaymentReview:", e);
      return false;
    });
    sent = sent || ok;
  }
  return sent;
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
  // « accept »: the request is still offered (first tab). « takeCharge »: it is
  // accepted and waits for its first date in « À planifier ».
  const dashboardUrl = `${process.env.NEXTAUTH_URL}${
    data.stage === "takeCharge"
      ? PROFESSIONAL_TO_SCHEDULE_PATH
      : "/professional/dashboard/proposals"
  }`;
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


// ---------------------------------------------------------------------------
// Professional rate-change proposals (spec 001 AC-22)
// ---------------------------------------------------------------------------

/**
 * Alert admins that a professional has requested a rate change.
 *
 * Body is French, like the other admin alerts — the admin mailbox is FR.
 * No PHI: a professional's name and their own rate, nothing about a client.
 */
export async function sendRateProposalSubmittedAlert(data: {
  professionalName: string;
  therapyTypeLabel: string;
  currentRate?: number;
  proposedRate: number;
  note?: string;
}): Promise<void> {
  await connectToDatabase();
  const emails = await getAdminAlertRecipients();
  if (emails.length === 0) {
    console.warn(
      "[rate_proposal_submitted] No admin emails — set ADMIN_ALERT_EMAIL or admin users.",
    );
    return;
  }

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const reviewUrl = `${base}/admin/dashboard/rate-proposals`;
  const branding = await getBranding();

  const current =
    typeof data.currentRate === "number" ? `${data.currentRate} $` : "non défini";

  const html = buildEmailHtml({
    title: "Demande de changement de tarif",
    subtitle: `${data.professionalName} — ${data.therapyTypeLabel}`,
    theme: "info",
    greeting: "",
    intro: `${data.professionalName} demande un changement de tarif pour une ${data.therapyTypeLabel.toLowerCase()}.`,
    infoBox: {
      title: "Détail de la demande",
      content: `Tarif actuel : ${current}\nTarif demandé : ${data.proposedRate} $${
        data.note ? `\n\nNote du professionnel : ${data.note}` : ""
      }`,
      theme: "info",
    },
    button: { text: "Examiner la demande", url: reviewUrl },
    outro:
      "Le tarif actuel reste en vigueur tant que la demande n'est pas acceptée. Accepter n'affecte que les nouveaux rendez-vous : les rendez-vous déjà pris conservent leur tarif jusqu'à une modification explicite.",
    branding,
    lang: "fr",
  });

  const text = buildEmailText(
    [
      "Demande de changement de tarif",
      `${data.professionalName} — ${data.therapyTypeLabel}`,
      `Tarif actuel : ${current}`,
      `Tarif demandé : ${data.proposedRate} $`,
      data.note ? `Note : ${data.note}` : "",
      `Examiner : ${reviewUrl}`,
    ],
    "fr",
  );

  for (const to of emails) {
    await sendEmail(
      { to, subject: `Demande de tarif — ${data.professionalName}`, html, text },
      "rate_proposal_submitted",
    );
  }
}

/**
 * Tell a professional their rate request was accepted or rejected.
 *
 * `lang` is threaded from the professional's own `language` so the decision
 * arrives in the language they use (FR-first, bilingual lockstep).
 */
export async function sendRateProposalDecisionEmail(data: {
  professionalName: string;
  professionalEmail: string;
  therapyTypeLabel: string;
  proposedRate: number;
  accepted: boolean;
  decisionNote?: string;
  locale?: string;
}): Promise<boolean> {
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const branding = await getBranding();
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const dashboardUrl = `${base}/professional/dashboard/profile`;

  const fr = {
    acceptedTitle: "Votre nouveau tarif est en vigueur",
    rejectedTitle: "Votre demande de tarif n'a pas été retenue",
    acceptedIntro: `Bonne nouvelle — votre demande de tarif de ${data.proposedRate} $ pour une ${data.therapyTypeLabel.toLowerCase()} a été acceptée.`,
    rejectedIntro: `Votre demande de tarif de ${data.proposedRate} $ pour une ${data.therapyTypeLabel.toLowerCase()} n'a pas été retenue.`,
    appliesTo:
      "Ce tarif s'applique aux nouveaux rendez-vous. Les rendez-vous déjà planifiés conservent le tarif convenu au moment de la réservation.",
    noteLabel: "Note de l'administration",
    cta: "Voir mon profil",
    outro: "Merci,\nL'équipe de Je chemine",
  };
  const en = {
    acceptedTitle: "Your new rate is in effect",
    rejectedTitle: "Your rate request was not approved",
    acceptedIntro: `Good news — your rate request of $${data.proposedRate} for a ${data.therapyTypeLabel.toLowerCase()} has been accepted.`,
    rejectedIntro: `Your rate request of $${data.proposedRate} for a ${data.therapyTypeLabel.toLowerCase()} was not approved.`,
    appliesTo:
      "This rate applies to new appointments. Already-scheduled appointments keep the rate agreed at booking.",
    noteLabel: "Note from the administration",
    cta: "View my profile",
    outro: "Thank you,\nThe Je chemine team",
  };
  const c = lang === "en" ? en : fr;

  const title = data.accepted ? c.acceptedTitle : c.rejectedTitle;
  const intro = data.accepted ? c.acceptedIntro : c.rejectedIntro;

  const html = buildEmailHtml({
    title,
    subtitle: data.therapyTypeLabel,
    theme: data.accepted ? "success" : "warning",
    greeting:
      lang === "en"
        ? `Hello ${data.professionalName},`
        : `Bonjour ${data.professionalName},`,
    intro,
    ...(data.decisionNote
      ? {
          infoBox: {
            title: c.noteLabel,
            content: data.decisionNote,
            theme: "info" as const,
          },
        }
      : {}),
    button: { text: c.cta, url: dashboardUrl },
    outro: data.accepted ? `${c.appliesTo}\n\n${c.outro}` : c.outro,
    branding,
    lang,
  });

  const text = buildEmailText(
    [
      title,
      intro,
      data.decisionNote ? `${c.noteLabel} : ${data.decisionNote}` : "",
      data.accepted ? c.appliesTo : "",
      `${c.cta} : ${dashboardUrl}`,
    ],
    lang,
  );

  return sendEmail(
    { to: data.professionalEmail, subject: title, html, text },
    "rate_proposal_decision",
  );
}

// =============================================================================
// Showcase pages (spec 003)
// =============================================================================

function showcaseAppUrl(path: string): string {
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return `${base}${path}`;
}

const SHOWCASE_DASHBOARD_PATH = "/professional/dashboard/showcase";

const SHOWCASE_SIGNATURE = {
  fr: "Merci,\nL'équipe de Je chemine",
  en: "Thank you,\nThe Je chemine team",
};

const SHOWCASE_FIELD_LABELS_FR: Readonly<Record<ShowcaseEditableField, string>> = {
  displayName: "nom affiché",
  headline: "phrase d'accroche",
  intro: "introduction",
  bio: "présentation",
  approach: "approche",
  city: "ville de la page",
  expertiseIds: "champs d'expertise",
  insuranceNote: "note sur les assurances",
  quote: "citation",
  highlights: "points forts",
  credentials: "parcours",
  focusAreas: "ce que j'accompagne",
  methods: "méthodes",
  photo: "photo",
  officePhotos: "photos du cabinet",
  texts: "titres et textes des sections",
  sectionOrder: "ordre des sections",
  hiddenSections: "sections affichées",
  accent: "couleur de la page",
};

/**
 * A professional changed their published showcase page; the change is already
 * online. French-only team alert, at most one per page per hour (the page's
 * history in the admin lists every change).
 */
export async function sendAdminShowcaseUpdatedAlert(data: {
  professionalName: string;
  professionalId: string;
  cityName: string;
  publicUrl: string;
  fields: readonly ShowcaseEditableField[];
}): Promise<void> {
  await connectToDatabase();
  const recipients = await getAdminAlertRecipients();
  if (recipients.length === 0) {
    console.warn("[sendAdminShowcaseUpdatedAlert] no admin recipients");
    return;
  }
  const branding = await getBranding();
  const url = showcaseAppUrl(`/admin/dashboard/showcases/${data.professionalId}`);
  const title = "Page vitrine modifiée par un professionnel";
  const changed = data.fields.map((field) => SHOWCASE_FIELD_LABELS_FR[field]).join(", ");
  const intro = `${data.professionalName} a modifié sa page vitrine. Les modifications sont déjà en ligne ; l'historique de la page les détaille.`;
  const html = buildEmailHtml({
    title,
    theme: "info",
    greeting: "Bonjour,",
    intro,
    details: [
      { label: "Professionnel", value: data.professionalName },
      { label: "Ville", value: data.cityName },
      { label: "Modifié", value: changed },
      { label: "Adresse", value: data.publicUrl, isLink: true },
    ],
    button: { text: "Voir la page dans l'administration", url },
    branding,
    lang: "fr",
  });
  const text = buildEmailText(
    [title, intro, `Modifié : ${changed}`, `Adresse : ${data.publicUrl}`, `Administration : ${url}`],
    "fr",
  );
  const subject = await getSubject("admin_showcase_updated", title);
  for (const to of recipients) {
    await sendEmail({ to, subject, html, text }, "admin_showcase_updated");
  }
}

/**
 * An admin published a professional's page, or corrections to it. Tells the
 * professional they can now edit the page themselves. While the showcase
 * pages are not open to the public yet (`live` false), the email sends them
 * to their dashboard rather than to an address that would only redirect.
 */
export async function sendShowcasePublishedEmail(data: {
  professionalName: string;
  professionalEmail: string;
  publicUrl: string;
  live: boolean;
  firstPublication: boolean;
  locale?: string;
}): Promise<boolean> {
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const branding = await getBranding();
  const dashboardUrl = showcaseAppUrl(SHOWCASE_DASHBOARD_PATH);
  const copy = {
    fr: {
      title: data.firstPublication
        ? "Votre page vitrine est publiée"
        : "Votre page vitrine a été mise à jour",
      greeting: `Bonjour ${data.professionalName},`,
      intro: data.firstPublication
        ? data.live
          ? "L'équipe Je chemine a préparé et publié votre page vitrine. Elle est en ligne : vous pouvez la partager dès maintenant."
          : "L'équipe Je chemine a préparé et publié votre page vitrine. Le public la verra dès l'ouverture des pages vitrines ; vous pouvez déjà la consulter et la modifier."
        : "L'équipe Je chemine a publié des corrections à votre page vitrine.",
      address: "Adresse",
      dashboard: "Modifier ma page",
      viewPage: "Voir ma page",
      outro: `Vous pouvez modifier votre texte, votre photo et vos champs d'expertise à tout moment depuis votre tableau de bord : vos modifications sont en ligne dès que vous les enregistrez. Vous pouvez aussi retirer votre page en un clic.\n\n${SHOWCASE_SIGNATURE.fr}`,
    },
    en: {
      title: data.firstPublication
        ? "Your showcase page is published"
        : "Your showcase page was updated",
      greeting: `Hello ${data.professionalName},`,
      intro: data.firstPublication
        ? data.live
          ? "The Je chemine team prepared and published your showcase page. It is online: you can share it right away."
          : "The Je chemine team prepared and published your showcase page. The public will see it once showcase pages open; you can already view and edit it."
        : "The Je chemine team published corrections to your showcase page.",
      address: "Address",
      dashboard: "Edit my page",
      viewPage: "View my page",
      outro: `You can change your text, your photo and your areas of expertise at any time from your dashboard: your changes are online as soon as you save them. You can also take your page down in one click.\n\n${SHOWCASE_SIGNATURE.en}`,
    },
  }[lang];

  const html = buildEmailHtml({
    title: copy.title,
    theme: "success",
    greeting: copy.greeting,
    intro: copy.intro,
    details: [
      ...(data.live ? [{ label: copy.address, value: data.publicUrl, isLink: true }] : []),
      { label: copy.dashboard, value: dashboardUrl, isLink: true },
    ],
    button: data.live
      ? { text: copy.viewPage, url: data.publicUrl }
      : { text: copy.dashboard, url: dashboardUrl },
    outro: copy.outro,
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      copy.title,
      copy.intro,
      ...(data.live ? [`${copy.address} : ${data.publicUrl}`] : []),
      `${copy.dashboard} : ${dashboardUrl}`,
      copy.outro,
    ],
    lang,
  );
  return sendEmail(
    { to: data.professionalEmail, subject: copy.title, html, text },
    "showcase_published",
  );
}

/** An admin took a professional's page off the site. */
export async function sendShowcaseUnpublishedEmail(data: {
  professionalName: string;
  professionalEmail: string;
  note?: string;
  locale?: string;
}): Promise<boolean> {
  const lang: "fr" | "en" = data.locale === "en" ? "en" : "fr";
  const branding = await getBranding();
  const url = showcaseAppUrl(SHOWCASE_DASHBOARD_PATH);
  const copy = {
    fr: {
      title: "Votre page vitrine est retirée",
      greeting: `Bonjour ${data.professionalName},`,
      intro:
        "Notre équipe a retiré votre page vitrine du site. Elle n'est plus visible par le public.",
      noteTitle: "Motif",
      cta: "Voir ma page vitrine",
      outro: `Pour toute question, répondez simplement à ce courriel.\n\n${SHOWCASE_SIGNATURE.fr}`,
    },
    en: {
      title: "Your showcase page was taken down",
      greeting: `Hello ${data.professionalName},`,
      intro:
        "Our team took your showcase page off the site. It is no longer visible to the public.",
      noteTitle: "Reason",
      cta: "Open my showcase page",
      outro: `If you have any question, simply reply to this email.\n\n${SHOWCASE_SIGNATURE.en}`,
    },
  }[lang];

  const html = buildEmailHtml({
    title: copy.title,
    theme: "warning",
    greeting: copy.greeting,
    intro: copy.intro,
    ...(data.note ? { infoBox: { title: copy.noteTitle, content: data.note, theme: "info" as const } } : {}),
    button: { text: copy.cta, url },
    outro: copy.outro,
    branding,
    lang,
  });
  const text = buildEmailText(
    [copy.title, copy.intro, data.note ? `${copy.noteTitle} : ${data.note}` : "", `${copy.cta} : ${url}`],
    lang,
  );
  return sendEmail(
    { to: data.professionalEmail, subject: copy.title, html, text },
    "showcase_unpublished",
  );
}

/* ------------------------------------------------------------------------ */
/* Direct requests from a showcase page (spec 003 phase 3)                   */
/* ------------------------------------------------------------------------ */

type DirectRequestServiceKey = "standard" | "quick";

const DIRECT_REQUEST_SERVICE_LABELS: Record<"fr" | "en", Record<DirectRequestServiceKey, string>> = {
  fr: { standard: "Consultation standard", quick: "Consultation ponctuelle rapide" },
  en: { standard: "Standard consultation", quick: "Quick one-time consultation" },
};

const DIRECT_REQUEST_DECLINE_LABELS_FR: Record<string, string> = {
  slot_unavailable: "Le créneau ne lui convient pas",
  not_a_fit: "La demande ne correspond pas à sa pratique",
  not_accepting: "N'accepte pas de nouveaux clients",
  other: "Autre raison",
};

const toEmailLang = (locale?: string | null): "fr" | "en" => (locale === "en" ? "en" : "fr");

/** A slot's Montréal day and time as stored: "jeudi 17 septembre 2026 à 10 h 00". */
function formatShowcaseSlot(dayKey: string, time: string, lang: "fr" | "en"): string {
  const at = new Date(`${dayKey}T${time}:00Z`);
  const tag = lang === "en" ? "en-CA" : "fr-CA";
  const day = new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(at);
  const clock = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(at);
  return lang === "en" ? `${day} at ${clock}` : `${day} à ${clock}`;
}

/** An instant as read in Montréal. */
function formatMontrealInstant(at: Date, lang: "fr" | "en"): string {
  const tag = lang === "en" ? "en-CA" : "fr-CA";
  const day = new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Toronto",
  }).format(at);
  const clock = new Intl.DateTimeFormat(tag, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  }).format(at);
  return lang === "en" ? `${day} at ${clock}` : `${day} à ${clock}`;
}

/**
 * A client asked the professional for one of their slots from the showcase
 * page. The slot is held until the professional answers. Names the client by
 * first name and initial only; the rest is on the dashboard.
 */
export async function sendDirectRequestReceivedEmail(data: {
  professionalName: string;
  professionalEmail: string;
  clientName: string;
  service: DirectRequestServiceKey;
  dayKey: string;
  time: string;
  respondBy: Date;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const url = showcaseAppUrl("/professional/dashboard/proposals");
  const slot = formatShowcaseSlot(data.dayKey, data.time, lang);
  const deadline = formatMontrealInstant(data.respondBy, lang);
  const service = DIRECT_REQUEST_SERVICE_LABELS[lang][data.service];
  const copy = {
    fr: {
      title: "Nouvelle demande de rendez-vous",
      greeting: `Bonjour ${data.professionalName},`,
      intro: `${data.clientName} a choisi un de vos créneaux sur votre page vitrine et vous demande un rendez-vous. Le créneau lui est réservé jusqu'à votre réponse.`,
      labels: { service: "Consultation", slot: "Créneau", deadline: "Répondre avant" },
      boxTitle: "Sans réponse",
      box: "Sans réponse avant l'échéance, la demande est retirée, le créneau est libéré et la personne en est avisée.",
      cta: "Répondre à la demande",
    },
    en: {
      title: "New appointment request",
      greeting: `Hello ${data.professionalName},`,
      intro: `${data.clientName} chose one of your times on your showcase page and is asking you for an appointment. The time is held for them until you answer.`,
      labels: { service: "Consultation", slot: "Time", deadline: "Answer before" },
      boxTitle: "Without an answer",
      box: "Without an answer by the deadline, the request is withdrawn, the time is freed and the person is told.",
      cta: "Answer the request",
    },
  }[lang];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "info",
    greeting: copy.greeting,
    intro: copy.intro,
    details: [
      { label: copy.labels.service, value: service },
      { label: copy.labels.slot, value: slot },
      { label: copy.labels.deadline, value: deadline },
    ],
    infoBox: { title: copy.boxTitle, content: copy.box, theme: "warning" },
    button: { text: copy.cta, url },
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  const text = buildEmailText(
    [copy.title, copy.intro, `${copy.labels.service} : ${service}`, `${copy.labels.slot} : ${slot}`, `${copy.labels.deadline} : ${deadline}`, `${copy.cta} : ${url}`],
    lang,
  );
  return sendEmail(
    { to: data.professionalEmail, subject: copy.title, html, text },
    "direct_request_received",
  );
}

/** The client's request went to the professional; the slot is held until they answer. */
export async function sendDirectRequestConfirmationEmail(data: {
  clientName: string;
  clientEmail: string;
  professionalName: string;
  service: DirectRequestServiceKey;
  dayKey: string;
  time: string;
  respondBy: Date;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const slot = formatShowcaseSlot(data.dayKey, data.time, lang);
  const deadline = formatMontrealInstant(data.respondBy, lang);
  const service = DIRECT_REQUEST_SERVICE_LABELS[lang][data.service];
  const copy = {
    fr: {
      title: "Votre demande de rendez-vous a été envoyée",
      greeting: `Bonjour ${data.clientName},`,
      intro: `Votre demande a été envoyée à ${data.professionalName}. Le créneau vous est réservé jusqu'à sa réponse, au plus tard le ${deadline}.`,
      labels: { professional: "Professionnel", service: "Consultation", slot: "Créneau" },
      boxTitle: "Et ensuite ?",
      box: `Dès que ${data.professionalName} confirme, vous recevez la confirmation du rendez-vous et les instructions de paiement. Rien ne vous est demandé avant. Si le créneau ne convient pas, vous pourrez en choisir un autre ou être jumelé avec un autre professionnel.`,
    },
    en: {
      title: "Your appointment request was sent",
      greeting: `Hello ${data.clientName},`,
      intro: `Your request was sent to ${data.professionalName}. The time is held for you until they answer, by ${deadline} at the latest.`,
      labels: { professional: "Professional", service: "Consultation", slot: "Time" },
      boxTitle: "What happens next?",
      box: `As soon as ${data.professionalName} confirms, you receive the appointment confirmation and the payment instructions. Nothing is asked of you before. If the time does not work, you will be able to choose another one or be matched with another professional.`,
    },
  }[lang];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "success",
    greeting: copy.greeting,
    intro: copy.intro,
    details: [
      { label: copy.labels.professional, value: data.professionalName },
      { label: copy.labels.service, value: service },
      { label: copy.labels.slot, value: slot },
    ],
    infoBox: { title: copy.boxTitle, content: copy.box, theme: "info" },
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  const text = buildEmailText(
    [copy.title, copy.intro, `${copy.labels.professional} : ${data.professionalName}`, `${copy.labels.service} : ${service}`, `${copy.labels.slot} : ${slot}`, copy.box],
    lang,
  );
  return sendEmail(
    { to: data.clientEmail, subject: copy.title, html, text },
    "direct_request_confirmation",
  );
}

/**
 * The professional declined, or did not answer in time. Two ways on: choose
 * another time on the page, or let Je chemine match the client (a link valid
 * 14 days). Never gives the professional's reason.
 */
export async function sendDirectRequestUnavailableEmail(data: {
  clientName: string;
  clientEmail: string;
  professionalName: string;
  outcome: "declined" | "expired";
  service: DirectRequestServiceKey;
  dayKey: string;
  time: string;
  pageUrl: string;
  rerouteUrl: string;
  locale?: string | null;
  /** The request came from the waitlist and the person keeps their place on it. */
  backOnWaitlist?: boolean;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const slot = formatShowcaseSlot(data.dayKey, data.time, lang);
  const waitlistFr = data.backOnWaitlist
    ? " Vous gardez votre place sur sa liste d'attente : nous vous écrirons dès qu'un autre créneau se libère."
    : "";
  const waitlistEn = data.backOnWaitlist
    ? " You keep your place on their waitlist: we will write to you as soon as another time opens up."
    : "";
  const copy = {
    fr: {
      title:
        data.outcome === "declined"
          ? "Ce créneau n'est pas disponible"
          : "Votre demande n'a pas reçu de réponse à temps",
      greeting: `Bonjour ${data.clientName},`,
      intro:
        data.outcome === "declined"
          ? `${data.professionalName} ne peut pas vous recevoir le ${slot}. Le créneau a été libéré.${waitlistFr}`
          : `${data.professionalName} n'a pas pu répondre à temps à votre demande pour le ${slot}. Le créneau a été libéré.`,
      cta: "Choisir un autre créneau",
      preamble: "Ou laissez Je chemine vous jumeler avec le professionnel qui vous convient :",
      secondary: "Être jumelé avec un professionnel",
      outro: `Ce lien de jumelage est valable 14 jours.\n\n${SHOWCASE_SIGNATURE.fr}`,
    },
    en: {
      title:
        data.outcome === "declined"
          ? "This time is not available"
          : "Your request was not answered in time",
      greeting: `Hello ${data.clientName},`,
      intro:
        data.outcome === "declined"
          ? `${data.professionalName} cannot see you on ${slot}. The time was freed.${waitlistEn}`
          : `${data.professionalName} could not answer your request for ${slot} in time. The time was freed.`,
      cta: "Choose another time",
      preamble: "Or let Je chemine match you with the professional who suits you:",
      secondary: "Get matched with a professional",
      outro: `The matching link is valid for 14 days.\n\n${SHOWCASE_SIGNATURE.en}`,
    },
  }[lang];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "info",
    greeting: copy.greeting,
    intro: copy.intro,
    details: [{ label: lang === "en" ? "Consultation" : "Consultation", value: DIRECT_REQUEST_SERVICE_LABELS[lang][data.service] }],
    button: { text: copy.cta, url: data.pageUrl },
    secondaryButton: { preamble: copy.preamble, text: copy.secondary, url: data.rerouteUrl },
    outro: copy.outro,
    branding,
    lang,
  });
  const text = buildEmailText(
    [copy.title, copy.intro, `${copy.cta} : ${data.pageUrl}`, `${copy.preamble} ${data.rerouteUrl}`],
    lang,
  );
  return sendEmail(
    { to: data.clientEmail, subject: copy.title, html, text },
    "direct_request_unavailable",
  );
}

/**
 * A direct request went to Je chemine's general list, as the client agreed when asking (spec 003
 * phase 3b). Nothing is asked of them: a professional's acceptance will be the next email. Sent
 * under the same type as the « unavailable » email, so the same switch governs both.
 */
export async function sendDirectRequestHandedOnEmail(data: {
  clientName: string;
  clientEmail: string;
  professionalName: string;
  outcome: "declined" | "expired";
  service: DirectRequestServiceKey;
  dayKey: string;
  time: string;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const slot = formatShowcaseSlot(data.dayKey, data.time, lang);
  const copy = {
    fr: {
      title: "Votre demande est transmise à notre liste générale",
      greeting: `Bonjour ${data.clientName},`,
      intro:
        (data.outcome === "declined"
          ? `${data.professionalName} ne peut pas vous recevoir le ${slot}.`
          : `${data.professionalName} n'a pas pu répondre à temps à votre demande pour le ${slot}.`) +
        " Comme vous l'avez accepté en faisant votre demande, nous la transmettons à notre liste générale : nous vous proposerons le professionnel disponible le plus rapidement.",
      outro: `Vous n'avez rien à faire : vous recevrez un courriel dès qu'un professionnel accepte votre demande.\n\n${SHOWCASE_SIGNATURE.fr}`,
    },
    en: {
      title: "Your request is going to our general list",
      greeting: `Hello ${data.clientName},`,
      intro:
        (data.outcome === "declined"
          ? `${data.professionalName} cannot see you on ${slot}.`
          : `${data.professionalName} could not answer your request for ${slot} in time.`) +
        " As you agreed when you asked, we are passing it to our general list: we will offer you the professional available soonest.",
      outro: `There is nothing you need to do: you will get an email as soon as a professional accepts your request.\n\n${SHOWCASE_SIGNATURE.en}`,
    },
  }[lang];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "info",
    greeting: copy.greeting,
    intro: copy.intro,
    details: [{ label: "Consultation", value: DIRECT_REQUEST_SERVICE_LABELS[lang][data.service] }],
    outro: copy.outro,
    branding,
    lang,
  });
  const text = buildEmailText([copy.title, copy.intro, copy.outro], lang);
  return sendEmail({ to: data.clientEmail, subject: copy.title, html, text }, "direct_request_unavailable");
}

/** A direct request came back to the service-request queue. French-only team alert. */
export async function sendAdminDirectRequestReturnedAlert(data: {
  outcome: "declined" | "expired";
  clientName: string;
  professionalName: string;
  service: DirectRequestServiceKey;
  dayKey: string;
  time: string;
  reason?: string | null;
  note?: string | null;
  /** Handed straight to matching, as the client agreed when asking (phase 3b). */
  handedToMatching?: boolean;
}): Promise<void> {
  await connectToDatabase();
  const recipients = await getAdminAlertRecipients();
  if (recipients.length === 0) {
    console.warn("[sendAdminDirectRequestReturnedAlert] no admin recipients");
    return;
  }
  const branding = await getBranding();
  const url = showcaseAppUrl("/admin/dashboard/service-requests");
  const title =
    data.outcome === "declined" ? "Demande directe déclinée" : "Demande directe sans réponse";
  const slot = formatShowcaseSlot(data.dayKey, data.time, "fr");
  const intro = data.handedToMatching
    ? `La demande de ${data.clientName} auprès de ${data.professionalName} pour le ${slot} a été transmise au jumelage, comme la personne l'avait accepté en la faisant. Elle en a été avertie par courriel.`
    : `La demande de ${data.clientName} auprès de ${data.professionalName} pour le ${slot} est revenue dans les demandes de service. La personne a reçu un courriel pour choisir un autre créneau ou être jumelée.`;
  const details = [
    { label: "Professionnel", value: data.professionalName },
    { label: "Client", value: data.clientName },
    { label: "Consultation", value: DIRECT_REQUEST_SERVICE_LABELS.fr[data.service] },
    { label: "Créneau", value: slot },
  ];
  if (data.outcome === "declined" && data.reason) {
    details.push({ label: "Motif", value: DIRECT_REQUEST_DECLINE_LABELS_FR[data.reason] ?? data.reason });
  }
  if (data.note) details.push({ label: "Note du professionnel", value: data.note });
  const html = buildEmailHtml({
    title,
    theme: "warning",
    greeting: "Bonjour,",
    intro,
    details,
    button: { text: "Voir les demandes de service", url },
    branding,
    lang: "fr",
  });
  const text = buildEmailText([title, intro, `Demandes de service : ${url}`], "fr");
  const subject = await getSubject("admin_direct_request_returned", title);
  for (const to of recipients) {
    await sendEmail({ to, subject, html, text }, "admin_direct_request_returned");
  }
}

/* ------------------------------------------------------------------------ */
/* A professional's waitlist (spec 003 phase 4)                              */
/* ------------------------------------------------------------------------ */

/** The person joined a professional's waitlist from the showcase page. Carries the link to leave it. */
export async function sendWaitlistJoinedEmail(data: {
  firstName: string;
  email: string;
  professionalName: string;
  service: DirectRequestServiceKey;
  sms: boolean;
  pageUrl: string;
  leaveUrl: string;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const service = DIRECT_REQUEST_SERVICE_LABELS[lang][data.service];
  const copy = {
    fr: {
      title: "Vous êtes sur la liste d'attente",
      greeting: `Bonjour ${data.firstName},`,
      intro: `Votre nom est sur la liste d'attente de ${data.professionalName}.`,
      service: "Consultation",
      boxTitle: "Et ensuite ?",
      box: `Dès qu'un créneau qui vous convient se libère, nous vous l'écrivons${data.sms ? ", par courriel et par texto" : ""}. Il vous est alors réservé 15 minutes : il suffit de le confirmer, puis ${data.professionalName} confirme le rendez-vous. Votre inscription dure 90 jours.`,
      cta: "Voir la page du professionnel",
      preamble: "Vous n'attendez plus ?",
      leave: "Quitter la liste d'attente",
    },
    en: {
      title: "You are on the waitlist",
      greeting: `Hello ${data.firstName},`,
      intro: `Your name is on ${data.professionalName}'s waitlist.`,
      service: "Consultation",
      boxTitle: "What happens next?",
      box: `As soon as a time that suits you opens up, we write to you${data.sms ? ", by email and text message" : ""}. It is then held for you for 15 minutes: you only need to confirm it, then ${data.professionalName} confirms the appointment. Your place lasts 90 days.`,
      cta: "View the professional's page",
      preamble: "No longer waiting?",
      leave: "Leave the waitlist",
    },
  }[lang];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "success",
    greeting: copy.greeting,
    intro: copy.intro,
    details: [{ label: copy.service, value: service }],
    infoBox: { title: copy.boxTitle, content: copy.box, theme: "info" },
    button: { text: copy.cta, url: data.pageUrl },
    secondaryButton: { preamble: copy.preamble, text: copy.leave, url: data.leaveUrl },
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  const text = buildEmailText(
    [copy.title, copy.intro, `${copy.service} : ${service}`, copy.box, `${copy.cta} : ${data.pageUrl}`, `${copy.leave} : ${data.leaveUrl}`],
    lang,
  );
  return sendEmail({ to: data.email, subject: copy.title, html, text }, "waitlist_joined");
}

/** A time freed up and is held 15 minutes for the person. Confirming makes a request the professional answers. */
export async function sendWaitlistOfferEmail(data: {
  firstName: string;
  email: string;
  professionalName: string;
  service: DirectRequestServiceKey;
  dayKey: string;
  time: string;
  durationMinutes: number;
  expiresAt: Date;
  claimUrl: string;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const slot = formatShowcaseSlot(data.dayKey, data.time, lang);
  const until = formatMontrealInstant(data.expiresAt, lang);
  const service = DIRECT_REQUEST_SERVICE_LABELS[lang][data.service];
  const copy = {
    fr: {
      title: "Un créneau s'est libéré",
      greeting: `Bonjour ${data.firstName},`,
      intro: `Un créneau avec ${data.professionalName} vient de se libérer. Il vous est réservé jusqu'au ${until}.`,
      labels: { service: "Consultation", slot: "Créneau", duration: "Durée" },
      duration: `${data.durationMinutes} minutes`,
      cta: "Réserver ce créneau",
      boxTitle: "Bon à savoir",
      box: `En le réservant, votre demande part à ${data.professionalName}, qui confirme le rendez-vous. Passé ce délai, le créneau est proposé à la personne suivante. S'il ne vous convient pas, ignorez ce courriel : vous restez sur la liste. Après trois créneaux restés sans réponse, l'inscription prend fin.`,
    },
    en: {
      title: "A time opened up",
      greeting: `Hello ${data.firstName},`,
      intro: `A time with ${data.professionalName} just opened up. It is held for you until ${until}.`,
      labels: { service: "Consultation", slot: "Time", duration: "Length" },
      duration: `${data.durationMinutes} minutes`,
      cta: "Book this time",
      boxTitle: "Good to know",
      box: `When you book it, your request goes to ${data.professionalName}, who confirms the appointment. After that, the time is offered to the next person. If it does not suit you, ignore this email: you stay on the list. After three times left unanswered, your place ends.`,
    },
  }[lang];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "success",
    greeting: copy.greeting,
    intro: copy.intro,
    details: [
      { label: copy.labels.service, value: service },
      { label: copy.labels.slot, value: slot },
      { label: copy.labels.duration, value: copy.duration },
    ],
    button: { text: copy.cta, url: data.claimUrl },
    infoBox: { title: copy.boxTitle, content: copy.box, theme: "info" },
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  const text = buildEmailText(
    [
      copy.title,
      copy.intro,
      `${copy.labels.service} : ${service}`,
      `${copy.labels.slot} : ${slot}`,
      `${copy.labels.duration} : ${copy.duration}`,
      `${copy.cta} : ${data.claimUrl}`,
      copy.box,
    ],
    lang,
  );
  return sendEmail({ to: data.email, subject: copy.title, html, text }, "waitlist_offer");
}

/**
 * The person's place on a waitlist ended: three offers left unanswered, 90
 * days passed, or the professional or the team removed it. Not sent when the
 * person leaves the list themselves.
 */
export async function sendWaitlistRemovedEmail(data: {
  firstName: string;
  email: string;
  professionalName: string;
  reason: "missed" | "expired" | "professional" | "admin";
  pageUrl: string;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const name = data.professionalName;
  const copy = {
    fr: {
      title: "Votre inscription à la liste d'attente a pris fin",
      greeting: `Bonjour ${data.firstName},`,
      intro: {
        missed: `Trois créneaux avec ${name} vous ont été proposés sans réponse : votre inscription à sa liste d'attente a donc pris fin.`,
        expired: `Votre inscription à la liste d'attente de ${name} a pris fin après 90 jours.`,
        professional: `Votre inscription à la liste d'attente de ${name} a été retirée.`,
        admin: `Votre inscription à la liste d'attente de ${name} a été retirée.`,
      }[data.reason],
      box: `Vous pouvez vous réinscrire depuis la page de ${name}, ou laisser Je chemine vous jumeler avec le professionnel qui vous convient.`,
      cta: "Voir la page du professionnel",
    },
    en: {
      title: "Your place on the waitlist ended",
      greeting: `Hello ${data.firstName},`,
      intro: {
        missed: `Three times with ${name} were offered to you without an answer, so your place on their waitlist ended.`,
        expired: `Your place on ${name}'s waitlist ended after 90 days.`,
        professional: `Your place on ${name}'s waitlist was removed.`,
        admin: `Your place on ${name}'s waitlist was removed.`,
      }[data.reason],
      box: `You can join again from ${name}'s page, or let Je chemine match you with the professional who suits you.`,
      cta: "View the professional's page",
    },
  }[lang];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "info",
    greeting: copy.greeting,
    intro: copy.intro,
    infoBox: { title: lang === "en" ? "What now?" : "Et maintenant ?", content: copy.box, theme: "info" },
    button: { text: copy.cta, url: data.pageUrl },
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  const text = buildEmailText([copy.title, copy.intro, copy.box, `${copy.cta} : ${data.pageUrl}`], lang);
  return sendEmail({ to: data.email, subject: copy.title, html, text }, "waitlist_removed");
}

/* ------------------------------------------------------------------------ */
/* Products professionals sell (spec 003 phase 5)                            */
/* ------------------------------------------------------------------------ */

const PRODUCTS_DASHBOARD_PATH = "/professional/dashboard/products";

function formatCents(cents: number, lang: "fr" | "en"): string {
  return new Intl.NumberFormat(lang === "en" ? "en-CA" : "fr-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

/** A product sold. Never names the buyer. */
export async function sendProductSoldEmail(data: {
  professionalName: string;
  professionalEmail: string;
  productTitle: string;
  amountCents: number;
  netCents: number;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const url = showcaseAppUrl(PRODUCTS_DASHBOARD_PATH);
  const copy = {
    fr: {
      title: "Vous avez fait une vente",
      greeting: `Bonjour ${data.professionalName},`,
      intro: `Une personne vient d'acheter « ${data.productTitle} ».`,
      labels: { price: "Prix payé", net: "Votre part" },
      box: "Votre part est portée à votre solde et vous est versée avec vos séances. Si l'achat est remboursé ou contesté, elle en est retirée.",
      cta: "Voir mes produits",
    },
    en: {
      title: "You made a sale",
      greeting: `Hello ${data.professionalName},`,
      intro: `Someone just bought “${data.productTitle}”.`,
      labels: { price: "Price paid", net: "Your share" },
      box: "Your share is added to your balance and paid out with your sessions. If the purchase is refunded or disputed, it is taken back.",
      cta: "View my products",
    },
  }[lang];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "success",
    greeting: copy.greeting,
    intro: copy.intro,
    details: [
      { label: copy.labels.price, value: formatCents(data.amountCents, lang) },
      { label: copy.labels.net, value: formatCents(data.netCents, lang) },
    ],
    infoBox: { title: lang === "en" ? "Payment" : "Versement", content: copy.box, theme: "info" },
    button: { text: copy.cta, url },
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  const text = buildEmailText(
    [copy.title, copy.intro, `${copy.labels.price} : ${formatCents(data.amountCents, lang)}`, `${copy.labels.net} : ${formatCents(data.netCents, lang)}`, copy.box, `${copy.cta} : ${url}`],
    lang,
  );
  return sendEmail({ to: data.professionalEmail, subject: copy.title, html, text }, "product_sold");
}

/** The team approved, rejected or took down a professional's product. */
export async function sendProductModerationDecisionEmail(data: {
  professionalName: string;
  professionalEmail: string;
  productTitle: string;
  decision: "approved" | "rejected" | "unpublished";
  notes: string | null;
  productUrl: string | null;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const dashboardUrl = showcaseAppUrl(PRODUCTS_DASHBOARD_PATH);
  const title = data.productTitle;
  const copy = {
    fr: {
      title: {
        approved: "Votre produit est en ligne",
        rejected: "Quelques modifications à votre produit",
        unpublished: "Votre produit est retiré",
      }[data.decision],
      intro: {
        approved: `« ${title} » est approuvé et en vente.`,
        rejected: `Notre équipe a relu « ${title} » et vous demande quelques modifications avant de le mettre en vente.`,
        unpublished: `Notre équipe a retiré « ${title} » de la vente. Les personnes qui l'ont acheté y gardent accès.`,
      }[data.decision],
      notes: "Commentaires de l'équipe",
      view: "Voir le produit",
      dashboard: "Voir mes produits",
    },
    en: {
      title: {
        approved: "Your product is online",
        rejected: "A few changes to your product",
        unpublished: "Your product was taken down",
      }[data.decision],
      intro: {
        approved: `“${title}” is approved and on sale.`,
        rejected: `Our team reviewed “${title}” and asks for a few changes before putting it on sale.`,
        unpublished: `Our team took “${title}” off sale. People who bought it keep their access.`,
      }[data.decision],
      notes: "Comments from the team",
      view: "View the product",
      dashboard: "View my products",
    },
  }[lang];
  const button =
    data.decision === "approved" && data.productUrl
      ? { text: copy.view, url: data.productUrl }
      : { text: copy.dashboard, url: dashboardUrl };
  const html = buildEmailHtml({
    title: copy.title,
    theme: data.decision === "approved" ? "success" : "warning",
    greeting: lang === "en" ? `Hello ${data.professionalName},` : `Bonjour ${data.professionalName},`,
    intro: copy.intro,
    ...(data.notes ? { infoBox: { title: copy.notes, content: data.notes, theme: "warning" as const } } : {}),
    button,
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  const text = buildEmailText(
    [copy.title, copy.intro, data.notes ? `${copy.notes} :\n${data.notes}` : "", `${button.text} : ${button.url}`],
    lang,
  );
  return sendEmail({ to: data.professionalEmail, subject: copy.title, html, text }, "product_moderation_decision");
}

/** A professional sent a product for review. French-only team alert. */
export async function sendAdminProductSubmittedAlert(data: {
  professionalName: string;
  productTitle: string;
  slug: string;
}): Promise<void> {
  await connectToDatabase();
  const recipients = await getAdminAlertRecipients();
  if (recipients.length === 0) {
    console.warn("[sendAdminProductSubmittedAlert] no admin recipients");
    return;
  }
  const branding = await getBranding();
  const url = showcaseAppUrl("/admin/dashboard/products");
  const title = "Produit à vérifier";
  const intro = `${data.professionalName} a envoyé « ${data.productTitle} » pour vérification. Il n'est mis en vente qu'après votre approbation.`;
  const html = buildEmailHtml({
    title,
    theme: "info",
    greeting: "Bonjour,",
    intro,
    details: [
      { label: "Professionnel", value: data.professionalName },
      { label: "Produit", value: data.productTitle },
    ],
    button: { text: "Vérifier le produit", url },
    branding,
    lang: "fr",
  });
  const text = buildEmailText([title, intro, `Vérifier le produit : ${url}`], "fr");
  const subject = await getSubject("admin_product_submitted", title);
  for (const to of recipients) {
    await sendEmail({ to, subject, html, text }, "admin_product_submitted");
  }
}

/** The team's decision on one of a professional's articles (approved, sent back with notes, taken down). */
export async function sendArticleModerationDecisionEmail(data: {
  professionalName: string;
  professionalEmail: string;
  articleTitle: string;
  decision: "approved" | "rejected" | "unpublished";
  notes: string | null;
  articleUrl: string | null;
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const dashboardUrl = showcaseAppUrl("/professional/dashboard/articles");
  const title = data.articleTitle;
  const copy = {
    fr: {
      title: {
        approved: "Votre article est en ligne",
        rejected: "Quelques modifications à votre article",
        unpublished: "Votre article est retiré",
      }[data.decision],
      intro: {
        approved: `« ${title} » est approuvé et publié sur votre page.`,
        rejected: `Notre équipe a relu « ${title} » et vous demande quelques modifications avant de le publier.`,
        unpublished: `Notre équipe a retiré « ${title} » de votre page.`,
      }[data.decision],
      notes: "Commentaires de l'équipe",
      view: "Voir l'article",
      dashboard: "Voir mes articles",
    },
    en: {
      title: {
        approved: "Your article is online",
        rejected: "A few changes to your article",
        unpublished: "Your article was taken down",
      }[data.decision],
      intro: {
        approved: `“${title}” is approved and published on your page.`,
        rejected: `Our team reviewed “${title}” and asks for a few changes before publishing it.`,
        unpublished: `Our team took “${title}” off your page.`,
      }[data.decision],
      notes: "Comments from the team",
      view: "View the article",
      dashboard: "View my articles",
    },
  }[lang];
  const button =
    data.decision === "approved" && data.articleUrl
      ? { text: copy.view, url: data.articleUrl }
      : { text: copy.dashboard, url: dashboardUrl };
  const html = buildEmailHtml({
    title: copy.title,
    theme: data.decision === "approved" ? "success" : "warning",
    greeting: lang === "en" ? `Hello ${data.professionalName},` : `Bonjour ${data.professionalName},`,
    intro: copy.intro,
    ...(data.notes ? { infoBox: { title: copy.notes, content: data.notes, theme: "warning" as const } } : {}),
    button,
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  const text = buildEmailText(
    [copy.title, copy.intro, data.notes ? `${copy.notes} :\n${data.notes}` : "", `${button.text} : ${button.url}`],
    lang,
  );
  return sendEmail({ to: data.professionalEmail, subject: copy.title, html, text }, "article_moderation_decision");
}

/**
 * The refund of a cancelled, card-paid session did not go through: Stripe refused it, or did not
 * confirm it (lib/appointment-refund.ts). The cancellation stands; the client may still be owed the
 * money. French-only team alert.
 */
export async function sendAdminAppointmentRefundProblemAlert(data: {
  appointmentId: string;
  clientName: string;
  professionalName: string;
  amountCents: number;
  outcome: "refused" | "unconfirmed";
  message: string | null;
}): Promise<void> {
  await connectToDatabase();
  const recipients = await getAdminAlertRecipients();
  if (recipients.length === 0) {
    console.warn("[sendAdminAppointmentRefundProblemAlert] no admin recipients");
    return;
  }
  const branding = await getBranding();
  const amount = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(data.amountCents / 100);
  const title = data.outcome === "refused" ? "Remboursement refusé par Stripe" : "Remboursement non confirmé par Stripe";
  const intro =
    data.outcome === "refused"
      ? `Le remboursement de ${amount} pour la séance annulée de ${data.clientName} n'a pas été fait : Stripe l'a refusé. La séance reste annulée, mais le client n'a pas été remboursé.`
      : `Stripe n'a pas confirmé le remboursement de ${amount} pour la séance annulée de ${data.clientName}. Vérifiez le paiement dans Stripe avant de faire quoi que ce soit : une nouvelle tentative vérifie d'abord Stripe et ne rembourse jamais deux fois.`;
  const details = [
    { label: "Client", value: data.clientName },
    ...(data.professionalName ? [{ label: "Professionnel", value: data.professionalName }] : []),
    { label: "Montant", value: amount },
    { label: "Rendez-vous", value: data.appointmentId },
    ...(data.message ? [{ label: "Réponse de Stripe", value: data.message }] : []),
  ];
  const url = "https://dashboard.stripe.com/payments";
  const html = buildEmailHtml({
    title,
    theme: "warning",
    greeting: "Bonjour,",
    intro,
    details,
    button: { text: "Ouvrir Stripe", url },
    branding,
    lang: "fr",
  });
  const text = buildEmailText([title, intro, ...details.map((d) => `${d.label} : ${d.value}`), `Ouvrir Stripe : ${url}`], "fr");
  const subject = await getSubject("admin_appointment_refund_problem", title);
  for (const to of recipients) {
    await sendEmail({ to, subject, html, text }, "admin_appointment_refund_problem");
  }
}

/** A professional sent an article for review. French-only team alert. */
export async function sendAdminArticleSubmittedAlert(data: {
  professionalName: string;
  articleTitle: string;
  slug: string;
}): Promise<void> {
  await connectToDatabase();
  const recipients = await getAdminAlertRecipients();
  if (recipients.length === 0) {
    console.warn("[sendAdminArticleSubmittedAlert] no admin recipients");
    return;
  }
  const branding = await getBranding();
  const url = showcaseAppUrl("/admin/dashboard/articles");
  const title = "Article à vérifier";
  const intro = `${data.professionalName} a envoyé « ${data.articleTitle} » pour vérification. Il n'est publié qu'après votre approbation.`;
  const html = buildEmailHtml({
    title,
    theme: "info",
    greeting: "Bonjour,",
    intro,
    details: [
      { label: "Professionnel", value: data.professionalName },
      { label: "Article", value: data.articleTitle },
    ],
    button: { text: "Vérifier l'article", url },
    branding,
    lang: "fr",
  });
  const text = buildEmailText([title, intro, `Vérifier l'article : ${url}`], "fr");
  const subject = await getSubject("admin_article_submitted", title);
  for (const to of recipients) {
    await sendEmail({ to, subject, html, text }, "admin_article_submitted");
  }
}

/**
 * A webinar someone bought starts within a day, or within the hour. Links to
 * the webinar's page, where the room link is — never to the room itself — so
 * a refund or a new room link is honoured. A guest's link carries their access
 * token, like the purchase email.
 */
export async function sendProductWebinarReminderEmail(data: {
  buyerEmail: string;
  buyerName?: string;
  productTitle: string;
  professionalName: string;
  startsAt: Date;
  durationMinutes: number | null;
  accessUrl: string;
  /** The link carries a guest's access token. */
  personalLink: boolean;
  reminder: "day" | "hour";
  locale?: string | null;
}): Promise<boolean> {
  const lang = toEmailLang(data.locale);
  const branding = await getBranding();
  const when = formatMontrealInstant(data.startsAt, lang);
  const name = data.buyerName?.trim();
  const title = data.productTitle;
  const pro = data.professionalName;
  const copy = {
    fr: {
      title: data.reminder === "day" ? "Votre webinaire approche" : "Votre webinaire commence bientôt",
      greeting: name ? `Bonjour ${name},` : "Bonjour,",
      intro:
        data.reminder === "day"
          ? `Petit rappel : « ${title} », avec ${pro}, a lieu le ${when} (heure de Montréal).`
          : `« ${title} », avec ${pro}, commence dans moins d'une heure : le ${when} (heure de Montréal).`,
      labels: { webinar: "Webinaire", when: "Date et heure", length: "Durée", with: "Avec" },
      whenValue: `${when} (heure de Montréal)`,
      boxTitle: "Rejoindre la salle",
      box: data.personalLink
        ? "Le bouton ouvre la page du webinaire, où se trouve le lien de la salle. Ce lien vous est personnel : ne le transférez pas."
        : "Le bouton ouvre la page du webinaire, où se trouve le lien de la salle. Connectez-vous avec cette adresse courriel si on vous le demande.",
      cta: "Accéder au webinaire",
    },
    en: {
      title: data.reminder === "day" ? "Your webinar is coming up" : "Your webinar starts soon",
      greeting: name ? `Hello ${name},` : "Hello,",
      intro:
        data.reminder === "day"
          ? `A quick reminder: “${title}”, with ${pro}, takes place on ${when} (Montréal time).`
          : `“${title}”, with ${pro}, starts in less than an hour: ${when} (Montréal time).`,
      labels: { webinar: "Webinar", when: "Date and time", length: "Length", with: "With" },
      whenValue: `${when} (Montréal time)`,
      boxTitle: "Joining the room",
      box: data.personalLink
        ? "The button opens the webinar's page, where the room link is. This link is personal: please don't forward it."
        : "The button opens the webinar's page, where the room link is. Sign in with this email address if asked.",
      cta: "Go to the webinar",
    },
  }[lang];
  const details = [
    { label: copy.labels.webinar, value: title },
    { label: copy.labels.when, value: copy.whenValue },
    ...(data.durationMinutes ? [{ label: copy.labels.length, value: `${data.durationMinutes} minutes` }] : []),
    { label: copy.labels.with, value: pro },
  ];
  const html = buildEmailHtml({
    title: copy.title,
    theme: "info",
    greeting: copy.greeting,
    intro: copy.intro,
    details,
    infoBox: { title: copy.boxTitle, content: copy.box, theme: "info" },
    button: { text: copy.cta, url: data.accessUrl },
    outro: SHOWCASE_SIGNATURE[lang],
    branding,
    lang,
  });
  // French puts a space before the colon; English does not.
  const colon = lang === "en" ? ":" : " :";
  const text = buildEmailText(
    [
      copy.title,
      copy.greeting,
      copy.intro,
      ...details.map((detail) => `${detail.label}${colon} ${detail.value}`),
      copy.box,
      `${copy.cta}${colon} ${data.accessUrl}`,
    ],
    lang,
  );
  return sendEmail(
    { to: data.buyerEmail, subject: `${copy.title} — ${title}`, html, text },
    "product_webinar_reminder",
  );
}

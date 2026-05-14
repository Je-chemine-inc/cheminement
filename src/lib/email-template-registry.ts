import type { Types } from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import EmailTemplate, {
  EmailTemplateKey,
  EmailTemplateLocale,
  IEmailTemplate,
} from "@/models/EmailTemplate";

/**
 * Definition of an admin-editable email template:
 *  - which placeholders may appear in subject/title/body
 *  - the bilingual fallback content used when the DB row is missing
 *    (also used to seed the DB on first read so the admin sees the
 *     same wording currently shipped in production).
 */

export interface EmailPlaceholder {
  /** Token inserted in templates as {{key}}. */
  key: string;
  labelFr: string;
  labelEn: string;
  /** Sample value rendered in the editor preview. */
  sampleFr: string;
  sampleEn: string;
}

export interface EmailTemplateSeed {
  subject: string;
  title: string;
  subtitle?: string;
  bodyHtml: string;
  ctaText?: string;
}

export interface EmailTemplateDefinition {
  key: EmailTemplateKey;
  labelFr: string;
  labelEn: string;
  descriptionFr: string;
  descriptionEn: string;
  placeholders: EmailPlaceholder[];
  defaults: Record<EmailTemplateLocale, EmailTemplateSeed>;
}

// ---------------------------------------------------------------------------
// Welcome — Client
// ---------------------------------------------------------------------------

const welcomeClient: EmailTemplateDefinition = {
  key: "welcomeClient",
  labelFr: "Bienvenue — client",
  labelEn: "Welcome — client",
  descriptionFr:
    "Envoyé au client après la vérification de son compte (2FA). Première impression sur la plateforme.",
  descriptionEn:
    "Sent to clients after they complete account verification (2FA). First impression on the platform.",
  placeholders: [
    {
      key: "firstName",
      labelFr: "Prénom du client",
      labelEn: "Client first name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "dashboardUrl",
      labelFr: "Lien vers le tableau de bord",
      labelEn: "Dashboard link",
      sampleFr: "https://jechemine.ca/client/dashboard",
      sampleEn: "https://jechemine.ca/client/dashboard",
    },
    {
      key: "companyName",
      labelFr: "Nom de la plateforme",
      labelEn: "Platform name",
      sampleFr: "Je chemine",
      sampleEn: "Je chemine",
    },
    {
      key: "supportEmail",
      labelFr: "Courriel de soutien",
      labelEn: "Support email",
      sampleFr: "support@jechemine.ca",
      sampleEn: "support@jechemine.ca",
    },
  ],
  defaults: {
    fr: {
      subject: "Bienvenue sur {{companyName}} !",
      title: "Bienvenue !",
      subtitle: "Vous avez rejoint {{companyName}}",
      bodyHtml:
        "<p>Bonjour {{firstName}},</p>" +
        "<p>Merci d'avoir créé votre compte. Vous pouvez maintenant consulter les professionnels, réserver des rendez-vous et accéder aux ressources pour soutenir votre parcours de mieux-être.</p>" +
        "<p>Si vous avez des questions, n'hésitez pas à contacter notre équipe de soutien à <a href=\"mailto:{{supportEmail}}\">{{supportEmail}}</a>.</p>",
      ctaText: "Accéder au tableau de bord",
    },
    en: {
      subject: "Welcome to {{companyName}}!",
      title: "Welcome!",
      subtitle: "You have joined {{companyName}}",
      bodyHtml:
        "<p>Hello {{firstName}},</p>" +
        "<p>Thank you for creating your account. You can now consult professionals, book appointments and access resources to support your wellness journey.</p>" +
        "<p>If you have questions, feel free to contact our support team at <a href=\"mailto:{{supportEmail}}\">{{supportEmail}}</a>.</p>",
      ctaText: "Go to my dashboard",
    },
  },
};

// ---------------------------------------------------------------------------
// Welcome — Professional
// ---------------------------------------------------------------------------

const welcomeProfessional: EmailTemplateDefinition = {
  key: "welcomeProfessional",
  labelFr: "Bienvenue — professionnel",
  labelEn: "Welcome — professional",
  descriptionFr:
    "Envoyé une fois que le professionnel a complété son profil. Annonce que l'administration prendra contact pour finaliser l'activation.",
  descriptionEn:
    "Sent once the professional has completed their profile. Announces that the admin team will reach out to finalize activation.",
  placeholders: [
    {
      key: "firstName",
      labelFr: "Prénom du professionnel",
      labelEn: "Professional first name",
      sampleFr: "Camille",
      sampleEn: "Camille",
    },
    {
      key: "dashboardUrl",
      labelFr: "Lien vers le tableau de bord",
      labelEn: "Dashboard link",
      sampleFr: "https://jechemine.ca/professional/dashboard",
      sampleEn: "https://jechemine.ca/professional/dashboard",
    },
    {
      key: "companyName",
      labelFr: "Nom de la plateforme",
      labelEn: "Platform name",
      sampleFr: "Je chemine",
      sampleEn: "Je chemine",
    },
    {
      key: "supportEmail",
      labelFr: "Courriel de soutien",
      labelEn: "Support email",
      sampleFr: "support@jechemine.ca",
      sampleEn: "support@jechemine.ca",
    },
  ],
  defaults: {
    fr: {
      subject: "Bienvenue dans l'équipe Je chemine !",
      title: "Bienvenue dans l'équipe Je chemine !",
      subtitle:
        "Profil complété — un administrateur prendra contact avec vous",
      bodyHtml:
        "<p>Bonjour {{firstName}},</p>" +
        "<p>C'est un réel plaisir de vous compter parmi nos nouveaux collaborateurs ! Votre expertise est une valeur précieuse pour notre communauté, et nous avons hâte de vous voir accompagner vos futurs clients via la plateforme {{companyName}}.</p>" +
        "<h3>Prochaine étape : activation de votre compte</h3>" +
        "<p>Pour garantir la qualité de notre réseau et assurer une expérience optimale pour tous, un administrateur communiquera avec vous très bientôt. Cet échange rapide permettra de valider les derniers détails et de rendre votre profil officiellement actif sur la plateforme afin que vous puissiez commencer à recevoir des demandes.</p>" +
        "<p>Un profil évolutif que vous pouvez modifier à votre guise — vous pourrez l'ajuster, l'enrichir ou modifier vos disponibilités en tout temps, même une fois votre compte activé.</p>" +
        "<p>Chaleureusement,<br>L'équipe de {{companyName}}</p>",
      ctaText: "Accéder au tableau de bord",
    },
    en: {
      subject: "Welcome to the Je chemine team!",
      title: "Welcome to the Je chemine team!",
      subtitle: "Profile completed — an admin will reach out to you shortly",
      bodyHtml:
        "<p>Hello {{firstName}},</p>" +
        "<p>It is a real pleasure to welcome you among our new collaborators! Your expertise is a precious asset for our community, and we look forward to seeing you support your future clients through the {{companyName}} platform.</p>" +
        "<h3>Next step: activating your account</h3>" +
        "<p>To guarantee the quality of our network and ensure an optimal experience for everyone, an administrator will contact you very soon. This short exchange will validate the final details and make your profile officially active on the platform so you can start receiving requests.</p>" +
        "<p>An evolving profile you can modify at your convenience — you can adjust it, enrich it, or update your availability at any time, even after your account is activated.</p>" +
        "<p>Warmly,<br>The {{companyName}} team</p>",
      ctaText: "Go to my dashboard",
    },
  },
};

// ---------------------------------------------------------------------------
// Jumelage — match successful
// ---------------------------------------------------------------------------

const jumelageSuccess: EmailTemplateDefinition = {
  key: "jumelageSuccess",
  labelFr: "Jumelage réussi",
  labelEn: "Match successful",
  descriptionFr:
    "Envoyé au client dès qu'un professionnel accepte sa demande. Invite le client à configurer son mode de paiement.",
  descriptionEn:
    "Sent to the client as soon as a professional accepts their request. Invites the client to set up their payment method.",
  placeholders: [
    {
      key: "firstName",
      labelFr: "Prénom du client",
      labelEn: "Client first name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "professionalName",
      labelFr: "Nom du professionnel assigné",
      labelEn: "Assigned professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
    {
      key: "billingUrl",
      labelFr: "Lien vers la page de paiement",
      labelEn: "Payment page link",
      sampleFr:
        "https://jechemine.ca/client/dashboard/billing?action=addPaymentMethod",
      sampleEn:
        "https://jechemine.ca/client/dashboard/billing?action=addPaymentMethod",
    },
    {
      key: "completeAccountUrl",
      labelFr: "Lien pour compléter le compte (optionnel)",
      labelEn: "Complete-account link (optional)",
      sampleFr: "https://jechemine.ca/signup/member?...",
      sampleEn: "https://jechemine.ca/signup/member?...",
    },
    {
      key: "companyName",
      labelFr: "Nom de la plateforme",
      labelEn: "Platform name",
      sampleFr: "Je chemine",
      sampleEn: "Je chemine",
    },
    {
      key: "supportEmail",
      labelFr: "Courriel de soutien",
      labelEn: "Support email",
      sampleFr: "support@jechemine.ca",
      sampleEn: "support@jechemine.ca",
    },
  ],
  defaults: {
    fr: {
      subject: "Jumelage réussi — configurez votre mode de paiement",
      title: "Jumelage réussi — Configurez votre paiement",
      subtitle: "Professionnel assigné : {{professionalName}}",
      bodyHtml:
        "<p>Bonjour {{firstName}},</p>" +
        "<p>Votre demande a été acceptée par un professionnel. Pour confirmer votre rendez-vous, veuillez choisir votre mode de paiement : carte de crédit (Stripe) ou virement Interac.</p>" +
        "<h3>Modes de paiement disponibles</h3>" +
        "<p><strong>Carte de crédit :</strong> vos données sont sécurisées par Stripe. Votre carte sera validée et aucun montant n'est prélevé avant la séance.</p>" +
        "<p><strong>Virement Interac :</strong> choisissez cette option si vous préférez payer par courriel Interac. L'administration validera votre dossier.</p>" +
        "<p>Si vous avez des questions, contactez notre équipe à <a href=\"mailto:{{supportEmail}}\">{{supportEmail}}</a>.</p>",
      ctaText: "Choisir mon mode de paiement",
    },
    en: {
      subject: "Match successful — set up your payment method",
      title: "Match successful — Set up your payment",
      subtitle: "Professional assigned: {{professionalName}}",
      bodyHtml:
        "<p>Hello {{firstName}},</p>" +
        "<p>Your request has been accepted by a professional. To confirm your appointment, please choose your payment method: credit card (Stripe) or Interac e-Transfer.</p>" +
        "<h3>Available payment methods</h3>" +
        "<p><strong>Credit card:</strong> your data is secured by Stripe. Your card is validated and nothing is charged before the session.</p>" +
        "<p><strong>Interac e-Transfer:</strong> choose this option if you prefer to pay by Interac email transfer. Admin will validate your file.</p>" +
        "<p>If you have questions, contact our team at <a href=\"mailto:{{supportEmail}}\">{{supportEmail}}</a>.</p>",
      ctaText: "Choose my payment method",
    },
  },
};

export const EMAIL_TEMPLATE_DEFINITIONS: EmailTemplateDefinition[] = [
  welcomeClient,
  welcomeProfessional,
  jumelageSuccess,
];

export function getDefinition(
  key: EmailTemplateKey,
): EmailTemplateDefinition | undefined {
  return EMAIL_TEMPLATE_DEFINITIONS.find((d) => d.key === key);
}

// ---------------------------------------------------------------------------
// Render — substitute {{placeholder}} tokens.
// Only keys defined in the registry are substituted; unknown tokens are left
// untouched (so an admin typo doesn't silently render an empty string).
// ---------------------------------------------------------------------------

export function renderTemplate(
  source: string,
  vars: Record<string, string | undefined>,
): string {
  if (!source) return "";
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key) => {
    const value = vars[key];
    return value === undefined ? full : value;
  });
}

// ---------------------------------------------------------------------------
// DB getters with auto-seed.
// ---------------------------------------------------------------------------

export async function ensureEmailTemplateSeeded(
  key: EmailTemplateKey,
  locale: EmailTemplateLocale,
): Promise<IEmailTemplate> {
  await connectToDatabase();
  const existing = await EmailTemplate.findOne({ templateKey: key, locale });
  if (existing) return existing;

  const def = getDefinition(key);
  if (!def) {
    throw new Error(`Unknown email template key "${key}"`);
  }
  const seed = def.defaults[locale];

  const doc = await EmailTemplate.findOneAndUpdate(
    { templateKey: key, locale },
    {
      $setOnInsert: {
        templateKey: key,
        locale,
        subject: seed.subject,
        title: seed.title,
        subtitle: seed.subtitle,
        bodyHtml: seed.bodyHtml,
        ctaText: seed.ctaText,
      },
    },
    { upsert: true, new: true },
  );
  return doc!;
}

export interface ResolvedEmailTemplate {
  id: string;
  templateKey: EmailTemplateKey;
  locale: EmailTemplateLocale;
  subject: string;
  title: string;
  subtitle?: string;
  bodyHtml: string;
  ctaText?: string;
  updatedAt: Date;
}

function toDTO(doc: IEmailTemplate): ResolvedEmailTemplate {
  return {
    id: (doc._id as Types.ObjectId).toString(),
    templateKey: doc.templateKey,
    locale: doc.locale,
    subject: doc.subject,
    title: doc.title,
    subtitle: doc.subtitle,
    bodyHtml: doc.bodyHtml,
    ctaText: doc.ctaText,
    updatedAt: doc.updatedAt,
  };
}

export async function getEmailTemplate(
  key: EmailTemplateKey,
  locale: EmailTemplateLocale,
): Promise<ResolvedEmailTemplate> {
  const doc = await ensureEmailTemplateSeeded(key, locale);
  return toDTO(doc);
}

export async function listEmailTemplates(): Promise<ResolvedEmailTemplate[]> {
  const results: ResolvedEmailTemplate[] = [];
  for (const def of EMAIL_TEMPLATE_DEFINITIONS) {
    for (const locale of ["fr", "en"] as const) {
      const doc = await ensureEmailTemplateSeeded(def.key, locale);
      results.push(toDTO(doc));
    }
  }
  return results;
}

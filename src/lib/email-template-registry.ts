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
    "Envoyé au client dès qu'un professionnel accepte sa demande (jumelage réussi). Le mode de paiement se configure plus tard, à la confirmation du 1er rendez-vous. Le bouton « Compléter mon compte » n'apparaît que pour les comptes non finalisés.",
  descriptionEn:
    "Sent to the client as soon as a professional accepts their request (match successful). Payment method is set up later, when the first appointment is confirmed. The “Complete my account” button only appears for unfinished accounts.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Prénom du client",
      labelEn: "Client first name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "professionalName",
      labelFr: "Nom du professionnel (si assigné)",
      labelEn: "Professional name (if assigned)",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
  ],
  defaults: {
    fr: {
      subject: "Jumelage réussi — un professionnel a accepté votre demande",
      title: "Jumelage réussi !",
      subtitle:
        "{{#professionalName}}Professionnel assigné : {{professionalName}}{{/professionalName}}{{^professionalName}}Un professionnel a accepté votre demande{{/professionalName}}",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Bonne nouvelle : un professionnel a accepté votre demande. Il communiquera bientôt avec vous pour convenir ensemble de la date de votre premier rendez-vous.</p>" +
        "<p><strong>Prochaines étapes</strong><br>Dès que la date de votre premier rendez-vous sera fixée avec votre professionnel, vous recevrez un courriel de confirmation. C'est à ce moment que vous pourrez configurer votre mode de paiement — rien n'est requis pour l'instant.</p>" +
        "<p>Si vous avez des questions, contactez notre équipe depuis votre tableau de bord.</p>",
      ctaText: "Compléter mon compte",
    },
    en: {
      subject: "You've been matched — a professional accepted your request",
      title: "You've been matched!",
      subtitle:
        "{{#professionalName}}Professional assigned: {{professionalName}}{{/professionalName}}{{^professionalName}}A professional has accepted your request{{/professionalName}}",
      bodyHtml:
        "<p>Dear {{clientName}},</p>" +
        "<p>Good news: a professional has accepted your request. They will reach out to you shortly to agree together on the date of your first appointment.</p>" +
        "<p><strong>What happens next</strong><br>As soon as the date of your first appointment is set with your professional, you'll receive a confirmation email. That's when you'll set up your payment method — nothing is required for now.</p>" +
        "<p>If you have questions, contact our team from your dashboard.</p>",
      ctaText: "Complete my account",
    },
  },
};

// ---------------------------------------------------------------------------
// Appointment reminder — H-72 (free-cancellation window still open)
// ---------------------------------------------------------------------------

const reminderPlaceholders: EmailPlaceholder[] = [
  {
    key: "clientName",
    labelFr: "Prénom du client",
    labelEn: "Client first name",
    sampleFr: "Marie",
    sampleEn: "Marie",
  },
  {
    key: "professionalName",
    labelFr: "Nom du professionnel",
    labelEn: "Professional name",
    sampleFr: "Dr Camille Tremblay",
    sampleEn: "Dr Camille Tremblay",
  },
  {
    key: "appointmentDate",
    labelFr: "Date et heure du rendez-vous",
    labelEn: "Appointment date & time",
    sampleFr: "12 juin 2026 à 18 h 05",
    sampleEn: "June 12, 2026 at 6:05 PM",
  },
];

const reminder72h: EmailTemplateDefinition = {
  key: "reminder72h",
  labelFr: "Rappel — 72 h avant le rendez-vous",
  labelEn: "Reminder — 72h before the appointment",
  descriptionFr:
    "Envoyé 72 h avant la séance. La fenêtre d'annulation sans frais est encore ouverte (boutons Annuler et Demander un autre rendez-vous ajoutés automatiquement).",
  descriptionEn:
    "Sent 72h before the session. The free-cancellation window is still open (Cancel and Request-another-appointment buttons are added automatically).",
  placeholders: reminderPlaceholders,
  defaults: {
    fr: {
      subject: "Rappel : rendez-vous dans 72 heures — Je chemine",
      title: "Votre rendez-vous est dans 72 heures",
      subtitle: "Vous pouvez encore annuler ou reporter sans frais",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Petit rappel : votre rendez-vous avec {{professionalName}} est prévu le {{appointmentDate}}. Vous êtes encore dans la fenêtre d'annulation sans frais (jusqu'à 48 h avant la séance).</p>" +
        "<p><strong>Besoin de changer vos plans ?</strong><br>Annulez votre rendez-vous sans frais ou demandez une nouvelle date. Passé le délai de 48 h avant la séance, l'annulation entraînera des frais de 15 %.</p>" +
        "<p>Nous avons hâte de vous accompagner. À très bientôt !</p>",
      ctaText: "Annuler mon rendez-vous",
    },
    en: {
      subject: "Reminder: appointment in 72 hours — Je chemine",
      title: "Your appointment is in 72 hours",
      subtitle: "You can still cancel or reschedule free of charge",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Friendly reminder: your appointment with {{professionalName}} is scheduled on {{appointmentDate}}. You are still within the free-cancellation window (until 48h before the session).</p>" +
        "<p><strong>Need to change your plans?</strong><br>Cancel your appointment free of charge or request a new date. After the 48h window before the session, cancellation will incur a 15% fee.</p>" +
        "<p>We look forward to supporting you. See you soon!</p>",
      ctaText: "Cancel my appointment",
    },
  },
};

// ---------------------------------------------------------------------------
// Appointment reminder — H-48 (strict window passed; no self-service cancel)
// ---------------------------------------------------------------------------

const reminder48h: EmailTemplateDefinition = {
  key: "reminder48h",
  labelFr: "Rappel — 48 h avant le rendez-vous",
  labelEn: "Reminder — 48h before the appointment",
  descriptionFr:
    "Envoyé 48 h avant la séance, une fois le délai d'annulation sans frais dépassé. Si le client n'a pas encore de mode de paiement, un bouton « Choisir mon mode de paiement » est ajouté automatiquement.",
  descriptionEn:
    "Sent 48h before the session, once the free-cancellation window has passed. If the client still has no payment method, a “Choose my payment method” button is added automatically.",
  placeholders: reminderPlaceholders,
  defaults: {
    fr: {
      subject: "Rappel : rendez-vous dans 48 heures — Je chemine",
      title: "Votre rendez-vous est dans 48 heures",
      subtitle: "Rappel de votre rendez-vous",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Votre rendez-vous avec {{professionalName}} aura lieu dans 48 heures ({{appointmentDate}}).</p>" +
        "<p><strong>Politique d'annulation</strong><br>Le délai d'annulation sans frais est dépassé. Toute annulation à moins de 48 h doit passer par notre équipe ou votre professionnel — l'option d'annulation en libre-service n'est plus disponible.</p>" +
        "<p>Préparez votre séance : trouvez un endroit calme, vérifiez votre connexion et soyez prêt(e) quelques minutes à l'avance. À très bientôt !</p>",
    },
    en: {
      subject: "Reminder: appointment in 48 hours — Je chemine",
      title: "Your appointment is in 48 hours",
      subtitle: "Appointment reminder",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Your appointment with {{professionalName}} will take place in 48 hours ({{appointmentDate}}).</p>" +
        "<p><strong>Cancellation policy</strong><br>The free-cancellation window has closed. Any cancellation within 48h must go through our team or your professional — the self-service cancellation option is no longer available.</p>" +
        "<p>Prepare for your session: find a quiet space, check your connection, and be ready a few minutes early. See you soon!</p>",
    },
  },
};

// ---------------------------------------------------------------------------
// Meeting link ready
// ---------------------------------------------------------------------------

const meetingLinkReady: EmailTemplateDefinition = {
  key: "meetingLinkReady",
  labelFr: "Lien de réunion prêt",
  labelEn: "Meeting link ready",
  descriptionFr:
    "Envoyé au client quand son lien de réunion est disponible. Le bouton « Rejoindre la séance » est ajouté automatiquement.",
  descriptionEn:
    "Sent to the client when their meeting link is available. The “Join the session” button is added automatically.",
  placeholders: [
    {
      key: "guestName",
      labelFr: "Nom du participant",
      labelEn: "Participant name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "professionalName",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
    {
      key: "appointmentType",
      labelFr: "Type de séance",
      labelEn: "Session type",
      sampleFr: "Vidéo",
      sampleEn: "Video",
    },
    {
      key: "appointmentDate",
      labelFr: "Date de la séance",
      labelEn: "Session date",
      sampleFr: "12 juin 2026",
      sampleEn: "June 12, 2026",
    },
    {
      key: "appointmentTime",
      labelFr: "Heure de la séance",
      labelEn: "Session time",
      sampleFr: "18 h 05",
      sampleEn: "6:05 PM",
    },
    {
      key: "duration",
      labelFr: "Durée (minutes)",
      labelEn: "Duration (minutes)",
      sampleFr: "50",
      sampleEn: "50",
    },
    {
      key: "meetingUrl",
      labelFr: "Lien de réunion",
      labelEn: "Meeting link",
      sampleFr: "https://meet.example.com/abc123",
      sampleEn: "https://meet.example.com/abc123",
    },
  ],
  defaults: {
    fr: {
      subject: "Votre lien de réunion est prêt — Je chemine",
      title: "Lien de réunion prêt",
      subtitle: "Détails de votre séance",
      bodyHtml:
        "<p>Bonjour {{guestName}},</p>" +
        "<p>Votre lien de réunion est maintenant disponible. Vous pouvez rejoindre la séance via le bouton ci-dessous.</p>" +
        "<p><strong>Professionnel :</strong> {{professionalName}}<br>" +
        "<strong>Type :</strong> {{appointmentType}}<br>" +
        "<strong>Date :</strong> {{appointmentDate}}<br>" +
        "<strong>Heure :</strong> {{appointmentTime}}<br>" +
        "<strong>Durée :</strong> {{duration}} minutes<br>" +
        "<strong>Lien de réunion :</strong> <a href=\"{{meetingUrl}}\">{{meetingUrl}}</a></p>" +
        "<p>Veuillez vous connecter quelques minutes avant et vous assurer d'avoir une connexion internet stable.</p>",
      ctaText: "Rejoindre la séance",
    },
    en: {
      subject: "Your meeting link is ready — Je chemine",
      title: "Meeting link ready",
      subtitle: "Your session details",
      bodyHtml:
        "<p>Hello {{guestName}},</p>" +
        "<p>Your meeting link is now available. You can join the session via the button below.</p>" +
        "<p><strong>Professional:</strong> {{professionalName}}<br>" +
        "<strong>Type:</strong> {{appointmentType}}<br>" +
        "<strong>Date:</strong> {{appointmentDate}}<br>" +
        "<strong>Time:</strong> {{appointmentTime}}<br>" +
        "<strong>Duration:</strong> {{duration}} minutes<br>" +
        "<strong>Meeting link:</strong> <a href=\"{{meetingUrl}}\">{{meetingUrl}}</a></p>" +
        "<p>Please connect a few minutes early and make sure you have a stable internet connection.</p>",
      ctaText: "Join the session",
    },
  },
};

// ---------------------------------------------------------------------------
// Payment failed
// ---------------------------------------------------------------------------

const paymentFailed: EmailTemplateDefinition = {
  key: "paymentFailed",
  labelFr: "Paiement échoué",
  labelEn: "Payment failed",
  descriptionFr:
    "Envoyé au client lorsqu'une tentative de paiement échoue. Le bouton « Réessayer le paiement » est ajouté automatiquement. Les lignes Date/Professionnel n'apparaissent que si l'information est disponible.",
  descriptionEn:
    "Sent to the client when a payment attempt fails. The “Retry payment” button is added automatically. The Date/Professional lines only appear when that information is available.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Prénom du client",
      labelEn: "Client first name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "amount",
      labelFr: "Montant (formaté)",
      labelEn: "Amount (formatted)",
      sampleFr: "150.00 $ CAD",
      sampleEn: "CAD $150.00",
    },
    {
      key: "appointmentDate",
      labelFr: "Date du rendez-vous (si dispo.)",
      labelEn: "Appointment date (if available)",
      sampleFr: "12 juin 2026",
      sampleEn: "June 12, 2026",
    },
    {
      key: "professionalName",
      labelFr: "Nom du professionnel (si dispo.)",
      labelEn: "Professional name (if available)",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
  ],
  defaults: {
    fr: {
      subject: "Paiement échoué — Action requise",
      title: "Paiement échoué",
      subtitle: "Action requise",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Malheureusement, nous n'avons pas pu traiter votre paiement. Veuillez mettre à jour votre moyen de paiement et réessayer.</p>" +
        "<p><strong>Montant :</strong> {{amount}}</p>" +
        "{{#appointmentDate}}<p><strong>Date du rendez-vous :</strong> {{appointmentDate}}</p>{{/appointmentDate}}" +
        "{{#professionalName}}<p><strong>Professionnel :</strong> {{professionalName}}</p>{{/professionalName}}" +
        "<p><strong>Besoin d'aide ?</strong> Si les problèmes persistent, veuillez contacter notre équipe de soutien.</p>" +
        "<p>Veuillez résoudre ce problème dans les 24 heures pour conserver votre plage horaire.</p>",
      ctaText: "Réessayer le paiement",
    },
    en: {
      subject: "Payment failed — Action required",
      title: "Payment failed",
      subtitle: "Action required",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Unfortunately, we were unable to process your payment. Please update your payment method and try again.</p>" +
        "<p><strong>Amount:</strong> {{amount}}</p>" +
        "{{#appointmentDate}}<p><strong>Appointment date:</strong> {{appointmentDate}}</p>{{/appointmentDate}}" +
        "{{#professionalName}}<p><strong>Professional:</strong> {{professionalName}}</p>{{/professionalName}}" +
        "<p><strong>Need help?</strong> If the problem persists, please contact our support team.</p>" +
        "<p>Please resolve this within 24 hours to keep your appointment slot.</p>",
      ctaText: "Retry payment",
    },
  },
};

// ---------------------------------------------------------------------------
// Appointment confirmation
// ---------------------------------------------------------------------------

const appointmentConfirmation: EmailTemplateDefinition = {
  key: "appointmentConfirmation",
  labelFr: "Confirmation de rendez-vous",
  labelEn: "Appointment confirmation",
  descriptionFr:
    "Envoyé au client dès que le rendez-vous est confirmé. Le bouton « Rejoindre la séance » n'apparaît que pour les séances virtuelles. Les lignes Lien/Lieu s'affichent selon le type de séance.",
  descriptionEn:
    "Sent to the client as soon as the appointment is confirmed. The “Join the session” button only appears for virtual sessions. The Link/Location lines show based on the session type.",
  placeholders: [
    { key: "clientName", labelFr: "Prénom du client", labelEn: "Client first name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "professionalName", labelFr: "Nom du professionnel", labelEn: "Professional name", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "appointmentType", labelFr: "Type de séance (minuscule)", labelEn: "Session type (lowercase)", sampleFr: "vidéo", sampleEn: "video" },
    { key: "appointmentDate", labelFr: "Date", labelEn: "Date", sampleFr: "12 juin 2026", sampleEn: "June 12, 2026" },
    { key: "appointmentTime", labelFr: "Heure", labelEn: "Time", sampleFr: "18 h 05", sampleEn: "6:05 PM" },
    { key: "appointmentDuration", labelFr: "Durée", labelEn: "Duration", sampleFr: "60 minutes", sampleEn: "60 minutes" },
    { key: "meetingUrl", labelFr: "Lien de réunion (si virtuel)", labelEn: "Meeting link (if virtual)", sampleFr: "https://meet.example.com/abc", sampleEn: "https://meet.example.com/abc" },
    { key: "location", labelFr: "Lieu (si en personne)", labelEn: "Location (if in-person)", sampleFr: "123 rue de la Paix, Montréal", sampleEn: "123 Peace Street, Montreal" },
  ],
  defaults: {
    fr: {
      subject: "Rendez-vous confirmé — Je chemine",
      title: "Rendez-vous confirmé",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Votre rendez-vous ({{appointmentType}}) est confirmé.</p>" +
        "<p><strong>Professionnel :</strong> {{professionalName}}<br>" +
        "<strong>Date :</strong> {{appointmentDate}}<br>" +
        "<strong>Heure :</strong> {{appointmentTime}}<br>" +
        "<strong>Durée :</strong> {{appointmentDuration}}" +
        "{{#meetingUrl}}<br><strong>Lien de réunion :</strong> <a href=\"{{meetingUrl}}\">Rejoindre la séance</a>{{/meetingUrl}}" +
        "{{#location}}<br><strong>Lieu :</strong> {{location}}{{/location}}</p>" +
        "<p>Si vous devez reporter ou annuler, veuillez le faire au moins 48 heures à l'avance.</p>",
      ctaText: "Rejoindre la séance",
    },
    en: {
      subject: "Appointment confirmed — Je chemine",
      title: "Appointment confirmed",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Your {{appointmentType}} appointment is confirmed.</p>" +
        "<p><strong>Professional:</strong> {{professionalName}}<br>" +
        "<strong>Date:</strong> {{appointmentDate}}<br>" +
        "<strong>Time:</strong> {{appointmentTime}}<br>" +
        "<strong>Duration:</strong> {{appointmentDuration}}" +
        "{{#meetingUrl}}<br><strong>Meeting link:</strong> <a href=\"{{meetingUrl}}\">Join the session</a>{{/meetingUrl}}" +
        "{{#location}}<br><strong>Location:</strong> {{location}}{{/location}}</p>" +
        "<p>If you need to reschedule or cancel, please do so at least 48 hours in advance.</p>",
      ctaText: "Join the session",
    },
  },
};

// ---------------------------------------------------------------------------
// Payment invitation (after a pro confirms — add a payment method)
// ---------------------------------------------------------------------------

const paymentInvitation: EmailTemplateDefinition = {
  key: "paymentInvitation",
  labelFr: "Invitation au paiement",
  labelEn: "Payment invitation",
  descriptionFr:
    "Envoyé au client après confirmation par le professionnel : invite à enregistrer un mode de paiement (rien n'est prélevé avant la séance). Le bouton de paiement est ajouté automatiquement.",
  descriptionEn:
    "Sent to the client after the professional confirms: invites them to save a payment method (nothing is charged before the session). The payment button is added automatically.",
  placeholders: [
    { key: "clientName", labelFr: "Prénom du client", labelEn: "Client first name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "professionalName", labelFr: "Nom du professionnel", labelEn: "Professional name", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "appointmentDate", labelFr: "Date", labelEn: "Date", sampleFr: "12 juin 2026", sampleEn: "June 12, 2026" },
    { key: "appointmentTime", labelFr: "Heure", labelEn: "Time", sampleFr: "18 h 05", sampleEn: "6:05 PM" },
    { key: "appointmentDuration", labelFr: "Durée (minutes)", labelEn: "Duration (minutes)", sampleFr: "60", sampleEn: "60" },
    { key: "meetingLinkOrLocation", labelFr: "Lien ou lieu (si dispo.)", labelEn: "Link or location (if available)", sampleFr: "https://meet.example.com/abc", sampleEn: "https://meet.example.com/abc" },
    { key: "price", labelFr: "Prix (formaté, 2 décimales)", labelEn: "Price (formatted, 2 decimals)", sampleFr: "150.00", sampleEn: "150.00" },
    { key: "currency", labelFr: "Devise", labelEn: "Currency", sampleFr: "CAD", sampleEn: "CAD" },
  ],
  defaults: {
    fr: {
      subject: "Votre rendez-vous est confirmé — prochaine étape",
      title: "Prochaine étape : confirmez votre rendez-vous",
      subtitle: "Votre professionnel a confirmé votre séance",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Votre rendez-vous est confirmé. Veuillez ajouter vos coordonnées de paiement (carte, virement Interac via Stripe, ou prélèvement automatique canadien) pour finaliser votre réservation. Aucun montant n'est prélevé avant que votre séance ait eu lieu et que votre professionnel la marque comme complétée. Les données de carte et bancaires sont traitées par Stripe — nous ne les stockons pas sur notre plateforme.</p>" +
        "<p><strong>Professionnel :</strong> {{professionalName}}<br>" +
        "<strong>Date :</strong> {{appointmentDate}}<br>" +
        "<strong>Heure :</strong> {{appointmentTime}}<br>" +
        "<strong>Durée :</strong> {{appointmentDuration}} minutes" +
        "{{#meetingLinkOrLocation}}<br><strong>Lieu/Lien :</strong> {{meetingLinkOrLocation}}{{/meetingLinkOrLocation}}</p>" +
        "<p><strong>Montant dû : {{price}} $ {{currency}}</strong> (frais de séance — prélevés après la séance complétée)</p>" +
        "<p>Vous recevrez votre lien de réunion une fois votre moyen de paiement enregistré.</p>",
      ctaText: "Ouvrir la facturation et confirmer",
    },
    en: {
      subject: "Your appointment is confirmed — next step",
      title: "Next step: confirm your appointment",
      subtitle: "Your professional has confirmed your session",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Your appointment is confirmed. Please add your payment details (card, Interac e-Transfer via Stripe, or Canadian pre-authorized debit) to finalize your booking. No amount is charged before your session has taken place and your professional marks it as completed. Card and banking data are processed by Stripe — we do not store them on our platform.</p>" +
        "<p><strong>Professional:</strong> {{professionalName}}<br>" +
        "<strong>Date:</strong> {{appointmentDate}}<br>" +
        "<strong>Time:</strong> {{appointmentTime}}<br>" +
        "<strong>Duration:</strong> {{appointmentDuration}} minutes" +
        "{{#meetingLinkOrLocation}}<br><strong>Location/Link:</strong> {{meetingLinkOrLocation}}{{/meetingLinkOrLocation}}</p>" +
        "<p><strong>Amount due: {{currency}} ${{price}}</strong> (session fee — charged after the session is completed)</p>" +
        "<p>You will receive your meeting link once your payment method is saved.</p>",
      ctaText: "Open billing and confirm",
    },
  },
};

// ---------------------------------------------------------------------------
// Cancellation notice (to the other party)
// ---------------------------------------------------------------------------

const cancellationNotice: EmailTemplateDefinition = {
  key: "cancellationNotice",
  labelFr: "Avis d'annulation",
  labelEn: "Cancellation notice",
  descriptionFr:
    "Envoyé à l'autre partie quand un rendez-vous (ou une demande) est annulé. Le bloc date/heure ne s'affiche que si le rendez-vous était déjà planifié.",
  descriptionEn:
    "Sent to the other party when an appointment (or request) is cancelled. The date/time block only shows if the appointment was already scheduled.",
  placeholders: [
    { key: "recipientName", labelFr: "Nom du destinataire", labelEn: "Recipient name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "cancellerName", labelFr: "Nom de la personne qui annule", labelEn: "Name of canceller", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "appointmentDate", labelFr: "Date initiale (si planifié)", labelEn: "Original date (if scheduled)", sampleFr: "12 juin 2026", sampleEn: "June 12, 2026" },
    { key: "appointmentTime", labelFr: "Heure initiale (si planifié)", labelEn: "Original time (if scheduled)", sampleFr: "18 h 05", sampleEn: "6:05 PM" },
  ],
  defaults: {
    fr: {
      subject: "Rendez-vous annulé — Je chemine",
      title: "Rendez-vous annulé",
      bodyHtml:
        "<p>Bonjour {{recipientName}},</p>" +
        "{{#appointmentDate}}<p>Le rendez-vous prévu le {{appointmentDate}} à {{appointmentTime}} a été annulé par {{cancellerName}}.</p>{{/appointmentDate}}" +
        "{{^appointmentDate}}<p>Une demande de rendez-vous a été annulée par {{cancellerName}}.</p>{{/appointmentDate}}" +
        "{{#appointmentDate}}<p><strong>Date initiale :</strong> {{appointmentDate}}<br><strong>Heure initiale :</strong> {{appointmentTime}}</p>{{/appointmentDate}}" +
        "<p>Si vous avez des questions ou souhaitez reporter, veuillez nous contacter.</p>",
    },
    en: {
      subject: "Appointment cancelled — Je chemine",
      title: "Appointment cancelled",
      bodyHtml:
        "<p>Hello {{recipientName}},</p>" +
        "{{#appointmentDate}}<p>The appointment scheduled on {{appointmentDate}} at {{appointmentTime}} has been cancelled by {{cancellerName}}.</p>{{/appointmentDate}}" +
        "{{^appointmentDate}}<p>An appointment request has been cancelled by {{cancellerName}}.</p>{{/appointmentDate}}" +
        "{{#appointmentDate}}<p><strong>Original date:</strong> {{appointmentDate}}<br><strong>Original time:</strong> {{appointmentTime}}</p>{{/appointmentDate}}" +
        "<p>If you have any questions or would like to reschedule, please contact us.</p>",
    },
  },
};

// ---------------------------------------------------------------------------
// Refund confirmation
// ---------------------------------------------------------------------------

const refundConfirmation: EmailTemplateDefinition = {
  key: "refundConfirmation",
  labelFr: "Confirmation de remboursement",
  labelEn: "Refund confirmation",
  descriptionFr:
    "Envoyé au client après le traitement d'un remboursement. La ligne « Rendez-vous initial » ne s'affiche que si une date est disponible.",
  descriptionEn:
    "Sent to the client after a refund is processed. The “Original appointment” line only shows if a date is available.",
  placeholders: [
    { key: "name", labelFr: "Nom du client", labelEn: "Client name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "amount", labelFr: "Montant remboursé (formaté)", labelEn: "Refunded amount (formatted)", sampleFr: "125.00 $ CAD", sampleEn: "CAD $125.00" },
    { key: "appointmentDate", labelFr: "Rendez-vous initial (si dispo.)", labelEn: "Original appointment (if available)", sampleFr: "12 juin 2026", sampleEn: "June 12, 2026" },
  ],
  defaults: {
    fr: {
      subject: "Remboursement traité — Je chemine",
      title: "Remboursement traité",
      bodyHtml:
        "<p>Bonjour {{name}},</p>" +
        "<p>Votre remboursement a été traité avec succès. Les fonds devraient apparaître dans votre compte dans un délai de 5 à 10 jours ouvrables.</p>" +
        "<p><strong>Montant remboursé :</strong> {{amount}}</p>" +
        "{{#appointmentDate}}<p><strong>Rendez-vous initial :</strong> {{appointmentDate}}</p>{{/appointmentDate}}" +
        "<p><strong>Délai de traitement :</strong> les remboursements prennent généralement 5 à 10 jours ouvrables pour apparaître sur votre relevé, selon votre institution bancaire.</p>" +
        "<p>Si vous avez des questions concernant ce remboursement, veuillez contacter notre équipe de soutien.</p>",
    },
    en: {
      subject: "Refund processed — Je chemine",
      title: "Refund processed",
      bodyHtml:
        "<p>Hello {{name}},</p>" +
        "<p>Your refund has been processed successfully. The funds should appear in your account within 5 to 10 business days.</p>" +
        "<p><strong>Refunded amount:</strong> {{amount}}</p>" +
        "{{#appointmentDate}}<p><strong>Original appointment:</strong> {{appointmentDate}}</p>{{/appointmentDate}}" +
        "<p><strong>Processing time:</strong> refunds typically take 5 to 10 business days to appear on your statement, depending on your bank.</p>" +
        "<p>If you have any questions about this refund, please contact our support team.</p>",
    },
  },
};

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const passwordReset: EmailTemplateDefinition = {
  key: "passwordReset",
  labelFr: "Réinitialisation du mot de passe",
  labelEn: "Password reset",
  descriptionFr:
    "Envoyé à l'utilisateur qui demande une réinitialisation du mot de passe. Le bouton « Réinitialiser mon mot de passe » est ajouté automatiquement. Le lien expire dans 1 heure.",
  descriptionEn:
    "Sent to the user who requests a password reset. The “Reset my password” button is added automatically. The link expires in 1 hour.",
  placeholders: [
    { key: "name", labelFr: "Nom de l'utilisateur", labelEn: "User name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "resetLink", labelFr: "Lien de réinitialisation", labelEn: "Reset link", sampleFr: "https://jechemine.ca/auth/reset-password?token=abc", sampleEn: "https://jechemine.ca/auth/reset-password?token=abc" },
  ],
  defaults: {
    fr: {
      subject: "Réinitialisation de votre mot de passe — Je chemine",
      title: "Réinitialisation du mot de passe",
      bodyHtml:
        "<p>Bonjour {{name}},</p>" +
        "<p>Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe.</p>" +
        "<p><strong>Vous n'avez pas fait cette demande ?</strong> Si vous n'avez pas demandé de réinitialisation, ignorez simplement ce message. Votre mot de passe reste inchangé.</p>" +
        "<p>Ce lien expirera dans 1 heure pour des raisons de sécurité.</p>",
      ctaText: "Réinitialiser mon mot de passe",
    },
    en: {
      subject: "Your password reset — Je chemine",
      title: "Password reset",
      bodyHtml:
        "<p>Hello {{name}},</p>" +
        "<p>We received a request to reset your password. Click the button below to create a new password.</p>" +
        "<p><strong>Didn't request this?</strong> If you didn't request a reset, simply ignore this message. Your password remains unchanged.</p>" +
        "<p>This link will expire in 1 hour for security reasons.</p>",
      ctaText: "Reset my password",
    },
  },
};

// ---------------------------------------------------------------------------
// Service request onboarding (request received — complete your profile)
// ---------------------------------------------------------------------------

const serviceRequestOnboarding: EmailTemplateDefinition = {
  key: "serviceRequestOnboarding",
  labelFr: "Confirmation de demande de service",
  labelEn: "Service request onboarding",
  descriptionFr:
    "Envoyé au demandeur après réception de sa demande. Invite à compléter le profil de membre pour accélérer le jumelage. Le bouton est ajouté automatiquement.",
  descriptionEn:
    "Sent to the requester after their request is received. Invites them to complete their member profile to speed up matching. The button is added automatically.",
  placeholders: [
    { key: "toName", labelFr: "Nom du demandeur", labelEn: "Requester name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "companyName", labelFr: "Nom de la plateforme", labelEn: "Platform name", sampleFr: "Je chemine", sampleEn: "Je chemine" },
  ],
  defaults: {
    fr: {
      subject: "Votre demande est bien reçue ! Prochaines étapes avec Je chemine",
      title: "Votre demande est bien reçue !",
      subtitle: "Nous recherchons le bon professionnel pour vous",
      bodyHtml:
        "<p>Bonjour {{toName}},</p>" +
        "<p>Nous avons bien reçu votre demande de rendez-vous — merci de nous avoir choisis pour vous accompagner. Notre équipe recherche dès maintenant le professionnel qui correspond le mieux à votre situation. Vous recevrez un courriel dès qu'un professionnel aura accepté votre demande.</p>" +
        "<h3>🔍 Votre demande est entre de bonnes mains</h3>" +
        "<p>Nous vous jumelons dès maintenant avec un professionnel adapté à vos besoins. Dès qu'un professionnel aura accepté votre demande, nous vous écrirons pour la prochaine étape : confirmer et garantir votre rendez-vous.</p>" +
        "<p><strong>Aidez-nous à vous jumeler plus vite :</strong> en complétant votre profil de membre, vous nous donnez les détails nécessaires pour vous mettre en relation avec le bon professionnel. Cela ne prend que quelques minutes.</p>" +
        "<p>Merci de faire équipe avec nous pour votre bien-être.</p>" +
        "<p>Chaleureusement,<br>L'équipe de {{companyName}}</p>",
      ctaText: "Finaliser mon profil de membre",
    },
    en: {
      subject: "We've received your request! Next steps with Je chemine",
      title: "We've received your request!",
      subtitle: "We're finding the right professional for you",
      bodyHtml:
        "<p>Hello {{toName}},</p>" +
        "<p>We've received your appointment request — thank you for choosing us to support you. Our team is now looking for the professional who best fits your situation. You'll receive an email as soon as a professional has accepted your request.</p>" +
        "<h3>🔍 Your request is in good hands</h3>" +
        "<p>We're now matching you with a professional suited to your needs. As soon as a professional accepts your request, we'll email you the next step: confirming and securing your appointment.</p>" +
        "<p><strong>Help us match you faster:</strong> completing your member profile gives us the details we need to connect you with the right professional. It only takes a few minutes.</p>" +
        "<p>Thank you for teaming up with us for your well-being.</p>" +
        "<p>Warmly,<br>The {{companyName}} team</p>",
      ctaText: "Complete my member profile",
    },
  },
};

// ---------------------------------------------------------------------------
// Referral confirmation — NEW patient (no account yet → create one)
// Sent to the PATIENT when a professional refers them (bookingFor="patient")
// and the patient has no existing Je chemine account. CTA → member sign-up.
// ---------------------------------------------------------------------------

const referralNewPatient: EmailTemplateDefinition = {
  key: "referralNewPatient",
  labelFr: "Référence — nouveau patient (sans compte)",
  labelEn: "Referral — new patient (no account)",
  descriptionFr:
    "Envoyé au PATIENT lorsqu'un professionnel le réfère et qu'il n'a pas encore de compte Je chemine. L'invite à créer son compte pour suivre sa demande. Le bouton est ajouté automatiquement.",
  descriptionEn:
    "Sent to the PATIENT when a professional refers them and they don't yet have a Je chemine account. Invites them to create an account to follow their request. The button is added automatically.",
  placeholders: [
    { key: "toName", labelFr: "Nom du patient", labelEn: "Patient name", sampleFr: "Camille", sampleEn: "Camille" },
    { key: "referrerName", labelFr: "Nom du professionnel référent", labelEn: "Referring professional name", sampleFr: "Dr Tremblay", sampleEn: "Dr Tremblay" },
    { key: "companyName", labelFr: "Nom de la plateforme", labelEn: "Platform name", sampleFr: "Je chemine", sampleEn: "Je chemine" },
  ],
  defaults: {
    fr: {
      subject: "Une demande de rendez-vous a été faite en votre nom — Je chemine",
      title: "Vous avez été référé à Je chemine",
      subtitle: "Créez votre compte pour suivre votre demande",
      bodyHtml:
        "<p>Bonjour {{toName}},</p>" +
        "<p>Un professionnel{{#referrerName}} ({{referrerName}}){{/referrerName}} a soumis une demande de rendez-vous en votre nom sur {{companyName}}. Notre équipe recherche dès maintenant le professionnel qui correspond le mieux à votre situation.</p>" +
        "<p><strong>Pour suivre votre demande</strong> et recevoir les prochaines étapes, créez votre compte de membre — cela ne prend que quelques minutes et nous aide à vous jumeler plus vite.</p>" +
        "<p>Vous recevrez un courriel dès qu'un professionnel aura accepté votre demande.</p>" +
        "<p>Chaleureusement,<br>L'équipe de {{companyName}}</p>",
      ctaText: "Créer mon compte",
    },
    en: {
      subject: "An appointment request was made on your behalf — Je chemine",
      title: "You've been referred to Je chemine",
      subtitle: "Create your account to follow your request",
      bodyHtml:
        "<p>Hello {{toName}},</p>" +
        "<p>A professional{{#referrerName}} ({{referrerName}}){{/referrerName}} submitted an appointment request on your behalf on {{companyName}}. Our team is now looking for the professional who best fits your situation.</p>" +
        "<p><strong>To follow your request</strong> and receive the next steps, create your member account — it only takes a few minutes and helps us match you faster.</p>" +
        "<p>You'll receive an email as soon as a professional has accepted your request.</p>" +
        "<p>Warmly,<br>The {{companyName}} team</p>",
      ctaText: "Create my account",
    },
  },
};

// ---------------------------------------------------------------------------
// Referral confirmation — EXISTING member (already has an account → log in)
// Sent to the PATIENT when a professional refers them and they already have a
// real Je chemine account. CTA → their space (log in to track the request).
// ---------------------------------------------------------------------------

const referralExistingMember: EmailTemplateDefinition = {
  key: "referralExistingMember",
  labelFr: "Référence — membre existant (avec compte)",
  labelEn: "Referral — existing member (has account)",
  descriptionFr:
    "Envoyé au PATIENT lorsqu'un professionnel le réfère et qu'il possède déjà un compte Je chemine. L'invite à se connecter à son espace pour suivre sa demande. Le bouton est ajouté automatiquement.",
  descriptionEn:
    "Sent to the PATIENT when a professional refers them and they already have a Je chemine account. Invites them to log in to their space to follow the request. The button is added automatically.",
  placeholders: [
    { key: "toName", labelFr: "Nom du patient", labelEn: "Patient name", sampleFr: "Camille", sampleEn: "Camille" },
    { key: "referrerName", labelFr: "Nom du professionnel référent", labelEn: "Referring professional name", sampleFr: "Dr Tremblay", sampleEn: "Dr Tremblay" },
    { key: "companyName", labelFr: "Nom de la plateforme", labelEn: "Platform name", sampleFr: "Je chemine", sampleEn: "Je chemine" },
  ],
  defaults: {
    fr: {
      subject: "Une demande de rendez-vous a été faite en votre nom — Je chemine",
      title: "Une demande a été faite en votre nom",
      subtitle: "Connectez-vous à votre espace pour la suivre",
      bodyHtml:
        "<p>Bonjour {{toName}},</p>" +
        "<p>Un professionnel{{#referrerName}} ({{referrerName}}){{/referrerName}} a soumis une demande de rendez-vous en votre nom sur {{companyName}}. Notre équipe recherche dès maintenant le professionnel qui correspond le mieux à votre situation.</p>" +
        "<p>Comme vous possédez déjà un compte, <strong>connectez-vous à votre espace</strong> pour suivre l'avancement de votre demande et confirmer les prochaines étapes dès qu'un professionnel l'aura acceptée.</p>" +
        "<p>Chaleureusement,<br>L'équipe de {{companyName}}</p>",
      ctaText: "Accéder à mon espace",
    },
    en: {
      subject: "An appointment request was made on your behalf — Je chemine",
      title: "A request was made on your behalf",
      subtitle: "Log in to your space to follow it",
      bodyHtml:
        "<p>Hello {{toName}},</p>" +
        "<p>A professional{{#referrerName}} ({{referrerName}}){{/referrerName}} submitted an appointment request on your behalf on {{companyName}}. Our team is now looking for the professional who best fits your situation.</p>" +
        "<p>Since you already have an account, <strong>log in to your space</strong> to follow your request and confirm the next steps as soon as a professional has accepted it.</p>" +
        "<p>Warmly,<br>The {{companyName}} team</p>",
      ctaText: "Go to my space",
    },
  },
};

// ---------------------------------------------------------------------------
// Guest payment confirmation (invité — ajouter un moyen de paiement)
// ---------------------------------------------------------------------------

const guestPaymentConfirmation: EmailTemplateDefinition = {
  key: "guestPaymentConfirmation",
  labelFr: "Confirmation de paiement — invité",
  labelEn: "Payment confirmation — guest",
  descriptionFr:
    "Envoyé à un invité (réservation sans compte) une fois le rendez-vous confirmé : l'invite à ajouter un moyen de paiement via le lien sécurisé. Rien n'est prélevé avant la séance. Le bouton n'apparaît que si le lien de paiement est disponible.",
  descriptionEn:
    "Sent to a guest (no-account booking) once the appointment is confirmed: invites them to add a payment method via the secure link. Nothing is charged before the session. The button only appears when a payment link is available.",
  placeholders: [
    { key: "guestName", labelFr: "Nom de l'invité", labelEn: "Guest name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "sessionType", labelFr: "Type de séance", labelEn: "Session type", sampleFr: "Vidéo", sampleEn: "Video" },
    { key: "appointmentType", labelFr: "Type de rendez-vous", labelEn: "Appointment type", sampleFr: "Consultation", sampleEn: "Consultation" },
    { key: "professionalName", labelFr: "Nom du professionnel", labelEn: "Professional name", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "appointmentDate", labelFr: "Date", labelEn: "Date", sampleFr: "12 juin 2026", sampleEn: "June 12, 2026" },
    { key: "appointmentTime", labelFr: "Heure", labelEn: "Time", sampleFr: "18 h 05", sampleEn: "6:05 PM" },
    { key: "appointmentDuration", labelFr: "Durée", labelEn: "Duration", sampleFr: "60 minutes", sampleEn: "60 minutes" },
    { key: "price", labelFr: "Prix (formaté, 2 décimales)", labelEn: "Price (formatted, 2 decimals)", sampleFr: "150.00", sampleEn: "150.00" },
    { key: "currency", labelFr: "Devise", labelEn: "Currency", sampleFr: "CAD", sampleEn: "CAD" },
  ],
  defaults: {
    fr: {
      subject: "Rendez-vous confirmé — prochaine étape : votre paiement",
      title: "Prochaine étape : confirmez votre rendez-vous",
      subtitle: "Votre professionnel a confirmé votre séance",
      bodyHtml:
        "<p>Bonjour {{guestName}},</p>" +
        "<p>Votre rendez-vous est confirmé. Ouvrez le lien sécurisé ci-dessous pour ajouter vos coordonnées de paiement (carte, virement Interac via Stripe, ou prélèvement automatique canadien). Aucun montant n'est prélevé avant que votre séance ait eu lieu et que votre professionnel la marque comme complétée. Stripe traite vos informations bancaires — nous ne les stockons pas.</p>" +
        "<p><strong>Type de séance :</strong> {{sessionType}}<br>" +
        "<strong>Type de rendez-vous :</strong> {{appointmentType}}<br>" +
        "<strong>Professionnel :</strong> {{professionalName}}<br>" +
        "<strong>Date :</strong> {{appointmentDate}}<br>" +
        "<strong>Heure :</strong> {{appointmentTime}}<br>" +
        "<strong>Durée :</strong> {{appointmentDuration}}</p>" +
        "<p><strong>Montant dû : {{price}} $ {{currency}}</strong> (frais de séance — prélevés après la séance complétée)</p>" +
        "<h3>Paiements sécurisés avec Stripe</h3>" +
        "<p>Une fois votre moyen de paiement enregistré, vous pourrez accéder à votre lien de réunion. Le paiement n'est traité qu'après la complétion de la séance.</p>" +
        "<p>Si vous avez besoin d'aide, contactez-nous via les coordonnées indiquées sur notre site web.</p>",
      ctaText: "Confirmer avec mes coordonnées de paiement",
    },
    en: {
      subject: "Appointment confirmed — next step: your payment",
      title: "Next step: confirm your appointment",
      subtitle: "Your professional has confirmed your session",
      bodyHtml:
        "<p>Hello {{guestName}},</p>" +
        "<p>Your appointment is confirmed. Open the secure link below to add your payment information (card, Interac e-Transfer via Stripe, or Canadian pre-authorized debit). No amount is charged before your session has taken place and your professional has marked it as complete. Stripe handles your banking information — we do not store it.</p>" +
        "<p><strong>Session type:</strong> {{sessionType}}<br>" +
        "<strong>Appointment type:</strong> {{appointmentType}}<br>" +
        "<strong>Professional:</strong> {{professionalName}}<br>" +
        "<strong>Date:</strong> {{appointmentDate}}<br>" +
        "<strong>Time:</strong> {{appointmentTime}}<br>" +
        "<strong>Duration:</strong> {{appointmentDuration}}</p>" +
        "<p><strong>Amount due: {{currency}} ${{price}}</strong> (session fee — charged after the session is completed)</p>" +
        "<h3>Payments secured by Stripe</h3>" +
        "<p>Once your payment method is saved, you will be able to access your meeting link. Payment is only processed after the session is completed.</p>" +
        "<p>If you need help, contact us using the information on our website.</p>",
      ctaText: "Confirm with my payment information",
    },
  },
};

// ---------------------------------------------------------------------------
// Guest payment complete (invité — paiement reçu, prêt pour la séance)
// ---------------------------------------------------------------------------

const guestPaymentComplete: EmailTemplateDefinition = {
  key: "guestPaymentComplete",
  labelFr: "Paiement confirmé — invité",
  labelEn: "Payment confirmed — guest",
  descriptionFr:
    "Envoyé à un invité une fois son paiement traité : le rendez-vous est pleinement confirmé. Le bouton « Rejoindre la séance » et le bloc lien de réunion n'apparaissent que si un lien est disponible.",
  descriptionEn:
    "Sent to a guest once their payment is processed: the appointment is fully confirmed. The “Join the session” button and meeting-link block only appear when a link is available.",
  placeholders: [
    { key: "guestName", labelFr: "Nom de l'invité", labelEn: "Guest name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "sessionType", labelFr: "Type de séance", labelEn: "Session type", sampleFr: "Vidéo", sampleEn: "Video" },
    { key: "appointmentType", labelFr: "Type de rendez-vous", labelEn: "Appointment type", sampleFr: "Consultation", sampleEn: "Consultation" },
    { key: "professionalName", labelFr: "Nom du professionnel", labelEn: "Professional name", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "appointmentDate", labelFr: "Date", labelEn: "Date", sampleFr: "12 juin 2026", sampleEn: "June 12, 2026" },
    { key: "appointmentTime", labelFr: "Heure", labelEn: "Time", sampleFr: "18 h 05", sampleEn: "6:05 PM" },
    { key: "appointmentDuration", labelFr: "Durée", labelEn: "Duration", sampleFr: "60 minutes", sampleEn: "60 minutes" },
    { key: "price", labelFr: "Montant payé (formaté, 2 décimales)", labelEn: "Amount paid (formatted, 2 decimals)", sampleFr: "150.00", sampleEn: "150.00" },
    { key: "currency", labelFr: "Devise", labelEn: "Currency", sampleFr: "CAD", sampleEn: "CAD" },
    { key: "meetingLink", labelFr: "Lien de réunion (si dispo.)", labelEn: "Meeting link (if available)", sampleFr: "https://meet.example.com/abc", sampleEn: "https://meet.example.com/abc" },
  ],
  defaults: {
    fr: {
      subject: "Paiement confirmé — Je chemine",
      title: "Paiement confirmé",
      subtitle: "Vous êtes prêt pour votre séance",
      bodyHtml:
        "<p>Bonjour {{guestName}},</p>" +
        "<p>Merci ! Votre paiement a été traité avec succès. Votre rendez-vous est maintenant pleinement confirmé.</p>" +
        "<p><strong>Type de séance :</strong> {{sessionType}}<br>" +
        "<strong>Type de rendez-vous :</strong> {{appointmentType}}<br>" +
        "<strong>Professionnel :</strong> {{professionalName}}<br>" +
        "<strong>Date :</strong> {{appointmentDate}}<br>" +
        "<strong>Heure :</strong> {{appointmentTime}}<br>" +
        "<strong>Durée :</strong> {{appointmentDuration}}" +
        "{{#meetingLink}}<br><strong>Lien de réunion :</strong> <a href=\"{{meetingLink}}\">{{meetingLink}}</a>{{/meetingLink}}</p>" +
        "<p><strong>Montant payé : {{price}} $ {{currency}}</strong> — Paiement reçu, merci !</p>" +
        "<h3>Avant votre séance</h3>" +
        "{{#meetingLink}}<p>Votre lien de réunion est prêt. Assurez-vous de vous connecter quelques minutes avant et d'avoir une connexion internet stable.</p>{{/meetingLink}}" +
        "{{^meetingLink}}<p>Votre lien de réunion vous sera envoyé avant l'heure prévue de votre séance.</p>{{/meetingLink}}" +
        "<p>Nous avons hâte de vous accompagner dans votre parcours de mieux-être. Si vous devez reporter, contactez-nous au moins 48 heures à l'avance.</p>",
      ctaText: "Rejoindre la séance",
    },
    en: {
      subject: "Payment confirmed — Je chemine",
      title: "Payment confirmed",
      subtitle: "You're ready for your session",
      bodyHtml:
        "<p>Hello {{guestName}},</p>" +
        "<p>Thank you! Your payment has been processed successfully. Your appointment is now fully confirmed.</p>" +
        "<p><strong>Session type:</strong> {{sessionType}}<br>" +
        "<strong>Appointment type:</strong> {{appointmentType}}<br>" +
        "<strong>Professional:</strong> {{professionalName}}<br>" +
        "<strong>Date:</strong> {{appointmentDate}}<br>" +
        "<strong>Time:</strong> {{appointmentTime}}<br>" +
        "<strong>Duration:</strong> {{appointmentDuration}}" +
        "{{#meetingLink}}<br><strong>Meeting link:</strong> <a href=\"{{meetingLink}}\">{{meetingLink}}</a>{{/meetingLink}}</p>" +
        "<p><strong>Amount paid: {{currency}} ${{price}}</strong> — Payment received, thank you!</p>" +
        "<h3>Before your session</h3>" +
        "{{#meetingLink}}<p>Your meeting link is ready. Make sure to connect a few minutes early and have a stable internet connection.</p>{{/meetingLink}}" +
        "{{^meetingLink}}<p>Your meeting link will be sent before your scheduled session time.</p>{{/meetingLink}}" +
        "<p>We look forward to supporting you on your wellness journey. If you need to reschedule, contact us at least 48 hours in advance.</p>",
      ctaText: "Join the session",
    },
  },
};

// ---------------------------------------------------------------------------
// Appointment reminder — generic (friendly reminder, no cancel/reschedule CTA)
// ---------------------------------------------------------------------------

const appointmentReminderGeneric: EmailTemplateDefinition = {
  key: "appointmentReminderGeneric",
  labelFr: "Rappel de rendez-vous — générique",
  labelEn: "Appointment reminder — generic",
  descriptionFr:
    "Rappel amical d'un prochain rendez-vous. Le bouton « Rejoindre la séance » et la ligne « Lien de réunion » n'apparaissent que si un lien est disponible.",
  descriptionEn:
    "Friendly reminder of an upcoming appointment. The “Join the session” button and the “Meeting link” line only appear when a link is available.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Prénom du client",
      labelEn: "Client first name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "professionalName",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
    {
      key: "appointmentDate",
      labelFr: "Date du rendez-vous",
      labelEn: "Appointment date",
      sampleFr: "12 juin 2026",
      sampleEn: "June 12, 2026",
    },
    {
      key: "appointmentTime",
      labelFr: "Heure du rendez-vous",
      labelEn: "Appointment time",
      sampleFr: "18 h 05",
      sampleEn: "6:05 PM",
    },
    {
      key: "meetingLink",
      labelFr: "Lien de réunion (si dispo.)",
      labelEn: "Meeting link (if available)",
      sampleFr: "https://meet.example.com/abc",
      sampleEn: "https://meet.example.com/abc",
    },
  ],
  defaults: {
    fr: {
      subject: "Rappel de rendez-vous — Je chemine",
      title: "Rappel de rendez-vous",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Voici un rappel amical concernant votre prochain rendez-vous.</p>" +
        "<p><strong>Professionnel :</strong> {{professionalName}}<br>" +
        "<strong>Date :</strong> {{appointmentDate}}<br>" +
        "<strong>Heure :</strong> {{appointmentTime}}" +
        "{{#meetingLink}}<br><strong>Lien de réunion :</strong> <a href=\"{{meetingLink}}\">{{meetingLink}}</a>{{/meetingLink}}</p>" +
        "<p><strong>Préparez votre séance</strong><br>Assurez-vous d'être dans un endroit calme et privé avec une connexion internet stable. Connectez-vous quelques minutes avant pour tester votre audio et vidéo.</p>" +
        "<p>Nous avons hâte de vous voir !</p>",
      ctaText: "Rejoindre la séance",
    },
    en: {
      subject: "Appointment reminder — Je chemine",
      title: "Appointment reminder",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Here is a friendly reminder about your upcoming appointment.</p>" +
        "<p><strong>Professional:</strong> {{professionalName}}<br>" +
        "<strong>Date:</strong> {{appointmentDate}}<br>" +
        "<strong>Time:</strong> {{appointmentTime}}" +
        "{{#meetingLink}}<br><strong>Meeting link:</strong> <a href=\"{{meetingLink}}\">{{meetingLink}}</a>{{/meetingLink}}</p>" +
        "<p><strong>Prepare for your session</strong><br>Make sure you are in a quiet, private space with a stable internet connection. Connect a few minutes early to test your audio and video.</p>" +
        "<p>We look forward to seeing you!</p>",
      ctaText: "Join the session",
    },
  },
};

// ---------------------------------------------------------------------------
// Unscheduled match reminder — pro accepted but no 1st appointment date yet
// ---------------------------------------------------------------------------

const unscheduledMatchReminder: EmailTemplateDefinition = {
  key: "unscheduledMatchReminder",
  labelFr: "Rappel — confirmer la date du 1er rendez-vous",
  labelEn: "Reminder — confirm the 1st appointment date",
  descriptionFr:
    "Envoyé au professionnel qui a accepté une demande mais n'a pas encore fixé la date du premier rendez-vous. L'invite à confirmer depuis l'onglet « À planifier ».",
  descriptionEn:
    "Sent to a professional who accepted a request but hasn't set the first appointment date yet. Prompts them to confirm from the “To Schedule” tab.",
  placeholders: [
    {
      key: "professionalName",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
  ],
  defaults: {
    fr: {
      subject: "Rappel — confirmez la date du 1er rendez-vous",
      title: "Un client attend la date de son 1er rendez-vous",
      subtitle: "Confirmez le premier rendez-vous",
      bodyHtml:
        "<p>Bonjour {{professionalName}},</p>" +
        "<p>Vous avez accepté la demande de {{clientName}}, mais la date du premier rendez-vous n'est pas encore fixée. {{clientName}} attend de vos nouvelles — confirmez la date depuis l'onglet « À planifier » de votre tableau de bord.</p>" +
        "<p>Vous pouvez communiquer avec le client avant de fixer une date officielle.</p>",
      ctaText: "Confirmer le 1er RDV",
    },
    en: {
      subject: "Reminder — confirm the 1st appointment date",
      title: "A client is waiting for their 1st appointment date",
      subtitle: "Confirm the first appointment",
      bodyHtml:
        "<p>Hello {{professionalName}},</p>" +
        "<p>You accepted {{clientName}}'s request, but the first appointment date isn't set yet. {{clientName}} is waiting to hear from you — confirm the date from the \"To Schedule\" tab of your dashboard.</p>" +
        "<p>You may contact the client before setting an official date.</p>",
      ctaText: "Confirm the 1st appointment",
    },
  },
};

// ---------------------------------------------------------------------------
// Interac e-Transfer instructions
// ---------------------------------------------------------------------------

const interacInstructions: EmailTemplateDefinition = {
  key: "interacInstructions",
  labelFr: "Instructions — virement Interac",
  labelEn: "Interac e-Transfer instructions",
  descriptionFr:
    "Envoyé au client qui paie par virement Interac : courriel de dépôt, vérification du nom, message obligatoire (code de référence), format court SMS et options PAD/carte. Aucun bouton.",
  descriptionEn:
    "Sent to a client paying by Interac e-Transfer: deposit email, name verification, mandatory message (reference code), short SMS format and PAD/card options. No button.",
  placeholders: [
    { key: "clientName", labelFr: "Prénom du client", labelEn: "Client first name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "clientLegalName", labelFr: "Nom légal au dossier", labelEn: "Legal name on file", sampleFr: "Marie Tremblay", sampleEn: "Marie Tremblay" },
    { key: "professionalName", labelFr: "Nom du professionnel", labelEn: "Professional name", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "appointmentDateLabel", labelFr: "Date du rendez-vous", labelEn: "Appointment date", sampleFr: "12 juin 2026 à 18 h 05", sampleEn: "June 12, 2026 at 6:05 PM" },
    { key: "depositEmail", labelFr: "Courriel de dépôt Interac", labelEn: "Interac deposit email", sampleFr: "depot@jechemine.ca", sampleEn: "depot@jechemine.ca" },
    { key: "amount", labelFr: "Montant (formaté)", labelEn: "Amount (formatted)", sampleFr: "150.00 $", sampleEn: "CAD $150.00" },
    { key: "interacReferenceCode", labelFr: "Code de référence (message obligatoire)", labelEn: "Reference code (mandatory message)", sampleFr: "JC-ABC123", sampleEn: "JC-ABC123" },
    { key: "companyName", labelFr: "Nom de la plateforme", labelEn: "Platform name", sampleFr: "Je chemine", sampleEn: "Je chemine" },
  ],
  defaults: {
    fr: {
      subject: "Instructions virement Interac — Je chemine",
      title: "Instructions — virement Interac",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Voici comment envoyer votre virement pour votre séance avec {{professionalName}} ({{appointmentDateLabel}}).</p>" +
        "<p><strong>1. Envoyez votre virement à :</strong> {{depositEmail}}</p>" +
        "<p><strong>2. Vérification du nom :</strong> Le nom associé à votre compte bancaire doit être identique à celui de votre dossier : {{clientLegalName}}.</p>" +
        "<p><strong>3. Compte d’un tiers ou d’une entreprise :</strong> Inscrivez votre nom complet dans le champ « Message » du virement pour que nous puissions identifier votre paiement.</p>" +
        "<p><strong>4. Message obligatoire (référence unique) :</strong> {{interacReferenceCode}}</p>" +
        "<p><strong>Format court (idéal mobile / SMS)</strong><br>" +
        "Paiement Interac Rapide ⚡<br>" +
        "📧 Courriel : {{depositEmail}}<br>" +
        "💰 Montant : {{amount}}<br>" +
        "📝 Message obligatoire : {{interacReferenceCode}}<br><br>" +
        "Le système pourra associer votre virement à votre dossier grâce à ce code.</p>" +
        "<p>PAD et carte : vous pouvez aussi enregistrer un moyen de paiement sécurisé (Stripe) depuis votre espace Facturation. Pour les PME, des solutions type prélèvement avec mandat (ex. intégrations bancaires spécialisées) peuvent s’ajouter — contactez {{companyName}} pour plus d’informations.</p>",
    },
    en: {
      subject: "Interac e-Transfer instructions — Je chemine",
      title: "Instructions — Interac e-Transfer",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Here is how to send your transfer for your session with {{professionalName}} ({{appointmentDateLabel}}).</p>" +
        "<p><strong>1. Send your transfer to:</strong> {{depositEmail}}</p>" +
        "<p><strong>2. Name verification:</strong> The name on your bank account must match the one on file: {{clientLegalName}}.</p>" +
        "<p><strong>3. Third-party or business account:</strong> Add your full name in the e-Transfer Message field so we can identify your payment.</p>" +
        "<p><strong>4. Mandatory message (unique reference):</strong> {{interacReferenceCode}}</p>" +
        "<p><strong>Short format (ideal for mobile / SMS)</strong><br>" +
        "Quick Interac e-Transfer ⚡<br>" +
        "📧 Email: {{depositEmail}}<br>" +
        "💰 Amount: {{amount}}<br>" +
        "📝 Mandatory message: {{interacReferenceCode}}<br><br>" +
        "The system uses this code to match your transfer to your file.</p>" +
        "<p>PAD and card: you can also save a secure payment method (Stripe) from your Billing area. For small businesses, mandate-based pre-authorized debit options may be available — contact {{companyName}} for details.</p>",
    },
  },
};

// ---------------------------------------------------------------------------
// Interac payment reminder (J+1 / J+2 — transfer still pending)
// ---------------------------------------------------------------------------

const interacReminder: EmailTemplateDefinition = {
  key: "interacReminder",
  labelFr: "Rappel de paiement — virement Interac",
  labelEn: "Payment reminder — Interac e-Transfer",
  descriptionFr:
    "Envoyé au client dont le virement Interac est toujours en attente (relance J+1, puis relance J+2 plus urgente). Le sujet, le titre et certains paragraphes changent selon qu'il s'agit du second rappel (urgent). Aucun bouton.",
  descriptionEn:
    "Sent to a client whose Interac transfer is still pending (Day +1 reminder, then a more urgent Day +2 reminder). The subject, title and some paragraphs change when it is the second (urgent) reminder. No button.",
  placeholders: [
    { key: "clientName", labelFr: "Prénom du client", labelEn: "Client first name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "appointmentDateLabel", labelFr: "Date du rendez-vous", labelEn: "Appointment date", sampleFr: "12 juin 2026 à 18 h 05", sampleEn: "June 12, 2026 at 6:05 PM" },
    { key: "depositEmail", labelFr: "Courriel de dépôt Interac", labelEn: "Interac deposit email", sampleFr: "depot@jechemine.ca", sampleEn: "depot@jechemine.ca" },
    { key: "amount", labelFr: "Montant (formaté)", labelEn: "Amount (formatted)", sampleFr: "150.00 $ CAD", sampleEn: "CAD $150.00" },
    { key: "interacReferenceCode", labelFr: "Code de référence (message obligatoire)", labelEn: "Reference code (mandatory message)", sampleFr: "JC-ABC123", sampleEn: "JC-ABC123" },
    { key: "companyName", labelFr: "Nom de la plateforme", labelEn: "Platform name", sampleFr: "Je chemine", sampleEn: "Je chemine" },
    { key: "reminderNumber", labelFr: "Numéro de relance (1 ou 2)", labelEn: "Reminder number (1 or 2)", sampleFr: "1", sampleEn: "1" },
    { key: "isUrgent", labelFr: "Relance urgente (J+2) — laisser vide sinon", labelEn: "Urgent reminder (Day +2) — leave empty otherwise", sampleFr: "", sampleEn: "" },
  ],
  defaults: {
    fr: {
      subject: "Rappel paiement Interac — {{companyName}}",
      title:
        "{{#isUrgent}}Rappel de paiement — Interac (J+2){{/isUrgent}}{{^isUrgent}}Rappel de paiement — Interac (J+1){{/isUrgent}}",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "{{#isUrgent}}<p>Deuxième rappel : votre paiement Interac pour la séance du {{appointmentDateLabel}} est toujours en attente. Veuillez envoyer votre virement dès que possible afin d'éviter un signalement de retard.</p>{{/isUrgent}}" +
        "{{^isUrgent}}<p>Nous n'avons pas encore reçu votre virement Interac pour votre séance du {{appointmentDateLabel}}. Voici un rappel des instructions de paiement.</p>{{/isUrgent}}" +
        "<p><strong>1. Envoyer à :</strong> {{depositEmail}}<br>" +
        "<strong>2. Nom :</strong> Le nom de votre compte bancaire doit correspondre à celui de votre dossier : {{clientName}}.<br>" +
        "<strong>3. Compte tiers / entreprise :</strong> Indiquez votre nom complet dans le champ « Message » du virement.<br>" +
        "<strong>4. Message obligatoire (code unique) :</strong> {{interacReferenceCode}}<br>" +
        "<strong>Montant :</strong> {{amount}}</p>" +
        "<p><strong>Format court (idéal mobile / SMS)</strong><br>" +
        "Paiement Interac Rapide ⚡<br>" +
        "📧 Courriel : {{depositEmail}}<br>" +
        "💰 Montant : {{amount}}<br>" +
        "📝 Message obligatoire : {{interacReferenceCode}}<br><br>" +
        "Le système associera votre virement à votre dossier grâce à ce code.</p>" +
        "{{#isUrgent}}<p>Votre paiement est en retard. Si vous rencontrez des difficultés, contactez le soutien de {{companyName}} immédiatement.</p>{{/isUrgent}}" +
        "{{^isUrgent}}<p>En cas de difficulté, contactez-nous à l'adresse de support de {{companyName}}.</p>{{/isUrgent}}",
    },
    en: {
      subject: "Interac payment reminder — {{companyName}}",
      title:
        "{{#isUrgent}}Payment reminder — Interac (Day +2){{/isUrgent}}{{^isUrgent}}Payment reminder — Interac (Day +1){{/isUrgent}}",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "{{#isUrgent}}<p>Second reminder: your Interac transfer for the session on {{appointmentDateLabel}} is still pending. Please send your transfer as soon as possible to avoid a late-payment flag.</p>{{/isUrgent}}" +
        "{{^isUrgent}}<p>We haven't received your Interac transfer for your session on {{appointmentDateLabel}} yet. Here is a reminder of the payment instructions.</p>{{/isUrgent}}" +
        "<p><strong>1. Send to:</strong> {{depositEmail}}<br>" +
        "<strong>2. Name:</strong> Your bank account name must match the one on file: {{clientName}}.<br>" +
        "<strong>3. Third-party / business account:</strong> Add your full name in the e-Transfer Message field.<br>" +
        "<strong>4. Mandatory message (unique code):</strong> {{interacReferenceCode}}<br>" +
        "<strong>Amount:</strong> {{amount}}</p>" +
        "<p><strong>Short format (ideal for mobile / SMS)</strong><br>" +
        "Quick Interac e-Transfer ⚡<br>" +
        "📧 Email: {{depositEmail}}<br>" +
        "💰 Amount: {{amount}}<br>" +
        "📝 Mandatory message: {{interacReferenceCode}}<br><br>" +
        "The system uses this code to match your transfer to your file.</p>" +
        "{{#isUrgent}}<p>Your payment is overdue. If you run into any trouble, contact {{companyName}} support immediately.</p>{{/isUrgent}}" +
        "{{^isUrgent}}<p>If you encounter any difficulty, reach {{companyName}} support.</p>{{/isUrgent}}",
    },
  },
};

// ---------------------------------------------------------------------------
// Account verification (security — activate account / 2FA)
// ---------------------------------------------------------------------------

const accountVerification: EmailTemplateDefinition = {
  key: "accountVerification",
  labelFr: "Vérification de compte (sécurité)",
  labelEn: "Account verification (security)",
  descriptionFr:
    "Courriel de sécurité d'activation de compte. Lien valide 15 minutes (le bouton « Activer » est ajouté automatiquement). Deux variantes : compte professionnel approuvé par l'administration (activation en un clic, sans SMS) ou flux 2FA standard (courriel + code SMS). Le contenu varie selon l'indicateur « Activation en un clic ».",
  descriptionEn:
    "Account-activation security email. Link valid for 15 minutes (the “Activate” button is added automatically). Two variants: admin-approved professional account (one-click activation, no SMS) or standard 2FA flow (email + SMS code). Content varies based on the “single-click activation” flag.",
  placeholders: [
    {
      key: "name",
      labelFr: "Nom de l'utilisateur",
      labelEn: "User name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "singleFactor",
      labelFr: "Activation en un clic (pro approuvé) — « true » ou vide",
      labelEn: "One-click activation (approved pro) — “true” or empty",
      sampleFr: "true",
      sampleEn: "true",
    },
  ],
  defaults: {
    fr: {
      subject:
        "{{#singleFactor}}Activez votre compte professionnel — Je chemine{{/singleFactor}}{{^singleFactor}}Activez votre compte (2FA) — Je chemine{{/singleFactor}}",
      title:
        "{{#singleFactor}}Activez votre compte professionnel{{/singleFactor}}{{^singleFactor}}Activez la sécurité à deux facteurs{{/singleFactor}}",
      subtitle: "Lien valide 15 minutes",
      bodyHtml:
        "<p>Bonjour {{name}},</p>" +
        "{{#singleFactor}}" +
        "<p>✅ Compte approuvé par l'administration</p>" +
        "<p>Bonne nouvelle : votre dossier professionnel a été validé par notre équipe administrative. Un seul clic suffit maintenant pour activer votre compte et accéder à votre espace.</p>" +
        "<h3>Et ensuite ?</h3>" +
        "<p>Une fois le bouton ci-dessus cliqué, votre compte sera immédiatement actif. Connectez-vous sur Je chemine avec le courriel et le mot de passe que vous avez choisis lors de votre inscription pour accéder à votre tableau de bord.</p>" +
        "{{/singleFactor}}" +
        "{{^singleFactor}}" +
        "<p>🔐 Activation 2FA requise</p>" +
        "<p>Pour finaliser l'activation de votre compte, activez l'authentification à deux facteurs en cliquant sur le bouton ci-dessous.</p>" +
        "<h3>Les deux étapes de l'activation 2FA</h3>" +
        "<p>1. Confirmation de votre adresse courriel via le lien sécurisé du bouton ci-dessus.<br>2. Réception et saisie d'un code SMS à 6 chiffres envoyé sur votre téléphone.</p>" +
        "{{/singleFactor}}" +
        "<p>Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.</p>",
      ctaText:
        "{{#singleFactor}}Activer mon compte professionnel{{/singleFactor}}{{^singleFactor}}Activer mon compte{{/singleFactor}}",
    },
    en: {
      subject:
        "{{#singleFactor}}Activate your professional account — Je chemine{{/singleFactor}}{{^singleFactor}}Activate your account (2FA) — Je chemine{{/singleFactor}}",
      title:
        "{{#singleFactor}}Activate your professional account{{/singleFactor}}{{^singleFactor}}Activate two-factor security{{/singleFactor}}",
      subtitle: "Link valid for 15 minutes",
      bodyHtml:
        "<p>Hello {{name}},</p>" +
        "{{#singleFactor}}" +
        "<p>✅ Approved by the administration</p>" +
        "<p>Great news: your professional dossier has been approved by our administrative team. A single click is all you need to activate your account and access your workspace.</p>" +
        "<h3>What's next?</h3>" +
        "<p>Once you click the button above, your account will be immediately active. Sign in to Je chemine using the email and password you chose at signup to access your dashboard.</p>" +
        "{{/singleFactor}}" +
        "{{^singleFactor}}" +
        "<p>🔐 2FA activation required</p>" +
        "<p>To finalize your account activation, enable two-factor authentication by clicking the button below.</p>" +
        "<h3>The two steps of 2FA activation</h3>" +
        "<p>1. Confirmation of your email address via the secure link in the button above.<br>2. Receive and enter a 6-digit SMS code sent to your phone.</p>" +
        "{{/singleFactor}}" +
        "<p>If you did not request this account, you can safely ignore this message.</p>",
      ctaText:
        "{{#singleFactor}}Activate my professional account{{/singleFactor}}{{^singleFactor}}Activate my account{{/singleFactor}}",
    },
  },
};

// ---------------------------------------------------------------------------
// Password setup link (admin-created account OR user-requested reset)
// ---------------------------------------------------------------------------

const passwordSetup: EmailTemplateDefinition = {
  key: "passwordSetup",
  labelFr: "Définir / réinitialiser le mot de passe (lien)",
  labelEn: "Set / reset password (link)",
  descriptionFr:
    "Envoyé lorsqu'un administrateur crée un compte (définir le mot de passe) ou lorsqu'un utilisateur demande une réinitialisation. Le bouton est ajouté automatiquement. Le lien expire dans 1 heure. Deux variantes selon l'indicateur « Réinitialisation ».",
  descriptionEn:
    "Sent when an administrator creates an account (set password) or when a user requests a reset. The button is added automatically. The link expires in 1 hour. Two variants based on the “Reset” flag.",
  placeholders: [
    {
      key: "name",
      labelFr: "Nom de l'utilisateur",
      labelEn: "User name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "isReset",
      labelFr: "Réinitialisation demandée par l'utilisateur — « true » ou vide",
      labelEn: "User-requested reset — “true” or empty",
      sampleFr: "",
      sampleEn: "",
    },
  ],
  defaults: {
    fr: {
      subject:
        "{{#isReset}}Réinitialisation de votre mot de passe — Je chemine{{/isReset}}{{^isReset}}Définissez votre mot de passe — Je chemine{{/isReset}}",
      title:
        "{{#isReset}}Réinitialisez votre mot de passe{{/isReset}}{{^isReset}}Définissez votre mot de passe{{/isReset}}",
      bodyHtml:
        "<p>Bonjour {{name}},</p>" +
        "{{#isReset}}<p>Vous avez demandé la réinitialisation de votre mot de passe Je chemine. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.</p>{{/isReset}}" +
        "{{^isReset}}<p>Un administrateur de Je chemine a créé un compte pour vous. Cliquez sur le bouton ci-dessous pour définir votre propre mot de passe et accéder à votre espace en toute sécurité.</p>{{/isReset}}" +
        "<h3>Et ensuite ?</h3>" +
        "<p>Une fois votre mot de passe défini, vous pourrez vous connecter à Je chemine avec votre adresse courriel et le mot de passe que vous venez de choisir.</p>" +
        "<p>Ce lien expirera dans 1 heure pour des raisons de sécurité. Si vous n'attendiez pas ce courriel, ignorez-le.</p>",
      ctaText:
        "{{#isReset}}Réinitialiser mon mot de passe{{/isReset}}{{^isReset}}Définir mon mot de passe{{/isReset}}",
    },
    en: {
      subject:
        "{{#isReset}}Reset your password — Je chemine{{/isReset}}{{^isReset}}Set your password — Je chemine{{/isReset}}",
      title:
        "{{#isReset}}Reset your password{{/isReset}}{{^isReset}}Set your password{{/isReset}}",
      bodyHtml:
        "<p>Hello {{name}},</p>" +
        "{{#isReset}}<p>You requested a password reset for your Je chemine account. Click the button below to choose a new one.</p>{{/isReset}}" +
        "{{^isReset}}<p>A Je chemine administrator created an account for you. Click the button below to set your own password and securely access your dashboard.</p>{{/isReset}}" +
        "<h3>What's next?</h3>" +
        "<p>Once your password is set, you can sign in to Je chemine with your email and the new password.</p>" +
        "<p>This link will expire in 1 hour for security reasons. If you weren't expecting this email, you can safely ignore it.</p>",
      ctaText:
        "{{#isReset}}Reset my password{{/isReset}}{{^isReset}}Set my password{{/isReset}}",
    },
  },
};

// ---------------------------------------------------------------------------
// Fiscal receipt (tax receipt PDF attached — payment confirmed or pending)
// ---------------------------------------------------------------------------

const fiscalReceipt: EmailTemplateDefinition = {
  key: "fiscalReceipt",
  labelFr: "Reçu fiscal",
  labelEn: "Tax receipt",
  descriptionFr:
    "Envoyé au client avec son reçu fiscal en pièce jointe (PDF). Deux variantes : paiement confirmé (carte/automatique) ou paiement Interac en attente. Le PDF est toujours joint automatiquement.",
  descriptionEn:
    "Sent to the client with their tax receipt attached (PDF). Two variants: payment confirmed (card/automatic) or Interac payment pending. The PDF is always attached automatically.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "amount",
      labelFr: "Montant (formaté)",
      labelEn: "Amount (formatted)",
      sampleFr: "150.00 $ CAD",
      sampleEn: "CAD $150.00",
    },
    {
      key: "paymentPendingTransfer",
      labelFr:
        "Variante paiement Interac en attente (laisser vide = paiement confirmé)",
      labelEn:
        "Interac payment-pending variant (leave empty = payment confirmed)",
      sampleFr: "",
      sampleEn: "",
    },
  ],
  defaults: {
    fr: {
      subject:
        "{{#paymentPendingTransfer}}Reçu de séance — paiement Interac en attente{{/paymentPendingTransfer}}{{^paymentPendingTransfer}}Merci — paiement confirmé et reçu fiscal{{/paymentPendingTransfer}}",
      title:
        "{{#paymentPendingTransfer}}Reçu de votre séance — paiement en attente{{/paymentPendingTransfer}}{{^paymentPendingTransfer}}Merci — paiement confirmé{{/paymentPendingTransfer}}",
      subtitle: "Votre reçu fiscal est en pièce jointe",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "{{#paymentPendingTransfer}}<p>Votre séance est enregistrée. Le montant dû est de {{amount}} (virement Interac). Les instructions de virement ont été ou seront envoyées par courriel. Vous trouverez en pièce jointe votre reçu fiscal.</p>{{/paymentPendingTransfer}}" +
        "{{^paymentPendingTransfer}}<p>Merci ! Votre paiement de {{amount}} a bien été traité. Toute l'équipe de Je chemine vous remercie de votre confiance. Vous trouverez votre reçu fiscal en pièce jointe — gardez-le précieusement pour vos remboursements (assurance, impôts).</p>{{/paymentPendingTransfer}}" +
        "{{^paymentPendingTransfer}}<p><strong>À propos de votre reçu</strong><br>Le PDF en pièce jointe contient les informations requises pour vos remboursements d'assurance et déclarations fiscales (numéro de licence du professionnel, date, montant).</p>{{/paymentPendingTransfer}}" +
        "<p>Chaleureusement,<br>L'équipe de Je chemine</p>",
    },
    en: {
      subject:
        "{{#paymentPendingTransfer}}Session receipt — Interac payment pending{{/paymentPendingTransfer}}{{^paymentPendingTransfer}}Thank you — payment confirmed and tax receipt{{/paymentPendingTransfer}}",
      title:
        "{{#paymentPendingTransfer}}Your session receipt — payment pending{{/paymentPendingTransfer}}{{^paymentPendingTransfer}}Thank you — payment confirmed{{/paymentPendingTransfer}}",
      subtitle: "Your tax receipt is attached",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "{{#paymentPendingTransfer}}<p>Your session is recorded. The amount due is {{amount}} (Interac e-Transfer). The transfer instructions have been or will be sent by email. You will find your tax receipt attached.</p>{{/paymentPendingTransfer}}" +
        "{{^paymentPendingTransfer}}<p>Thank you! Your payment of {{amount}} has been processed. The entire Je chemine team thanks you for your trust. Your tax receipt is attached — keep it for your reimbursements (insurance, taxes).</p>{{/paymentPendingTransfer}}" +
        "{{^paymentPendingTransfer}}<p><strong>About your receipt</strong><br>The attached PDF contains the information required for your insurance reimbursements and tax filings (professional license number, date, amount).</p>{{/paymentPendingTransfer}}" +
        "<p>Warmly,<br>The Je chemine team</p>",
    },
  },
};

// ---------------------------------------------------------------------------
// Post-meeting payment reminder
// ---------------------------------------------------------------------------

const postMeetingPayment: EmailTemplateDefinition = {
  key: "postMeetingPayment",
  labelFr: "Relance — paiement non configuré après la séance",
  labelEn: "Reminder — payment not set up after the session",
  descriptionFr:
    "Envoyé au client lorsque sa séance a eu lieu mais qu'aucun mode de paiement n'a été configuré sur son compte.",
  descriptionEn:
    "Sent to the client when their session has taken place but no payment method has been set up on their account.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie Tremblay",
      sampleEn: "Marie Tremblay",
    },
    {
      key: "appointmentDateLabel",
      labelFr: "Date de la séance",
      labelEn: "Session date",
      sampleFr: "lundi 2 juin 2026 à 14:00",
      sampleEn: "Monday, June 2, 2026 at 2:00 PM",
    },
  ],
  defaults: {
    fr: {
      subject:
        "Action requise — paiement non configuré après votre séance",
      title: "Action requise — paiement en attente",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Votre séance du {{appointmentDateLabel}} a eu lieu, mais aucun mode de paiement n'a encore été configuré sur votre compte. Veuillez régulariser votre situation dès que possible.</p>" +
        "<p>Si vous avez des questions, notre équipe est disponible depuis votre tableau de bord.</p>",
      ctaText: "Configurer mon paiement",
    },
    en: {
      subject:
        "Action required — payment not set up after your session",
      title: "Action required — payment pending",
      bodyHtml:
        "<p>Dear {{clientName}},</p>" +
        "<p>Your session on {{appointmentDateLabel}} has taken place, but no payment method has been set up on your account yet. Please settle this as soon as possible.</p>" +
        "<p>If you have any questions, our team is available from your dashboard.</p>",
      ctaText: "Set up my payment",
    },
  },
};

// ---------------------------------------------------------------------------
// Resend invitation — finalize registration
// ---------------------------------------------------------------------------

const resendInvitation: EmailTemplateDefinition = {
  key: "resendInvitation",
  labelFr: "Renvoi d'invitation",
  labelEn: "Resend invitation",
  descriptionFr:
    "Renvoyé à un client ou un professionnel pour l'inviter à se connecter et finaliser son inscription.",
  descriptionEn:
    "Resent to a client or professional to invite them to log in and finalize their registration.",
  placeholders: [
    {
      key: "name",
      labelFr: "Nom de la personne",
      labelEn: "Recipient name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "companyName",
      labelFr: "Nom de la plateforme",
      labelEn: "Platform name",
      sampleFr: "Je chemine",
      sampleEn: "Je chemine",
    },
  ],
  defaults: {
    fr: {
      subject: "Invitation à rejoindre {{companyName}}",
      title: "Finalisez votre inscription",
      subtitle: "{{companyName}}",
      bodyHtml:
        "<p>Bonjour {{name}},</p>" +
        "<p>Vous avez été invité à rejoindre {{companyName}}. Veuillez vous connecter pour compléter votre profil et accéder à votre tableau de bord.</p>" +
        "<p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>",
      ctaText: "Se connecter au site",
    },
    en: {
      subject: "Invitation to join {{companyName}}",
      title: "Finalize your registration",
      subtitle: "{{companyName}}",
      bodyHtml:
        "<p>Hello {{name}},</p>" +
        "<p>You have been invited to join {{companyName}}. Please log in to complete your profile and access your dashboard.</p>" +
        "<p>If you have any questions, feel free to contact us.</p>",
      ctaText: "Log in to the site",
    },
  },
};

// ---------------------------------------------------------------------------
// Payment guarantee — Day 1 reminder (choose a payment method)
// ---------------------------------------------------------------------------

const paymentGuaranteeDay1: EmailTemplateDefinition = {
  key: "paymentGuaranteeDay1",
  labelFr: "Rappel garantie de paiement — Jour 1",
  labelEn: "Payment guarantee reminder — Day 1",
  descriptionFr:
    "Envoyé au client dont le jumelage est confirmé mais qui n'a pas encore choisi de mode de paiement. Le bouton « Choisir mon mode de paiement » est ajouté automatiquement.",
  descriptionEn:
    "Sent to a client whose match is confirmed but who has not yet chosen a payment method. The “Choose my payment method” button is added automatically.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Prénom du client",
      labelEn: "Client first name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
  ],
  defaults: {
    fr: {
      subject: "Rappel : choisissez votre moyen de paiement — Je chemine",
      title: "Rappel : choisissez votre moyen de paiement",
      subtitle: "Il reste une étape pour finaliser votre dossier",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Votre jumelage est confirmé, mais nous n'avons pas encore reçu votre mode de paiement (carte, prélèvement automatique ou virement Interac). Pour garantir votre rendez-vous, sélectionnez votre mode de paiement dès maintenant.</p>" +
        "<p>Si vous avez déjà choisi le virement Interac, votre demande est en cours de traitement par notre administration.</p>",
      ctaText: "Choisir mon mode de paiement",
    },
    en: {
      subject: "Reminder: choose your payment method — Je chemine",
      title: "Reminder: choose your payment method",
      subtitle: "One step left to finalize your file",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Your match is confirmed, but we haven't received your payment method yet (card, pre-authorized debit, or Interac e-Transfer). To guarantee your appointment, please choose your payment method now.</p>" +
        "<p>If you have already chosen Interac e-Transfer, your request is being processed by our administration.</p>",
      ctaText: "Choose my payment method",
    },
  },
};

// ---------------------------------------------------------------------------
// Payment guarantee reminder — Day 2 (final)
// ---------------------------------------------------------------------------

const paymentGuaranteeDay2: EmailTemplateDefinition = {
  key: "paymentGuaranteeDay2",
  labelFr: "Rappel garantie de paiement — Jour 2 (dernier)",
  labelEn: "Payment guarantee reminder — Day 2 (final)",
  descriptionFr:
    "Dernier rappel envoyé au client dont le dossier est en attente depuis 48 h sans mode de paiement choisi. Le bouton « Choisir mon mode de paiement » est ajouté automatiquement.",
  descriptionEn:
    "Final reminder sent to a client whose file has been pending for 48h without a chosen payment method. The “Choose my payment method” button is added automatically.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Prénom du client",
      labelEn: "Client first name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
  ],
  defaults: {
    fr: {
      subject: "Dernier rappel : moyen de paiement requis — Je chemine",
      title: "Dernier rappel : moyen de paiement requis",
      subtitle: "Votre dossier est en attente depuis 48 heures",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>48 heures se sont écoulées depuis votre jumelage et nous n'avons toujours pas reçu votre choix de mode de paiement. Sans cette étape, nous ne pouvons pas garantir votre rendez-vous. Merci de finaliser cette dernière étape pour sécuriser votre suivi.</p>" +
        "<h3>Modes de paiement disponibles</h3>" +
        "<p>Carte de crédit (sécurisée par Stripe), prélèvement automatique canadien, ou virement Interac. Aucun montant n'est prélevé avant que votre séance ait eu lieu.</p>" +
        "<p>Si vous rencontrez des difficultés, contactez notre équipe via votre tableau de bord. Nous sommes là pour vous accompagner.</p>",
      ctaText: "Choisir mon mode de paiement",
    },
    en: {
      subject: "Final reminder: payment method required — Je chemine",
      title: "Final reminder: payment method required",
      subtitle: "Your file has been pending for 48 hours",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>It has been 48 hours since your match and we still haven't received your payment method choice. Without this step, we cannot guarantee your appointment. Please complete this final step to secure your follow-up.</p>" +
        "<h3>Available payment methods</h3>" +
        "<p>Credit card (secured by Stripe), Canadian pre-authorized debit, or Interac e-Transfer. No amount is charged before your session has taken place.</p>" +
        "<p>If you encounter any difficulties, contact our team via your dashboard. We are here to support you.</p>",
      ctaText: "Choose my payment method",
    },
  },
};

// ---------------------------------------------------------------------------
// Payment guarantee — 48h client reminder (urgent — appointment approaching)
// ---------------------------------------------------------------------------

const paymentGuarantee48hClient: EmailTemplateDefinition = {
  key: "paymentGuarantee48hClient",
  labelFr: "Garantie de paiement — rappel client 48 h (urgent)",
  labelEn: "Payment guarantee — 48h client reminder (urgent)",
  descriptionFr:
    "Rappel urgent envoyé au client dont le rendez-vous approche alors qu'aucune garantie de paiement (carte/PAD) n'est en place. Le bouton « Ajouter un moyen de paiement » est ajouté automatiquement.",
  descriptionEn:
    "Urgent reminder sent to a client whose appointment is approaching while no payment guarantee (card/PAD) is on file. The “Add a payment method” button is added automatically.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Prénom du client",
      labelEn: "Client first name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "appointmentDateLabel",
      labelFr: "Date et heure du rendez-vous",
      labelEn: "Appointment date & time",
      sampleFr: "12 juin 2026 à 18 h 05",
      sampleEn: "June 12, 2026 at 6:05 PM",
    },
  ],
  defaults: {
    fr: {
      subject: "URGENT : moyen de paiement — Je chemine",
      title: "URGENT — rendez-vous proche",
      bodyHtml:
        "<p>Bonjour {{clientName}},</p>" +
        "<p>Votre rendez-vous du {{appointmentDateLabel}} approche. Aucune garantie de paiement (carte/PAD) n'est en place. Merci d'agir immédiatement pour éviter tout report.</p>",
      ctaText: "Ajouter un moyen de paiement",
    },
    en: {
      subject: "URGENT: payment method — Je chemine",
      title: "URGENT — appointment approaching",
      bodyHtml:
        "<p>Hello {{clientName}},</p>" +
        "<p>Your appointment on {{appointmentDateLabel}} is approaching. No payment guarantee (card/PAD) is on file. Please act immediately to avoid any rescheduling.</p>",
      ctaText: "Add a payment method",
    },
  },
};

// ---------------------------------------------------------------------------
// Payment guarantee — 48h professional alert (PRO-facing)
// ---------------------------------------------------------------------------

const paymentGuarantee48hPro: EmailTemplateDefinition = {
  key: "paymentGuarantee48hPro",
  labelFr: "Garantie de paiement — alerte professionnel 48 h",
  labelEn: "Payment guarantee — 48h professional alert",
  descriptionFr:
    "Alerte envoyée au professionnel lorsqu'un client n'a toujours pas de garantie de paiement (carte/PAD) 48 h avant le rendez-vous. Le bouton « Voir les séances » est ajouté automatiquement.",
  descriptionEn:
    "Alert sent to the professional when a client still has no payment guarantee (card/PAD) 48h before the appointment. The “View sessions” button is added automatically.",
  placeholders: [
    {
      key: "professionalName",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "appointmentDateLabel",
      labelFr: "Date et heure du rendez-vous",
      labelEn: "Appointment date & time",
      sampleFr: "12 juin 2026 à 18 h 05",
      sampleEn: "June 12, 2026 at 6:05 PM",
    },
    {
      key: "appointmentId",
      labelFr: "Identifiant du rendez-vous",
      labelEn: "Appointment ID",
      sampleFr: "664f1a2b3c4d5e6f7a8b9c0d",
      sampleEn: "664f1a2b3c4d5e6f7a8b9c0d",
    },
  ],
  defaults: {
    fr: {
      subject: "ALERTE : client sans garantie — rendez-vous proche",
      title: "ALERTE — client sans garantie de paiement",
      bodyHtml:
        "<p>Bonjour {{professionalName}},</p>" +
        "<p>Le client {{clientName}} n'a toujours pas de carte ni prélèvement enregistré pour le rendez-vous du {{appointmentDateLabel}}. Dernière relance automatique envoyée au client.</p>" +
        "<p><strong>Rendez-vous :</strong> {{appointmentId}}</p>",
      ctaText: "Voir les séances",
    },
    en: {
      subject:
        "ALERT: client without payment guarantee — appointment approaching",
      title: "ALERT — client without payment guarantee",
      bodyHtml:
        "<p>Hello {{professionalName}},</p>" +
        "<p>Client {{clientName}} still has no card or pre-authorized debit on file for the appointment on {{appointmentDateLabel}}. Final automatic reminder sent to the client.</p>" +
        "<p><strong>Appointment:</strong> {{appointmentId}}</p>",
      ctaText: "View sessions",
    },
  },
};

// ---------------------------------------------------------------------------
// Appointment taken (proposed request was accepted by another professional)
// ---------------------------------------------------------------------------

const appointmentTaken: EmailTemplateDefinition = {
  key: "appointmentTaken",
  labelFr: "Demande attribuée à un autre professionnel",
  labelEn: "Request taken by another professional",
  descriptionFr:
    "Envoyé au professionnel à qui une demande avait été proposée lorsqu'un collègue l'a acceptée. Le bouton « Voir les demandes disponibles » est ajouté automatiquement.",
  descriptionEn:
    "Sent to a professional who had been proposed a request once a colleague accepted it. The “See available requests” button is added automatically.",
  placeholders: [
    {
      key: "professionalName",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
  ],
  defaults: {
    fr: {
      subject: "Demande attribuée à un autre professionnel — Je chemine",
      title: "Demande de rendez-vous attribuée",
      bodyHtml:
        "<p>Bonjour {{professionalName}},</p>" +
        "<p>Une demande de rendez-vous qui vous avait été proposée a été acceptée par un autre professionnel. Elle n'est plus disponible.</p>" +
        "<h3>Nouvelles demandes disponibles</h3>" +
        "<p>D'autres demandes de clients vous attendent sur votre tableau de bord.</p>",
      ctaText: "Voir les demandes disponibles",
    },
    en: {
      subject: "Request assigned to another professional — Je chemine",
      title: "Appointment request assigned",
      bodyHtml:
        "<p>Hello {{professionalName}},</p>" +
        "<p>An appointment request that had been proposed to you has been accepted by another professional. It is no longer available.</p>" +
        "<h3>New requests available</h3>" +
        "<p>Other client requests are waiting for you on your dashboard.</p>",
      ctaText: "See available requests",
    },
  },
};

// ---------------------------------------------------------------------------
// Professional — new appointment request proposed
// ---------------------------------------------------------------------------

const professionalNewRequest: EmailTemplateDefinition = {
  key: "professionalNewRequest",
  labelFr: "Professionnel — nouvelle demande de rendez-vous",
  labelEn: "Professional — new appointment request",
  descriptionFr:
    "Envoyé au professionnel lorsqu'une nouvelle demande de rendez-vous lui est proposée. Le bouton « Voir la demande » mène à la page Propositions du tableau de bord.",
  descriptionEn:
    "Sent to the professional when a new appointment request is proposed to them. The “See the request” button leads to the Proposals page of the dashboard.",
  placeholders: [
    { key: "professionalName", labelFr: "Nom du professionnel", labelEn: "Professional name", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "clientName", labelFr: "Nom du client", labelEn: "Client name", sampleFr: "Marie Lavoie", sampleEn: "Marie Lavoie" },
    { key: "clientEmail", labelFr: "Courriel du client", labelEn: "Client email", sampleFr: "marie@example.com", sampleEn: "marie@example.com" },
    { key: "appointmentType", labelFr: "Type de séance", labelEn: "Session type", sampleFr: "Vidéo", sampleEn: "Video" },
    { key: "appointmentDate", labelFr: "Date", labelEn: "Date", sampleFr: "12 juin 2026", sampleEn: "June 12, 2026" },
    { key: "appointmentTime", labelFr: "Heure", labelEn: "Time", sampleFr: "18 h 05", sampleEn: "6:05 PM" },
  ],
  defaults: {
    fr: {
      subject: "Nouvelle demande de rendez-vous — Je chemine",
      title: "Nouvelle demande de rendez-vous",
      bodyHtml:
        "<p>Bonjour {{professionalName}},</p>" +
        "<p>Vous avez reçu une nouvelle demande de rendez-vous. Veuillez consulter les détails ci-dessous.</p>" +
        "<p><strong>Client :</strong> {{clientName}}<br>" +
        "<strong>Courriel :</strong> {{clientEmail}}<br>" +
        "<strong>Type :</strong> {{appointmentType}}<br>" +
        "<strong>Date :</strong> {{appointmentDate}}<br>" +
        "<strong>Heure :</strong> {{appointmentTime}}</p>" +
        "<p>Veuillez répondre à cette demande dès que possible pour confirmer ou reporter.</p>",
      ctaText: "Voir la demande",
    },
    en: {
      subject: "New appointment request — Je chemine",
      title: "New appointment request",
      bodyHtml:
        "<p>Hello {{professionalName}},</p>" +
        "<p>You have received a new appointment request. Please review the details below.</p>" +
        "<p><strong>Client:</strong> {{clientName}}<br>" +
        "<strong>Email:</strong> {{clientEmail}}<br>" +
        "<strong>Type:</strong> {{appointmentType}}<br>" +
        "<strong>Date:</strong> {{appointmentDate}}<br>" +
        "<strong>Time:</strong> {{appointmentTime}}</p>" +
        "<p>Please respond to this request as soon as possible to confirm or reschedule.</p>",
      ctaText: "See the request",
    },
  },
};

// ---------------------------------------------------------------------------
// Professional — account approved / activated
// ---------------------------------------------------------------------------

const professionalApproval: EmailTemplateDefinition = {
  key: "professionalApproval",
  labelFr: "Professionnel — compte approuvé",
  labelEn: "Professional — account approved",
  descriptionFr:
    "Envoyé au professionnel lorsque son compte est approuvé et activé par l'administration. Le bouton « Accéder au tableau de bord » mène au tableau de bord professionnel.",
  descriptionEn:
    "Sent to professionals when their account is approved and activated by an administrator. The “Go to dashboard” button leads to the professional dashboard.",
  placeholders: [
    {
      key: "name",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
  ],
  defaults: {
    fr: {
      subject: "Bienvenue ! Votre compte professionnel est approuvé",
      title: "Demande approuvée !",
      subtitle: "Bienvenue dans l'équipe",
      bodyHtml:
        "<p>Bonjour {{name}},</p>" +
        "<p>Félicitations ! Votre candidature professionnelle a été approuvée. Vous pouvez maintenant commencer à accepter des rendez-vous et à vous connecter avec des clients.</p>" +
        "<p><strong>Pour commencer :</strong> Complétez votre profil, définissez vos disponibilités et commencez à accepter les demandes de rendez-vous des clients qui ont besoin de votre expertise.</p>" +
        "<p>Merci de nous avoir rejoints. Nous sommes ravis de vous compter parmi nous !</p>",
      ctaText: "Accéder au tableau de bord",
    },
    en: {
      subject: "Welcome! Your professional account is approved",
      title: "Application approved!",
      subtitle: "Welcome to the team",
      bodyHtml:
        "<p>Hello {{name}},</p>" +
        "<p>Congratulations! Your professional application has been approved. You can now start accepting appointments and connecting with clients.</p>" +
        "<p><strong>To get started:</strong> Complete your profile, set your availability and start accepting appointment requests from clients who need your expertise.</p>" +
        "<p>Thank you for joining us. We are delighted to have you with us!</p>",
      ctaText: "Go to dashboard",
    },
  },
};

// ---------------------------------------------------------------------------
// Professional — application not retained / rejected
// ---------------------------------------------------------------------------

const professionalRejection: EmailTemplateDefinition = {
  key: "professionalRejection",
  labelFr: "Professionnel — candidature non retenue",
  labelEn: "Professional — application not retained",
  descriptionFr:
    "Envoyé au professionnel lorsque sa candidature n'est pas approuvée par l'administration. Le bloc « Commentaires » n'apparaît que si un motif a été saisi. Aucun bouton.",
  descriptionEn:
    "Sent to a professional when their application is not approved by an administrator. The “Comments” block only appears when a reason was entered. No button.",
  placeholders: [
    {
      key: "name",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
    {
      key: "reason",
      labelFr: "Motif / commentaires (facultatif)",
      labelEn: "Reason / comments (optional)",
      sampleFr: "Nombre de places limité dans votre spécialité.",
      sampleEn: "Limited availability in your specialty.",
    },
  ],
  defaults: {
    fr: {
      subject: "Mise à jour de votre candidature — Je chemine",
      title: "Mise à jour de votre candidature",
      bodyHtml:
        "<p>Bonjour {{name}},</p>" +
        "<p>Merci de l'intérêt que vous portez à notre plateforme. Après examen attentif, nous ne sommes pas en mesure d'approuver votre candidature pour le moment.</p>" +
        "{{#reason}}<p><strong>Commentaires :</strong> {{reason}}</p>{{/reason}}" +
        "<p>Si vous pensez que cette décision est erronée ou souhaitez fournir des informations supplémentaires, veuillez contacter notre équipe de soutien.</p>",
    },
    en: {
      subject: "Update on your application — Je chemine",
      title: "Update on your application",
      bodyHtml:
        "<p>Hello {{name}},</p>" +
        "<p>Thank you for your interest in our platform. After careful review, we are unable to approve your application at this time.</p>" +
        "{{#reason}}<p><strong>Comments:</strong> {{reason}}</p>{{/reason}}" +
        "<p>If you believe this decision is in error or would like to provide additional information, please contact our support team.</p>",
    },
  },
};

// ---------------------------------------------------------------------------
// Emergency "Consultation ponctuelle rapide" — pro SLA nudge
// ---------------------------------------------------------------------------

const emergencyProSla: EmailTemplateDefinition = {
  key: "emergencyProSla",
  labelFr: "Urgence — relance SLA professionnel",
  labelEn: "Emergency — professional SLA nudge",
  descriptionFr:
    "Envoyé au professionnel pour rappeler l'engagement de service sur une consultation ponctuelle rapide (urgente). Deux variantes selon l'étape : « accepter » (la demande attend toujours une réponse, délai de 12 h) ou « prendre en charge » (acceptée mais 1er rendez-vous non confirmé, délai de 24 h). Le sujet, le titre, le texte et le bouton changent selon l'indicateur « Étape acceptation ». Bouton vers les propositions.",
  descriptionEn:
    "Sent to a professional to remind them of the service commitment on an urgent quick consultation. Two variants depending on the stage: \"accept\" (the request is still awaiting a response, 12-hour window) or \"take charge\" (accepted but the 1st appointment isn't confirmed, 24-hour window). The subject, title, body and button change based on the \"Accept stage\" flag. Button to the proposals.",
  placeholders: [
    {
      key: "name",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Tremblay",
      sampleEn: "Dr Tremblay",
    },
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie",
      sampleEn: "Marie",
    },
    {
      key: "isAccept",
      labelFr: "Étape acceptation (12 h) — laisser vide pour « prendre en charge » (24 h)",
      labelEn: "Accept stage (12h) — leave empty for \"take charge\" (24h)",
      sampleFr: "true",
      sampleEn: "true",
    },
  ],
  defaults: {
    fr: {
      subject:
        "{{#isAccept}}⚠ Urgence — demande à accepter (12 h){{/isAccept}}{{^isAccept}}⚠ Urgence — 1er RDV à confirmer (24 h){{/isAccept}}",
      title:
        "{{#isAccept}}Demande urgente en attente de votre réponse{{/isAccept}}{{^isAccept}}Consultation rapide à planifier{{/isAccept}}",
      bodyHtml:
        "<p>Bonjour {{name}},</p>" +
        "{{#isAccept}}<p>Une consultation ponctuelle rapide (urgente) de {{clientName}} vous a été proposée et attend toujours votre réponse. L'engagement pour ces demandes est de les accepter dans un délai de 12 heures. Merci de l'accepter ou de la refuser dès que possible depuis vos propositions.</p>{{/isAccept}}" +
        "{{^isAccept}}<p>Vous avez accepté une consultation ponctuelle rapide (urgente) de {{clientName}}, mais le 1er rendez-vous n'est pas encore confirmé. L'engagement pour ces demandes est de prendre en charge le dossier dans un délai de 24 heures. Merci de confirmer la date depuis l'onglet « À planifier ».</p>{{/isAccept}}",
      ctaText:
        "{{#isAccept}}Voir la demande{{/isAccept}}{{^isAccept}}Confirmer le 1er RDV{{/isAccept}}",
    },
    en: {
      subject:
        "{{#isAccept}}⚠ Urgent — request to accept (12h){{/isAccept}}{{^isAccept}}⚠ Urgent — 1st appointment to confirm (24h){{/isAccept}}",
      title:
        "{{#isAccept}}Urgent request awaiting your response{{/isAccept}}{{^isAccept}}Quick consultation to schedule{{/isAccept}}",
      bodyHtml:
        "<p>Hello {{name}},</p>" +
        "{{#isAccept}}<p>An urgent quick consultation from {{clientName}} was proposed to you and is still awaiting your response. The commitment for these requests is to accept within 12 hours. Please accept or decline it as soon as possible from your proposals.</p>{{/isAccept}}" +
        "{{^isAccept}}<p>You accepted an urgent quick consultation from {{clientName}}, but the 1st appointment isn't confirmed yet. The commitment for these requests is to take charge within 24 hours. Please confirm the date from the \"To Schedule\" tab.</p>{{/isAccept}}",
      ctaText:
        "{{#isAccept}}View the request{{/isAccept}}{{^isAccept}}Confirm the 1st appointment{{/isAccept}}",
    },
  },
};

// ---------------------------------------------------------------------------
// Admin alert — Interac trust request (validation requise / Statut vert)
// ---------------------------------------------------------------------------

const adminInteracTrustRequest: EmailTemplateDefinition = {
  key: "adminInteracTrustRequest",
  labelFr: "Admin — demande de confiance Interac (à valider)",
  labelEn: "Admin — Interac trust request (to validate)",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'un client choisit de payer par virement Interac (entente de confiance) au lieu d'une carte. Le bouton « Ouvrir la file d'attente » mène à la page de validation des paiements.",
  descriptionEn:
    "Alert sent to administrators when a client chooses to pay by Interac e-Transfer (trust agreement) instead of a card. The \"Open the queue\" button leads to the payment validation page.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie Lavoie",
      sampleEn: "Marie Lavoie",
    },
    {
      key: "clientEmail",
      labelFr: "Courriel du client",
      labelEn: "Client email",
      sampleFr: "marie@example.com",
      sampleEn: "marie@example.com",
    },
    {
      key: "appointmentId",
      labelFr: "Identifiant du rendez-vous",
      labelEn: "Appointment ID",
      sampleFr: "664f1a2b3c4d5e6f7a8b9c0d",
      sampleEn: "664f1a2b3c4d5e6f7a8b9c0d",
    },
  ],
  defaults: {
    fr: {
      subject: "Interac / virement — validation requise (Statut vert)",
      title: "Validation garantie Interac / virement",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "<p>Un client a indiqué ne pas utiliser de carte et souhaite payer par virement Interac (entente de confiance). Validez le profil pour passer le client en Statut vert.</p>" +
        "<p><strong>Client :</strong> {{clientName}}<br>" +
        "<strong>Courriel :</strong> {{clientEmail}}<br>" +
        "<strong>Rendez-vous :</strong> {{appointmentId}}</p>" +
        "<p>Après chaque séance, le paiement doit être reçu dans les 24 heures. Merci de confirmer la réception selon vos processus internes.</p>",
      ctaText: "Ouvrir la file d'attente",
    },
    en: {
      subject: "Interac / e-Transfer — validation required (Green status)",
      title: "Interac / e-Transfer guarantee validation",
      bodyHtml:
        "<p>Hello,</p>" +
        "<p>A client indicated they do not use a card and wish to pay by Interac e-Transfer (trust agreement). Validate the profile to move the client to Green status.</p>" +
        "<p><strong>Client:</strong> {{clientName}}<br>" +
        "<strong>Email:</strong> {{clientEmail}}<br>" +
        "<strong>Appointment:</strong> {{appointmentId}}</p>" +
        "<p>After each session, payment must be received within 24 hours. Please confirm receipt according to your internal processes.</p>",
      ctaText: "Open the queue",
    },
  },
};

const adminNoPaymentBeforeMeeting: EmailTemplateDefinition = {
  key: "adminNoPaymentBeforeMeeting",
  labelFr: "Admin — aucun paiement avant la rencontre",
  labelEn: "Admin — no payment before the meeting",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'un client n'avait aucun mode de paiement configuré avant sa séance. Une relance automatique est déjà envoyée au client. Le bouton « Voir les dossiers clients » mène à la liste des patients.",
  descriptionEn:
    "Alert sent to administrators when a client had no payment method configured before their session. An automatic reminder is already sent to the client. The \"View client files\" button leads to the patients list.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie Lavoie",
      sampleEn: "Marie Lavoie",
    },
    {
      key: "clientEmail",
      labelFr: "Courriel du client",
      labelEn: "Client email",
      sampleFr: "marie@example.com",
      sampleEn: "marie@example.com",
    },
    {
      key: "appointmentDateLabel",
      labelFr: "Date de la séance",
      labelEn: "Session date",
      sampleFr: "le 12 juin 2026 à 14 h",
      sampleEn: "June 12, 2026 at 2 PM",
    },
    {
      key: "appointmentId",
      labelFr: "Identifiant du rendez-vous",
      labelEn: "Appointment ID",
      sampleFr: "664f1a2b3c4d5e6f7a8b9c0d",
      sampleEn: "664f1a2b3c4d5e6f7a8b9c0d",
    },
  ],
  defaults: {
    fr: {
      subject: "⚠️ Aucun paiement — séance passée — {{clientName}}",
      title: "⚠️ Aucun paiement avant la rencontre",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "<p>Le client {{clientName}} ({{clientEmail}}) n'avait aucun mode de paiement configuré avant sa rencontre du {{appointmentDateLabel}}. Une relance a été envoyée automatiquement au client.</p>" +
        "<p><strong>Client :</strong> {{clientName}}<br>" +
        "<strong>Courriel :</strong> {{clientEmail}}<br>" +
        "<strong>Date séance :</strong> {{appointmentDateLabel}}<br>" +
        "<strong>ID RDV :</strong> {{appointmentId}}</p>",
      ctaText: "Voir les dossiers clients",
    },
    en: {
      subject: "⚠️ No payment — past session — {{clientName}}",
      title: "⚠️ No payment before the meeting",
      bodyHtml:
        "<p>Hello,</p>" +
        "<p>The client {{clientName}} ({{clientEmail}}) had no payment method configured before their meeting of {{appointmentDateLabel}}. A reminder has been automatically sent to the client.</p>" +
        "<p><strong>Client:</strong> {{clientName}}<br>" +
        "<strong>Email:</strong> {{clientEmail}}<br>" +
        "<strong>Session date:</strong> {{appointmentDateLabel}}<br>" +
        "<strong>Appointment ID:</strong> {{appointmentId}}</p>",
      ctaText: "View client files",
    },
  },
};

// ---------------------------------------------------------------------------
// Admin — new service request alert (standard + urgent variant)
// ---------------------------------------------------------------------------

const adminNewProfessionalSignup: EmailTemplateDefinition = {
  key: "adminNewProfessionalSignup",
  labelFr: "Admin — nouvelle inscription professionnel(le)",
  labelEn: "Admin — new professional signup",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'un(e) professionnel(le) vient de s'inscrire et attend la validation pour activer son compte. La ligne « Téléphone » entre {{#phone}}…{{/phone}} ne s'affiche que si un numéro est fourni. Le bouton « Examiner le dossier » mène à la fiche du professionnel.",
  descriptionEn:
    "Alert sent to administrators when a professional has just signed up and is awaiting validation to activate their account. The \"Phone\" line between {{#phone}}…{{/phone}} only shows when a number is provided. The \"Review the file\" button leads to the professional's record.",
  placeholders: [
    {
      key: "professionalName",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Camille Tremblay",
      sampleEn: "Camille Tremblay",
    },
    {
      key: "professionalEmail",
      labelFr: "Courriel du professionnel",
      labelEn: "Professional email",
      sampleFr: "camille@example.com",
      sampleEn: "camille@example.com",
    },
    {
      key: "phone",
      labelFr: "Téléphone (si fourni)",
      labelEn: "Phone (if provided)",
      sampleFr: "514 555-0123",
      sampleEn: "514 555-0123",
    },
  ],
  defaults: {
    fr: {
      subject: "Nouveau professionnel — {{professionalName}}",
      title: "Nouvelle inscription professionnel(le)",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "<p>Un(e) professionnel(le) vient de s'inscrire sur la plateforme et attend la validation de l'admin pour activer son compte.</p>" +
        "<p><strong>Nom :</strong> {{professionalName}}<br>" +
        "<strong>Courriel :</strong> {{professionalEmail}}" +
        "{{#phone}}<br><strong>Téléphone :</strong> {{phone}}{{/phone}}</p>" +
        "<p>Vous pouvez choisir d'envoyer le courriel d'activation 2FA ou d'activer le compte manuellement.</p>",
      ctaText: "Examiner le dossier",
    },
    en: {
      subject: "New professional — {{professionalName}}",
      title: "New professional signup",
      bodyHtml:
        "<p>Hello,</p>" +
        "<p>A professional has just signed up on the platform and is awaiting admin validation to activate their account.</p>" +
        "<p><strong>Name:</strong> {{professionalName}}<br>" +
        "<strong>Email:</strong> {{professionalEmail}}" +
        "{{#phone}}<br><strong>Phone:</strong> {{phone}}{{/phone}}</p>" +
        "<p>You can choose to send the 2FA activation email or activate the account manually.</p>",
      ctaText: "Review the file",
    },
  },
};

const adminNewServiceRequest: EmailTemplateDefinition = {
  key: "adminNewServiceRequest",
  labelFr: "Admin — nouvelle demande de service",
  labelEn: "Admin — new service request",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'un client soumet une nouvelle demande de service. Lorsque la demande est urgente (consultation ponctuelle rapide), le contenu signalé entre {{#isEmergency}}…{{/isEmergency}} est affiché. Le bouton « Voir les demandes » mène à la file des demandes de service.",
  descriptionEn:
    "Alert sent to administrators when a client submits a new service request. When the request is urgent (quick one-off consultation), the flagged content between {{#isEmergency}}…{{/isEmergency}} is shown. The \"View requests\" button leads to the service-requests queue.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie Lavoie",
      sampleEn: "Marie Lavoie",
    },
    {
      key: "clientEmail",
      labelFr: "Courriel du client",
      labelEn: "Client email",
      sampleFr: "marie@example.com",
      sampleEn: "marie@example.com",
    },
    {
      key: "bookingFor",
      labelFr: "Pour qui (le client lui-même ou un proche)",
      labelEn: "Booking for (the client or a loved one)",
      sampleFr: "Pour moi-même",
      sampleEn: "For myself",
    },
    {
      key: "motifs",
      labelFr: "Motif(s) de consultation",
      labelEn: "Reason(s) for consultation",
      sampleFr: "Anxiété, Stress",
      sampleEn: "Anxiety, Stress",
    },
    {
      key: "appointmentId",
      labelFr: "Identifiant du rendez-vous",
      labelEn: "Appointment ID",
      sampleFr: "664f1a2b3c4d5e6f7a8b9c0d",
      sampleEn: "664f1a2b3c4d5e6f7a8b9c0d",
    },
    {
      key: "isEmergency",
      labelFr: "Demande urgente (afficher le contenu d'urgence)",
      labelEn: "Urgent request (show emergency content)",
      sampleFr: "1",
      sampleEn: "1",
    },
  ],
  defaults: {
    fr: {
      subject:
        "{{#isEmergency}}⚠ URGENCE — Nouvelle demande — {{clientName}}{{/isEmergency}}{{^isEmergency}}Nouvelle demande — {{clientName}}{{/isEmergency}}",
      title:
        "{{#isEmergency}}⚠ Nouvelle demande URGENTE{{/isEmergency}}{{^isEmergency}}Nouvelle demande de service{{/isEmergency}}",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "{{#isEmergency}}<p>⚠ Demande de rendez-vous D'URGENCE soumise par {{clientName}} ({{clientEmail}}). À traiter en priorité.</p>{{/isEmergency}}" +
        "{{^isEmergency}}<p>Une nouvelle demande de service a été soumise par {{clientName}} ({{clientEmail}}).</p>{{/isEmergency}}" +
        "{{#isEmergency}}<p><strong>Priorité :</strong> ⚠ URGENCE</p>{{/isEmergency}}" +
        "<p><strong>Client :</strong> {{clientName}}<br>" +
        "<strong>Courriel :</strong> {{clientEmail}}<br>" +
        "<strong>Pour :</strong> {{bookingFor}}<br>" +
        "<strong>Motif(s) :</strong> {{motifs}}<br>" +
        "<strong>ID Rendez-vous :</strong> {{appointmentId}}</p>",
      ctaText: "Voir les demandes",
    },
    en: {
      subject:
        "{{#isEmergency}}⚠ URGENT — New request — {{clientName}}{{/isEmergency}}{{^isEmergency}}New request — {{clientName}}{{/isEmergency}}",
      title:
        "{{#isEmergency}}⚠ New URGENT request{{/isEmergency}}{{^isEmergency}}New service request{{/isEmergency}}",
      bodyHtml:
        "<p>Hello,</p>" +
        "{{#isEmergency}}<p>⚠ URGENT appointment request submitted by {{clientName}} ({{clientEmail}}). To be handled as a priority.</p>{{/isEmergency}}" +
        "{{^isEmergency}}<p>A new service request has been submitted by {{clientName}} ({{clientEmail}}).</p>{{/isEmergency}}" +
        "{{#isEmergency}}<p><strong>Priority:</strong> ⚠ URGENT</p>{{/isEmergency}}" +
        "<p><strong>Client:</strong> {{clientName}}<br>" +
        "<strong>Email:</strong> {{clientEmail}}<br>" +
        "<strong>For:</strong> {{bookingFor}}<br>" +
        "<strong>Reason(s):</strong> {{motifs}}<br>" +
        "<strong>Appointment ID:</strong> {{appointmentId}}</p>",
      ctaText: "View requests",
    },
  },
};

const adminAppointmentMovedToGeneral: EmailTemplateDefinition = {
  key: "adminAppointmentMovedToGeneral",
  labelFr: "Admin — demande basculée en liste générale",
  labelEn: "Admin — request moved to general pool",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'une demande a été refusée par tous les professionnels proposés et bascule dans la liste générale (accessible à tous les pros). Le bouton « Assigner manuellement » mène à la file des demandes de service.",
  descriptionEn:
    "Alert sent to administrators when a request has been refused by all proposed professionals and falls back to the general pool (accessible to all pros). The \"Assign manually\" button leads to the service-requests queue.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie Lavoie",
      sampleEn: "Marie Lavoie",
    },
    {
      key: "clientEmail",
      labelFr: "Courriel du client",
      labelEn: "Client email",
      sampleFr: "marie@example.com",
      sampleEn: "marie@example.com",
    },
    {
      key: "motif",
      labelFr: "Motif de consultation",
      labelEn: "Reason for consultation",
      sampleFr: "Anxiété",
      sampleEn: "Anxiety",
    },
    {
      key: "refusalCount",
      labelFr: "Nombre de refus reçus",
      labelEn: "Number of refusals received",
      sampleFr: "2",
      sampleEn: "2",
    },
    {
      key: "appointmentId",
      labelFr: "Identifiant du rendez-vous",
      labelEn: "Appointment ID",
      sampleFr: "664f1a2b3c4d5e6f7a8b9c0d",
      sampleEn: "664f1a2b3c4d5e6f7a8b9c0d",
    },
  ],
  defaults: {
    fr: {
      subject: "Liste générale — refus en cascade pour {{clientName}}",
      title: "Demande basculée en liste générale",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "<p>La demande de {{clientName}} a été refusée par tous les professionnels proposés ({{refusalCount}}). Elle est maintenant visible dans la liste générale, accessible à tous les pros — mais elle peut rester sans suite si personne ne la prend.</p>" +
        "<p><strong>Client :</strong> {{clientName}}<br>" +
        "<strong>Courriel :</strong> {{clientEmail}}<br>" +
        "<strong>Motif :</strong> {{motif}}<br>" +
        "<strong>Refus reçus :</strong> {{refusalCount}}<br>" +
        "<strong>ID Rendez-vous :</strong> {{appointmentId}}</p>" +
        "<p>Vous pouvez assigner manuellement un professionnel depuis le tableau des demandes, ou contacter le client pour ajuster sa demande.</p>",
      ctaText: "Assigner manuellement",
    },
    en: {
      subject: "General pool — cascade refusal for {{clientName}}",
      title: "Request moved to the general pool",
      bodyHtml:
        "<p>Hello,</p>" +
        "<p>{{clientName}}'s request was refused by all proposed professionals ({{refusalCount}}). It is now visible in the general pool, accessible to all pros — but it may remain unanswered if no one takes it.</p>" +
        "<p><strong>Client:</strong> {{clientName}}<br>" +
        "<strong>Email:</strong> {{clientEmail}}<br>" +
        "<strong>Reason:</strong> {{motif}}<br>" +
        "<strong>Refusals received:</strong> {{refusalCount}}<br>" +
        "<strong>Appointment ID:</strong> {{appointmentId}}</p>" +
        "<p>You can manually assign a professional from the requests table, or contact the client to adjust their request.</p>",
      ctaText: "Assign manually",
    },
  },
};

// ---------------------------------------------------------------------------
// Admin — request returned to the service-requests queue (cascade exhausted)
// ---------------------------------------------------------------------------

const adminRequestReturnedToQueue: EmailTemplateDefinition = {
  key: "adminRequestReturnedToQueue",
  labelFr: "Admin — demande à jumeler manuellement",
  labelEn: "Admin — request to match manually",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'une demande n'a pas pu être jumelée automatiquement (refus en cascade ou délai dépassé) et revient dans « Demande de service » en attente d'une décision manuelle. Le bouton « Traiter la demande » mène à la file des demandes de service.",
  descriptionEn:
    "Alert sent to administrators when a request could not be matched automatically (cascade refusal or timeout) and returns to the \"Service request\" queue, awaiting a manual decision. The \"Process request\" button leads to the service-requests queue.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie Lavoie",
      sampleEn: "Marie Lavoie",
    },
    {
      key: "clientEmail",
      labelFr: "Courriel du client",
      labelEn: "Client email",
      sampleFr: "marie@example.com",
      sampleEn: "marie@example.com",
    },
    {
      key: "motif",
      labelFr: "Motif de consultation",
      labelEn: "Reason for consultation",
      sampleFr: "Anxiété",
      sampleEn: "Anxiety",
    },
    {
      key: "attempts",
      labelFr: "Nombre de tentatives échouées",
      labelEn: "Number of failed attempts",
      sampleFr: "2",
      sampleEn: "2",
    },
    {
      key: "appointmentId",
      labelFr: "Identifiant du rendez-vous",
      labelEn: "Appointment ID",
      sampleFr: "664f1a2b3c4d5e6f7a8b9c0d",
      sampleEn: "664f1a2b3c4d5e6f7a8b9c0d",
    },
  ],
  defaults: {
    fr: {
      subject: "À jumeler manuellement — {{clientName}}",
      title: "Demande à jumeler manuellement",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "<p>La demande de {{clientName}} n'a pas pu être jumelée automatiquement ({{attempts}} tentative(s) échouée(s) — refus ou délai de 48 h dépassé). Elle est de retour dans « Demande de service » et attend une décision manuelle : assigner un professionnel ou l'envoyer à la liste générale.</p>" +
        "<p><strong>Client :</strong> {{clientName}}<br>" +
        "<strong>Courriel :</strong> {{clientEmail}}<br>" +
        "<strong>Motif :</strong> {{motif}}<br>" +
        "<strong>Tentatives :</strong> {{attempts}}<br>" +
        "<strong>ID Rendez-vous :</strong> {{appointmentId}}</p>" +
        "<p>Tant qu'aucune action manuelle n'est prise, cette demande n'est PAS visible des professionnels.</p>",
      ctaText: "Traiter la demande",
    },
    en: {
      subject: "To match manually — {{clientName}}",
      title: "Request to match manually",
      bodyHtml:
        "<p>Hello,</p>" +
        "<p>{{clientName}}'s request could not be matched automatically ({{attempts}} failed attempt(s) — refusal or 48 h timeout exceeded). It is back in the \"Service request\" queue and awaits a manual decision: assign a professional or send it to the general pool.</p>" +
        "<p><strong>Client:</strong> {{clientName}}<br>" +
        "<strong>Email:</strong> {{clientEmail}}<br>" +
        "<strong>Reason:</strong> {{motif}}<br>" +
        "<strong>Attempts:</strong> {{attempts}}<br>" +
        "<strong>Appointment ID:</strong> {{appointmentId}}</p>" +
        "<p>Until a manual action is taken, this request is NOT visible to professionals.</p>",
      ctaText: "Process request",
    },
  },
};

// ---------------------------------------------------------------------------
// Admin — new external/contact message received
// ---------------------------------------------------------------------------

const adminNewExternalMessage: EmailTemplateDefinition = {
  key: "adminNewExternalMessage",
  labelFr: "Admin — nouveau message de contact",
  labelEn: "Admin — new contact message",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'un nouveau message externe (formulaire de contact, entreprise ou établissement scolaire) est reçu. Le téléphone {{#senderPhone}}…{{/senderPhone}} et le sujet {{#messageSubject}}…{{/messageSubject}} ne s'affichent que s'ils ont été fournis. Le bouton « Voir les messages » mène à la liste des messages de contact.",
  descriptionEn:
    "Alert sent to administrators when a new external message (contact form, enterprise or school) is received. The phone {{#senderPhone}}…{{/senderPhone}} and subject {{#messageSubject}}…{{/messageSubject}} only show when provided. The \"View messages\" button leads to the contact-messages list.",
  placeholders: [
    {
      key: "sourceLabel",
      labelFr: "Source du message",
      labelEn: "Message source",
      sampleFr: "Contact",
      sampleEn: "Contact",
    },
    {
      key: "senderName",
      labelFr: "Nom de l'expéditeur",
      labelEn: "Sender name",
      sampleFr: "Marie Lavoie",
      sampleEn: "Marie Lavoie",
    },
    {
      key: "senderEmail",
      labelFr: "Courriel de l'expéditeur",
      labelEn: "Sender email",
      sampleFr: "marie@example.com",
      sampleEn: "marie@example.com",
    },
    {
      key: "senderPhone",
      labelFr: "Téléphone de l'expéditeur (optionnel)",
      labelEn: "Sender phone (optional)",
      sampleFr: "514 555-0142",
      sampleEn: "514 555-0142",
    },
    {
      key: "messageSubject",
      labelFr: "Sujet du message (optionnel)",
      labelEn: "Message subject (optional)",
      sampleFr: "Demande d'information",
      sampleEn: "Information request",
    },
    {
      key: "preview",
      labelFr: "Aperçu du message",
      labelEn: "Message preview",
      sampleFr: "Bonjour, j'aimerais en savoir plus sur vos services…",
      sampleEn: "Hello, I would like to know more about your services…",
    },
  ],
  defaults: {
    fr: {
      subject: "Nouveau message — {{sourceLabel}} — {{senderName}}",
      title: "Nouveau message de contact",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "<p>Un nouveau message ({{sourceLabel}}) a été reçu de {{senderName}} ({{senderEmail}}).</p>" +
        "<p><strong>Source :</strong> {{sourceLabel}}<br>" +
        "<strong>Nom :</strong> {{senderName}}<br>" +
        "<strong>Courriel :</strong> {{senderEmail}}" +
        "{{#senderPhone}}<br><strong>Téléphone :</strong> {{senderPhone}}{{/senderPhone}}" +
        "{{#messageSubject}}<br><strong>Sujet :</strong> {{messageSubject}}{{/messageSubject}}</p>" +
        "<p><strong>Message :</strong><br>{{preview}}</p>",
      ctaText: "Voir les messages",
    },
    en: {
      subject: "New message — {{sourceLabel}} — {{senderName}}",
      title: "New contact message",
      bodyHtml:
        "<p>Hello,</p>" +
        "<p>A new message ({{sourceLabel}}) was received from {{senderName}} ({{senderEmail}}).</p>" +
        "<p><strong>Source:</strong> {{sourceLabel}}<br>" +
        "<strong>Name:</strong> {{senderName}}<br>" +
        "<strong>Email:</strong> {{senderEmail}}" +
        "{{#senderPhone}}<br><strong>Phone:</strong> {{senderPhone}}{{/senderPhone}}" +
        "{{#messageSubject}}<br><strong>Subject:</strong> {{messageSubject}}{{/messageSubject}}</p>" +
        "<p><strong>Message:</strong><br>{{preview}}</p>",
      ctaText: "View messages",
    },
  },
};

// ---------------------------------------------------------------------------
// Admin — match accepted but first appointment still unscheduled (escalation)
// ---------------------------------------------------------------------------

const adminUnscheduledMatchEscalation: EmailTemplateDefinition = {
  key: "adminUnscheduledMatchEscalation",
  labelFr: "Admin — jumelage sans 1er rendez-vous",
  labelEn: "Admin — match without first appointment",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'un professionnel a accepté une demande mais n'a toujours pas confirmé la date du premier rendez-vous. Le bouton « Voir la demande » mène à la file des demandes de service.",
  descriptionEn:
    "Alert sent to administrators when a professional has accepted a request but has still not confirmed the date of the first appointment. The \"See the request\" button leads to the service-requests queue.",
  placeholders: [
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie Lavoie",
      sampleEn: "Marie Lavoie",
    },
    {
      key: "clientEmail",
      labelFr: "Courriel du client",
      labelEn: "Client email",
      sampleFr: "marie@example.com",
      sampleEn: "marie@example.com",
    },
    {
      key: "professionalName",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
    {
      key: "motif",
      labelFr: "Motif de consultation",
      labelEn: "Reason for consultation",
      sampleFr: "Anxiété",
      sampleEn: "Anxiety",
    },
    {
      key: "daysWaiting",
      labelFr: "Jours d'attente",
      labelEn: "Days waiting",
      sampleFr: "3",
      sampleEn: "3",
    },
    {
      key: "appointmentId",
      labelFr: "Identifiant du rendez-vous",
      labelEn: "Appointment ID",
      sampleFr: "664f1a2b3c4d5e6f7a8b9c0d",
      sampleEn: "664f1a2b3c4d5e6f7a8b9c0d",
    },
  ],
  defaults: {
    fr: {
      subject:
        "Jumelage en attente de planification — {{clientName}} ({{daysWaiting}} j)",
      title: "Jumelage sans 1er rendez-vous",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "<p>Le professionnel {{professionalName}} a accepté la demande de {{clientName}} il y a {{daysWaiting}} jour(s), mais n'a toujours pas confirmé la date du premier rendez-vous. Le client attend — une relance du pro ou une réassignation peut être nécessaire.</p>" +
        "<p><strong>Client :</strong> {{clientName}}<br>" +
        "<strong>Courriel :</strong> {{clientEmail}}<br>" +
        "<strong>Professionnel :</strong> {{professionalName}}<br>" +
        "<strong>Motif :</strong> {{motif}}<br>" +
        "<strong>Jours d'attente :</strong> {{daysWaiting}}<br>" +
        "<strong>ID Rendez-vous :</strong> {{appointmentId}}</p>" +
        "<p>Vous pouvez relancer le professionnel, ou réassigner la demande à un autre professionnel depuis le tableau des demandes.</p>",
      ctaText: "Voir la demande",
    },
    en: {
      subject:
        "Match awaiting scheduling — {{clientName}} ({{daysWaiting}} d)",
      title: "Match without first appointment",
      bodyHtml:
        "<p>Hello,</p>" +
        "<p>Professional {{professionalName}} accepted {{clientName}}'s request {{daysWaiting}} day(s) ago, but has still not confirmed the date of the first appointment. The client is waiting — a follow-up with the professional or a reassignment may be needed.</p>" +
        "<p><strong>Client:</strong> {{clientName}}<br>" +
        "<strong>Email:</strong> {{clientEmail}}<br>" +
        "<strong>Professional:</strong> {{professionalName}}<br>" +
        "<strong>Reason:</strong> {{motif}}<br>" +
        "<strong>Days waiting:</strong> {{daysWaiting}}<br>" +
        "<strong>Appointment ID:</strong> {{appointmentId}}</p>" +
        "<p>You can follow up with the professional, or reassign the request to another professional from the requests dashboard.</p>",
      ctaText: "See the request",
    },
  },
};

const adminEmergencySlaBreach: EmailTemplateDefinition = {
  key: "adminEmergencySlaBreach",
  labelFr: "Admin — délai dépassé (consultation ponctuelle rapide)",
  labelEn: "Admin — SLA breach (quick one-off consultation)",
  descriptionFr:
    "Alerte envoyée à l'administration lorsqu'un délai SLA d'une consultation ponctuelle rapide (urgente) est dépassé. L'étape (acceptation 12 h ou prise en charge 24 h) est fournie via {{stageLabel}}. Le bloc {{#proNamePresent}}…{{/proNamePresent}} n'apparaît que si un professionnel est associé. Le bouton « Voir les demandes » mène à la file des demandes de service.",
  descriptionEn:
    "Alert sent to administrators when an SLA deadline for a quick one-off (urgent) consultation is breached. The stage (acceptance 12h or take-charge 24h) is provided via {{stageLabel}}. The {{#proNamePresent}}…{{/proNamePresent}} block only appears when a professional is associated. The \"View requests\" button leads to the service-requests queue.",
  placeholders: [
    {
      key: "stageLabel",
      labelFr: "Étape (libellé du délai dépassé)",
      labelEn: "Stage (label of the breached deadline)",
      sampleFr: "Acceptation (12 h)",
      sampleEn: "Acceptance (12h)",
    },
    {
      key: "clientName",
      labelFr: "Nom du client",
      labelEn: "Client name",
      sampleFr: "Marie Lavoie",
      sampleEn: "Marie Lavoie",
    },
    {
      key: "clientEmail",
      labelFr: "Courriel du client",
      labelEn: "Client email",
      sampleFr: "marie@example.com",
      sampleEn: "marie@example.com",
    },
    {
      key: "proName",
      labelFr: "Nom du professionnel",
      labelEn: "Professional name",
      sampleFr: "Dr Camille Tremblay",
      sampleEn: "Dr Camille Tremblay",
    },
    {
      key: "proNamePresent",
      labelFr: "Un professionnel est associé (afficher le bloc professionnel)",
      labelEn: "A professional is associated (show professional block)",
      sampleFr: "1",
      sampleEn: "1",
    },
    {
      key: "motif",
      labelFr: "Motif de consultation",
      labelEn: "Reason for consultation",
      sampleFr: "Anxiété",
      sampleEn: "Anxiety",
    },
    {
      key: "appointmentId",
      labelFr: "Identifiant du rendez-vous",
      labelEn: "Appointment ID",
      sampleFr: "664f1a2b3c4d5e6f7a8b9c0d",
      sampleEn: "664f1a2b3c4d5e6f7a8b9c0d",
    },
  ],
  defaults: {
    fr: {
      subject:
        "⚠ URGENCE — délai {{stageLabel}} dépassé — {{clientName}}",
      title: "⚠ Délai dépassé — consultation ponctuelle rapide",
      bodyHtml:
        "<p>Bonjour,</p>" +
        "<p>Le délai de « {{stageLabel}} » d'une consultation ponctuelle rapide (urgente) de {{clientName}} est dépassé{{#proNamePresent}} (professionnel : {{proName}}){{/proNamePresent}}. Le professionnel a été relancé — une réassignation rapide peut être nécessaire.</p>" +
        "<p><strong>Priorité :</strong> ⚠ URGENCE<br>" +
        "<strong>Étape :</strong> {{stageLabel}}<br>" +
        "<strong>Client :</strong> {{clientName}}<br>" +
        "<strong>Courriel :</strong> {{clientEmail}}<br>" +
        "<strong>Professionnel :</strong> {{proName}}<br>" +
        "<strong>Motif :</strong> {{motif}}<br>" +
        "<strong>ID Rendez-vous :</strong> {{appointmentId}}</p>" +
        "<p>Vous pouvez réassigner la demande depuis le tableau des demandes de service.</p>",
      ctaText: "Voir les demandes",
    },
    en: {
      subject:
        "⚠ URGENT — {{stageLabel}} deadline breached — {{clientName}}",
      title: "⚠ Deadline breached — quick one-off consultation",
      bodyHtml:
        "<p>Hello,</p>" +
        "<p>The \"{{stageLabel}}\" deadline of a quick one-off (urgent) consultation for {{clientName}} has been breached{{#proNamePresent}} (professional: {{proName}}){{/proNamePresent}}. The professional has been reminded — a quick reassignment may be necessary.</p>" +
        "<p><strong>Priority:</strong> ⚠ URGENT<br>" +
        "<strong>Stage:</strong> {{stageLabel}}<br>" +
        "<strong>Client:</strong> {{clientName}}<br>" +
        "<strong>Email:</strong> {{clientEmail}}<br>" +
        "<strong>Professional:</strong> {{proName}}<br>" +
        "<strong>Reason:</strong> {{motif}}<br>" +
        "<strong>Appointment ID:</strong> {{appointmentId}}</p>" +
        "<p>You can reassign the request from the service-requests dashboard.</p>",
      ctaText: "View requests",
    },
  },
};

// ---------------------------------------------------------------------------
// Appointment rescheduled (substitution change notice — client AND pro)
// ---------------------------------------------------------------------------

const appointmentRescheduled: EmailTemplateDefinition = {
  key: "appointmentRescheduled",
  labelFr: "Rendez-vous reporté (changement)",
  labelEn: "Appointment rescheduled (change)",
  descriptionFr:
    "Envoyé au client (et au professionnel si un admin a fait le changement) quand un rendez-vous est reporté. Les lignes ancien rendez-vous / type / lieu n'apparaissent que si l'info existe. {{byTeam}} ajoute l'attribution « par l'équipe… » uniquement dans le courriel du professionnel.",
  descriptionEn:
    "Sent to the client (and the professional if an admin made the change) when an appointment is rescheduled. The previous-appointment / type / location lines only appear when available. {{byTeam}} adds the “by the team…” attribution only in the professional's email.",
  placeholders: [
    { key: "recipientName", labelFr: "Nom du destinataire", labelEn: "Recipient name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "otherParty", labelFr: "Autre partie (pro ou client)", labelEn: "Other party (pro or client)", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "byTeam", labelFr: "Attribution (auto, courriel pro)", labelEn: "Attribution (auto, pro email)", sampleFr: " par l'équipe Je chemine", sampleEn: " by the Je chemine team" },
    { key: "prevDateTime", labelFr: "Ancien rendez-vous (si dispo.)", labelEn: "Previous appointment (if available)", sampleFr: "10 juin 2026 à 14 h", sampleEn: "June 10, 2026 at 2 PM" },
    { key: "newDate", labelFr: "Nouvelle date", labelEn: "New date", sampleFr: "12 juin 2026", sampleEn: "June 12, 2026" },
    { key: "newTime", labelFr: "Nouvelle heure", labelEn: "New time", sampleFr: "18 h 05", sampleEn: "6:05 PM" },
    { key: "type", labelFr: "Type (si dispo.)", labelEn: "Type (if available)", sampleFr: "Vidéo", sampleEn: "Video" },
    { key: "location", labelFr: "Lieu (si en personne)", labelEn: "Location (if in-person)", sampleFr: "123 rue de la Paix", sampleEn: "123 Peace Street" },
  ],
  defaults: {
    fr: {
      subject: "Votre rendez-vous a été reporté — Je chemine",
      title: "Rendez-vous reporté",
      bodyHtml:
        "<p>Bonjour {{recipientName}},</p>" +
        "<p>Votre rendez-vous avec {{otherParty}} a été reporté{{byTeam}}.</p>" +
        "{{#prevDateTime}}<p><strong>Ancien rendez-vous :</strong> {{prevDateTime}}</p>{{/prevDateTime}}" +
        "<p><strong>Nouvelle date :</strong> {{newDate}}<br><strong>Nouvelle heure :</strong> {{newTime}}{{#type}}<br><strong>Type :</strong> {{type}}{{/type}}{{#location}}<br><strong>Lieu :</strong> {{location}}{{/location}}</p>" +
        "<p>Si cette nouvelle plage ne vous convient pas, veuillez nous contacter.</p>",
    },
    en: {
      subject: "Your appointment was rescheduled — Je chemine",
      title: "Appointment rescheduled",
      bodyHtml:
        "<p>Hello {{recipientName}},</p>" +
        "<p>Your appointment with {{otherParty}} has been rescheduled{{byTeam}}.</p>" +
        "{{#prevDateTime}}<p><strong>Previous appointment:</strong> {{prevDateTime}}</p>{{/prevDateTime}}" +
        "<p><strong>New date:</strong> {{newDate}}<br><strong>New time:</strong> {{newTime}}{{#type}}<br><strong>Type:</strong> {{type}}{{/type}}{{#location}}<br><strong>Location:</strong> {{location}}{{/location}}</p>" +
        "<p>If this new time does not suit you, please contact us.</p>",
    },
  },
};

// ---------------------------------------------------------------------------
// Appointment cancelled by change/substitution (client AND pro)
// ---------------------------------------------------------------------------

const appointmentChangeCancelled: EmailTemplateDefinition = {
  key: "appointmentChangeCancelled",
  labelFr: "Rendez-vous annulé (changement)",
  labelEn: "Appointment cancelled (change)",
  descriptionFr:
    "Envoyé au client (et au professionnel si un admin a fait le changement) quand un rendez-vous est annulé via une modification. {{whenStr}} = la date/heure initiale en texte (auto). {{byTeam}} = attribution dans le courriel du pro.",
  descriptionEn:
    "Sent to the client (and the professional if an admin made the change) when an appointment is cancelled via a change. {{whenStr}} = the original date/time as text (auto). {{byTeam}} = attribution in the pro's email.",
  placeholders: [
    { key: "recipientName", labelFr: "Nom du destinataire", labelEn: "Recipient name", sampleFr: "Marie", sampleEn: "Marie" },
    { key: "whenStr", labelFr: "Quand (auto, ex. « du 10 juin… »)", labelEn: "When (auto, e.g. “on June 10…”)", sampleFr: " du 10 juin 2026 à 14 h", sampleEn: " on June 10, 2026 at 2 PM" },
    { key: "otherParty", labelFr: "Autre partie (pro ou client)", labelEn: "Other party (pro or client)", sampleFr: "Dr Camille Tremblay", sampleEn: "Dr Camille Tremblay" },
    { key: "byTeam", labelFr: "Attribution (auto, courriel pro)", labelEn: "Attribution (auto, pro email)", sampleFr: " par l'équipe Je chemine", sampleEn: " by the Je chemine team" },
    { key: "prevDate", labelFr: "Date initiale (si dispo.)", labelEn: "Original date (if available)", sampleFr: "10 juin 2026", sampleEn: "June 10, 2026" },
    { key: "prevTime", labelFr: "Heure initiale (si dispo.)", labelEn: "Original time (if available)", sampleFr: "14 h", sampleEn: "2 PM" },
  ],
  defaults: {
    fr: {
      subject: "Rendez-vous annulé — Je chemine",
      title: "Rendez-vous annulé",
      bodyHtml:
        "<p>Bonjour {{recipientName}},</p>" +
        "<p>Votre rendez-vous{{whenStr}} avec {{otherParty}} a été annulé{{byTeam}}.</p>" +
        "{{#prevDate}}<p><strong>Date initiale :</strong> {{prevDate}}</p>{{/prevDate}}" +
        "{{#prevTime}}<p><strong>Heure initiale :</strong> {{prevTime}}</p>{{/prevTime}}" +
        "<p>Si vous avez des questions ou souhaitez reprendre rendez-vous, veuillez nous contacter.</p>",
    },
    en: {
      subject: "Appointment cancelled — Je chemine",
      title: "Appointment cancelled",
      bodyHtml:
        "<p>Hello {{recipientName}},</p>" +
        "<p>Your appointment{{whenStr}} with {{otherParty}} has been cancelled{{byTeam}}.</p>" +
        "{{#prevDate}}<p><strong>Original date:</strong> {{prevDate}}</p>{{/prevDate}}" +
        "{{#prevTime}}<p><strong>Original time:</strong> {{prevTime}}</p>{{/prevTime}}" +
        "<p>If you have any questions or would like to rebook, please contact us.</p>",
    },
  },
};

export const EMAIL_TEMPLATE_DEFINITIONS: EmailTemplateDefinition[] = [
  welcomeClient,
  welcomeProfessional,
  jumelageSuccess,
  reminder72h,
  reminder48h,
  meetingLinkReady,
  paymentFailed,
  appointmentConfirmation,
  paymentInvitation,
  cancellationNotice,
  refundConfirmation,
  passwordReset,
  serviceRequestOnboarding,
  referralNewPatient,
  referralExistingMember,
  guestPaymentConfirmation,
  guestPaymentComplete,
  appointmentReminderGeneric,
  unscheduledMatchReminder,
  interacInstructions,
  interacReminder,
  accountVerification,
  passwordSetup,
  fiscalReceipt,
  postMeetingPayment,
  resendInvitation,
  appointmentTaken,
  paymentGuaranteeDay1,
  paymentGuaranteeDay2,
  paymentGuarantee48hClient,
  paymentGuarantee48hPro,
  professionalNewRequest,
  professionalApproval,
  professionalRejection,
  emergencyProSla,
  adminInteracTrustRequest,
  adminNoPaymentBeforeMeeting,
  adminNewServiceRequest,
  adminNewProfessionalSignup,
  adminAppointmentMovedToGeneral,
  adminRequestReturnedToQueue,
  adminNewExternalMessage,
  adminUnscheduledMatchEscalation,
  adminEmergencySlaBreach,
  appointmentRescheduled,
  appointmentChangeCancelled,
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
  let out = source;
  // 1) Conditional sections: {{#key}}...{{/key}} keeps the inner block only when
  //    vars[key] is truthy; {{^key}}...{{/key}} keeps it only when falsy. Looped
  //    so nested sections resolve (each pass exposes the next level), capped to
  //    avoid any pathological input spinning.
  for (let i = 0; i < 6; i++) {
    let changed = false;
    out = out.replace(
      /\{\{#\s*([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g,
      (_full, key, inner) => {
        changed = true;
        return vars[key] ? inner : "";
      },
    );
    out = out.replace(
      /\{\{\^\s*([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g,
      (_full, key, inner) => {
        changed = true;
        return vars[key] ? "" : inner;
      },
    );
    if (!changed) break;
  }
  // 2) Plain substitution. An unknown/undefined token renders EMPTY (never left
  //    as literal {{token}} text) — a missing var or admin typo must not leak
  //    "code in brackets" into a sent email.
  out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : value;
  });
  // 3) Safety net: strip ANY remaining {{...}} (malformed / unclosed / nested
  //    section markers, stray typos) so the rendered output can never contain
  //    raw mustache syntax.
  out = out.replace(/\{\{[^{}]*\}\}/g, "");
  return out;
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

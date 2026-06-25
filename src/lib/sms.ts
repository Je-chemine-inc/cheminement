/**
 * SMS via Twilio API. En production : utilise les variables d'environnement.
 * Sinon : log serveur (dev uniquement).
 */

/**
 * Normalise un numéro vers le format E.164.
 * Si le numéro commence déjà par "+" il est retourné tel quel.
 * "00213…" → "+213…".  Sinon "+" est simplement préfixé aux chiffres.
 * Le formulaire d'inscription doit demander l'indicatif complet (ex. +213XXXXXXXXX).
 */
function toE164(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return `+${digits}`;
}

/** Envoie un SMS générique via Twilio. */
export async function sendSms(toPhone: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (process.env.SMS_DRY_RUN === "true") {
    console.info(`[sms] (dry-run) Vers ${toPhone} : ${body}`);
    return;
  }

  if (sid && token && from) {
    const e164 = toE164(toPhone);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const params = new URLSearchParams({
      To: e164,
      From: from,
      Body: body,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[sms] Twilio error: ${res.status}`, errText);
      throw new Error(`Twilio SMS failed: ${res.status} ${errText}`);
    }
    return;
  }

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[sms] TWILIO_* non configuré — impossible d’envoyer le SMS en production.",
    );
    throw new Error("SMS provider not configured");
  }

  console.info(
    `[sms] (dev) Vers ${toPhone} : ${body} — configurez TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER pour l’envoi réel.`,
  );
}

/**
 * SMS épuré de demande de paiement post-séance. Accompagne le courriel de
 * facture : référence le numéro de facture et pointe vers la page de paiement.
 * Aucun reçu n'est joint — le reçu suit après confirmation du paiement.
 */
export async function sendSessionInvoiceSms(
  toPhone: string,
  data: {
    invoiceNumber: string;
    amountCad: number;
    payUrl: string;
    /** Interac deposit address — appended so the SMS offers both options. */
    depositEmail?: string;
    /** Platform contact (admin-configured) appended at the bottom of the SMS. */
    supportEmail?: string;
    supportPhone?: string;
    /** When set, prefix the SMS as a dunning reminder (1 = H+12, 2 = H+36). */
    reminderNumber?: 1 | 2;
    lang?: "fr" | "en";
  },
): Promise<void> {
  const lang = data.lang === "en" ? "en" : "fr";
  const amount =
    lang === "en"
      ? `CAD $${data.amountCad.toFixed(2)}`
      : `${data.amountCad.toFixed(2)} $ CAD`;
  // Card link first, then the mobile "Format court" Interac block (moved here
  // from the email): deposit email, amount, and the invoice number that MUST go
  // in the transfer note so we can match the payment. No account is needed for
  // either option. Only shown when a deposit email is available.
  const interac = data.depositEmail
    ? lang === "en"
      ? `\nInterac e-Transfer ⚡\n📧 Email: ${data.depositEmail}\n💰 Amount: ${amount}\n📝 Mandatory note: ${data.invoiceNumber}`
      : `\nVirement Interac ⚡\n📧 Courriel : ${data.depositEmail}\n💰 Montant : ${amount}\n📝 Note obligatoire : ${data.invoiceNumber}`
    : "";
  const lead = data.reminderNumber
    ? lang === "en"
      ? "Reminder — "
      : "Rappel — "
    : "";
  // Platform "coordonnées" at the bottom so the client can reach support about
  // the invoice — phone first (tappable on mobile), then email. Only the
  // admin-configured parts that exist are shown.
  const contactParts = [data.supportPhone, data.supportEmail].filter(
    (s): s is string => Boolean(s && s.trim()),
  );
  const contact = contactParts.length
    ? lang === "en"
      ? `\n\nℹ Questions? ${contactParts.join(" · ")}`
      : `\n\nℹ Des questions ? ${contactParts.join(" · ")}`
    : "";
  const body =
    lang === "en"
      ? `${lead}Je chemine: invoice ${data.invoiceNumber} — ${amount} for your session.\n💳 Pay by card: ${data.payUrl}${interac}${contact}`
      : `${lead}Je chemine : facture ${data.invoiceNumber} — ${amount} pour votre séance.\n💳 Payer par carte : ${data.payUrl}${interac}${contact}`;
  return sendSms(toPhone, body);
}

/** SMS pour codes OTP (validation téléphone). */
export async function sendSmsOtp(toPhone: string, code: string, lang: "fr" | "en" = "fr"): Promise<void> {
  const body = 
    lang === "en"
      ? `Your Je chemine code: ${code} (valid for 10 min). Do not share it.`
      : `Votre code Je chemine : ${code} (valide 10 min). Ne le partagez pas.`;
  return sendSms(toPhone, body);
}

/** SMS de bienvenue après inscription. */
export async function sendWelcomeSms(toPhone: string, name: string, lang: "fr" | "en" = "fr"): Promise<void> {
  const body =
    lang === "en"
      ? `Welcome to Je chemine, ${name}! We're thrilled to accompany you on your wellness journey.`
      : `Bienvenue chez Je chemine, ${name} ! Nous sommes ravis de vous accompagner dans votre cheminement vers le bien-être.`;
  return sendSms(toPhone, body);
}

/**
 * Rappel H-72 : RDV dans 72h. The link target depends on whether the recipient
 * has claimed their account — for active clients it deep-links to the dashboard
 * cancel action; for unclaimed it lands on the claim-account flow. SMS copy
 * stays neutral ("manage" / "gérer") so it's honest in both cases — promising
 * "cancel free of charge" would mislead unclaimed users who can't self-cancel
 * until they've set a password.
 */
export async function sendAppointment72hSms(
  toPhone: string,
  appointmentDateLabel: string,
  cancelUrl: string,
  lang: "fr" | "en" = "fr",
): Promise<void> {
  const body =
    lang === "en"
      ? `Je chemine: appointment in 72h (${appointmentDateLabel}). Manage: ${cancelUrl}`
      : `Je chemine : rendez-vous dans 72 h (${appointmentDateLabel}). Gérer : ${cancelUrl}`;
  return sendSms(toPhone, body);
}

/** Rappel H-48 : RDV dans 48h, annulation libre-service indisponible. */
export async function sendAppointment48hSms(
  toPhone: string,
  appointmentDateLabel: string,
  lang: "fr" | "en" = "fr",
): Promise<void> {
  const body =
    lang === "en"
      ? `Je chemine: appointment in 48h (${appointmentDateLabel}). Self-service cancellation is no longer possible — contact us for any change.`
      : `Je chemine : rendez-vous dans 48 h (${appointmentDateLabel}). L'annulation en libre-service n'est plus possible — contactez-nous pour toute modification.`;
  return sendSms(toPhone, body);
}

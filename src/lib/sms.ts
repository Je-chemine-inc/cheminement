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

/** SMS pour codes OTP (validation téléphone). */
export async function sendSmsOtp(toPhone: string, code: string, lang: "fr" | "en" = "fr"): Promise<void> {
  const body = 
    lang === "en"
      ? `Your JeChemine code: ${code} (valid for 10 min). Do not share it.`
      : `Votre code JeChemine : ${code} (valide 10 min). Ne le partagez pas.`;
  return sendSms(toPhone, body);
}

/** SMS de bienvenue après inscription. */
export async function sendWelcomeSms(toPhone: string, name: string, lang: "fr" | "en" = "fr"): Promise<void> {
  const body = 
    lang === "en"
      ? `Welcome to JeChemine, ${name}! We're thrilled to accompany you on your wellness journey.`
      : `Bienvenue chez JeChemine, ${name} ! Nous sommes ravis de vous accompagner dans votre cheminement vers le bien-être.`;
  return sendSms(toPhone, body);
}

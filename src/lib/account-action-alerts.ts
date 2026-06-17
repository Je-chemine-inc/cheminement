import connectToDatabase from "@/lib/mongodb";
import ExternalMessage from "@/models/ExternalMessage";
import { sendAdminAccountActionAlert } from "@/lib/notifications";

export type AccountActionKind = "deactivation" | "deletion_request";

export interface AccountActionRequestInput {
  kind: AccountActionKind;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  locale?: "fr" | "en";
}

/**
 * Droit à l'oubli — notifie l'admin sur DEUX canaux quand un utilisateur soumet
 * une demande de désactivation ou de suppression définitive de son compte :
 *
 *  1. notification interne : une entrée dans la boîte de réception admin
 *     (ExternalMessage, source "contact" — rendu propre, sujet explicite) ;
 *  2. courriel : alerte dédiée aux destinataires `adminAlertEmail`.
 *
 * Chaque canal est best-effort et isolé : l'échec de l'un ne doit pas empêcher
 * l'autre ni faire échouer l'action de l'utilisateur (déjà appliquée en amont).
 */
export async function recordAccountActionRequest(
  input: AccountActionRequestInput,
): Promise<void> {
  const isDeletion = input.kind === "deletion_request";
  // firstName/lastName are user-editable and uncapped at the model layer; clamp
  // to the same 200-char ceiling createExternalMessage enforces so an oversized
  // display name can't bloat the admin inbox row / email subject.
  const name = (input.userName.trim() || "Utilisateur").slice(0, 200);
  const email = input.userEmail.trim().toLowerCase();
  const locale = input.locale === "en" ? "en" : "fr";

  const subject = isDeletion
    ? `Demande de suppression définitive du compte — ${name}`
    : `Désactivation du compte — ${name}`;

  const message = isDeletion
    ? `${name} (${email}, rôle : ${input.userRole}) a demandé la suppression définitive de son compte depuis ses paramètres. Les factures et données financières doivent être conservées conformément aux obligations légales; les autres données personnelles doivent être effacées après traitement de la demande.`
    : `${name} (${email}, rôle : ${input.userRole}) a désactivé son compte depuis ses paramètres. L'accès est bloqué et les données sont conservées; le compte peut être réactivé par un administrateur.`;

  // 1) In-app admin inbox entry. Persisted even if the email send fails.
  try {
    await connectToDatabase();
    await ExternalMessage.create({
      source: "contact",
      direction: "inbound",
      locale,
      senderName: name,
      senderEmail: email,
      subject,
      message,
      metadata: {
        accountAction: input.kind,
        userId: input.userId,
        userRole: input.userRole,
      },
      userId: input.userId,
      status: "new",
    });
  } catch (e) {
    console.error("[account-action] inbox entry failed:", e);
  }

  // 2) Dedicated admin email alert.
  try {
    await sendAdminAccountActionAlert({
      kind: input.kind,
      userName: name,
      userEmail: email,
      userRole: input.userRole,
      userId: input.userId,
    });
  } catch (e) {
    console.error("[account-action] admin email failed:", e);
  }
}

/**
 * Statuts de rendez-vous qui établissent un lien pro ↔ client
 * (liste clients, fiche utilisateur, profil médical).
 * À garder aligné avec GET /api/clients.
 */
export const PROFESSIONAL_CLIENT_APPOINTMENT_STATUSES = [
  "pending",
  "scheduled",
  "ongoing",
  "completed",
  "no-show",
  "cancelled",
] as const;

/**
 * Whether a professional may view a client's user record + medical profile
 * (the "Informations de base / médicales" tabs in the request modal).
 *
 * True when a linking appointment exists (in an allowed status) that is EITHER:
 *  - assigned to them (`professionalId`), OR
 *  - actively PROPOSED to them via the matching cascade (`proposedTo` +
 *    routingStatus "proposed"), OR
 *  - sitting in the GENERAL POOL (routingStatus "general"/"refused"), which
 *    every active professional can self-claim and must therefore be able to
 *    assess.
 *
 * The earlier rule only matched `professionalId`, so a pro reviewing a request
 * that was merely proposed/pooled (no pro assigned yet) got a 403 and the
 * profile tabs rendered "Aucune donnée de profil trouvée". This mirrors exactly
 * what the professional proposals UI already surfaces.
 */
export async function professionalCanAccessClient(
  professionalId: string,
  clientId: string,
): Promise<boolean> {
  const Appointment = (await import("@/models/Appointment")).default;
  const link = await Appointment.findOne({
    clientId,
    status: { $in: Array.from(PROFESSIONAL_CLIENT_APPOINTMENT_STATUSES) },
    $or: [
      { professionalId },
      { proposedTo: professionalId, routingStatus: "proposed" },
      { routingStatus: { $in: ["general", "refused"] } },
    ],
  }).select("_id");
  return Boolean(link);
}

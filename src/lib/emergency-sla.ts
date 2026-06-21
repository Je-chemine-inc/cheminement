import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import "@/models/User"; // register the User model so populate() resolves refs
import {
  sendEmergencyProSlaAlert,
  sendAdminEmergencySlaBreachAlert,
} from "@/lib/notifications";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Urgent ("Consultation ponctuelle rapide" / isEmergency) TAKE-CHARGE soft SLA:
 * a pro who ACCEPTED commits to confirm the 1st RDV within 12h. When that lapses,
 * the daily cron below nudges the assigned pro AND alerts admins, but the request
 * STAYS assigned (no auto-reassign — the client chose soft for this stage).
 *
 * The earlier ACCEPT-stage deadline is HARD, not soft (§3): a proposal not
 * accepted within 24h (regular) / 12h (urgent) advances the cascade — handled by
 * the proposal timeout (see proposal-timeout.ts), not here.
 *
 * NOTE: Vercel Hobby allows DAILY crons only, so a 12h deadline is detected up to
 * ~24h late (one daily-cron cycle). The deadline is exact; only detection lags.
 * The alert is one-shot via takeChargeSlaAlertSent (reset on each acceptance).
 */
export const EMERGENCY_TAKE_CHARGE_SLA_HOURS = 12;

type PopulatedUser = {
  firstName?: string;
  lastName?: string;
  email?: string;
  language?: string;
} | null;

function fullName(u: PopulatedUser): string {
  return `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim();
}

/**
 * Urgent matches where the pro ACCEPTED but hasn't confirmed the 1st RDV within
 * 12h. Nudges the assigned pro and alerts admins, then marks takeChargeSlaAlertSent
 * (reset on each acceptance). The request STAYS assigned (soft enforcement).
 */
export async function runEmergencyTakeChargeSlaAlerts(): Promise<{ alerted: number }> {
  await connectToDatabase();
  const cutoff = new Date(Date.now() - EMERGENCY_TAKE_CHARGE_SLA_HOURS * HOUR_MS);

  const candidates = await Appointment.find({
    isEmergency: true,
    routingStatus: "accepted",
    status: "pending",
    professionalId: { $exists: true, $ne: null },
    takeChargeSlaAlertSent: { $ne: true },
    $or: [
      { matchedAt: { $lte: cutoff } },
      { matchedAt: { $exists: false }, createdAt: { $lte: cutoff } },
    ],
  })
    .populate("professionalId", "firstName lastName email language")
    .populate("clientId", "firstName lastName email")
    .limit(500);

  let alerted = 0;
  for (const apt of candidates) {
    const client = apt.clientId as unknown as PopulatedUser;
    const pro = apt.professionalId as unknown as PopulatedUser;
    const clientName = fullName(client) || "Client";

    if (pro?.email) {
      try {
        await sendEmergencyProSlaAlert({
          stage: "takeCharge",
          professionalName: fullName(pro),
          professionalEmail: pro.email,
          clientName,
          locale: pro.language === "en" ? "en" : "fr",
        });
      } catch (err) {
        console.error("[emergency-sla] take-charge pro alert failed:", String(apt._id), err);
      }
    }

    try {
      await sendAdminEmergencySlaBreachAlert({
        stage: "takeCharge",
        clientName,
        clientEmail: client?.email ?? "—",
        professionalName: fullName(pro) || "—",
        motif: apt.issueType,
        appointmentId: String(apt._id),
      });
    } catch (err) {
      console.error("[emergency-sla] take-charge admin alert failed:", String(apt._id), err);
    }

    await Appointment.findByIdAndUpdate(apt._id, {
      takeChargeSlaAlertSent: true,
    });
    alerted++;
  }

  return { alerted };
}

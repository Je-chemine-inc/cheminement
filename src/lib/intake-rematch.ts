import Appointment from "@/models/Appointment";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";

/**
 * Re-offer demandes that piled up unmatched while a professional's intake was
 * OFF. When a pro turns "new clients" (or "urgent consultations") back ON — by
 * themselves or via an admin — demandes that arrived with no eligible pro fell to
 * the GENERAL POOL and were never auto-pushed, leaving the queue "stuck" even
 * after reactivation (client feedback).
 *
 * The matcher hard-skips anything not strictly routingStatus "pending", so each
 * waiting (unassigned) demande is first ATOMICALLY reset to "pending" via a
 * single-winner claim (so two pros re-enabling at once can't both route the same
 * one), the cascade reopened (cascadeAttempts 0), and THIS pro pulled from
 * refusedBy so they can be re-offered (other pros' refusals preserved) — then
 * re-run through the matcher. Bounded + best-effort (never throws).
 *
 * NOTE: a demande an admin manually parked in the general pool is
 * indistinguishable from an auto-fallen one and is also re-matched here —
 * acceptable (it just gets auto-proposed instead of waiting on the self-claim
 * board). acceptingNewClients is the master gate; emergency only matters while
 * it is ON (the caller enforces this when computing the flags).
 */
export async function rematchWaitingDemandesForReenabledPro(opts: {
  proUserId: string;
  reEnabledNewClients: boolean;
  reEnabledEmergency: boolean;
}): Promise<void> {
  const { proUserId, reEnabledNewClients, reEnabledEmergency } = opts;
  if (!reEnabledNewClients && !reEnabledEmergency) return;

  try {
    const filter: Record<string, unknown> = {
      status: "pending",
      professionalId: null,
      routingStatus: { $in: ["general", "pending"] },
    };
    // Emergency-only re-enable → only urgent demandes become newly servable.
    if (reEnabledEmergency && !reEnabledNewClients) {
      filter.isEmergency = true;
    }

    const waiting = await Appointment.find(filter)
      // Oldest + urgent first; bounded so the post-response re-match stays within
      // the serverless time budget (re-enabling is rare; any overflow can be
      // re-launched by the admin's "Jumelage automatique").
      .sort({ isEmergency: -1, createdAt: 1 })
      .limit(10)
      .select("_id")
      .lean();

    for (const a of waiting) {
      try {
        const claimed = await Appointment.findOneAndUpdate(
          {
            _id: a._id,
            status: "pending",
            professionalId: null,
            routingStatus: { $in: ["general", "pending"] },
          },
          {
            $set: { routingStatus: "pending", cascadeAttempts: 0 },
            $pull: { refusedBy: proUserId },
            $unset: { proposedTo: "", proposedAt: "" },
          },
          { new: true },
        );
        if (claimed) {
          await routeAppointmentToProfessionals(String(a._id));
        }
      } catch (err) {
        console.error("[intake-rematch] re-route failed:", a._id, err);
      }
    }
  } catch (err) {
    console.error("[intake-rematch] failed:", err);
  }
}

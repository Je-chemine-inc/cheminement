import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import "@/models/User"; // register the User model so populate() resolves refs
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";

const HOUR_MS = 60 * 60 * 1000;
/**
 * A targeted proposal left unanswered (no accept/refuse) past this many hours is
 * treated EXACTLY like a refusal: the cascade advances by one attempt and the
 * matcher re-runs (next eligible pro, or the admin "Demande de service" queue
 * once the 2 attempts are exhausted). Client requirement §3 — the window is
 * isEmergency-dependent:
 *   - regular requests: 24h
 *   - urgent "Consultation ponctuelle rapide" (isEmergency): 12h
 */
export const PROPOSAL_TIMEOUT_HOURS_REGULAR = 24;
export const PROPOSAL_TIMEOUT_HOURS_URGENT = 12;

/**
 * Find proposals stuck in "proposed" past their window and advance them as if the
 * proposed professional had refused. The window is isEmergency-dependent (§3):
 * 24h for regular requests, 12h for urgent "Consultation ponctuelle rapide". Run
 * by a DAILY cron (Vercel Hobby plan allows daily only), so the cutoff is exact
 * but detection lags up to ~24h. Idempotent and concurrency-safe via the same
 * atomic claim the refuse route uses (only one actor — this job OR a live
 * refusal — flips a given proposed dossier out of "proposed").
 *
 * `proposedAt` drives the clock; legacy rows that pre-date the field fall back to
 * `createdAt` (mirrors unscheduled-match-reminders), so stuck legacy proposals
 * are cleaned up too.
 */
export async function runProposalTimeouts(): Promise<{ timedOut: number }> {
  await connectToDatabase();
  const now = Date.now();
  const urgentCutoff = new Date(now - PROPOSAL_TIMEOUT_HOURS_URGENT * HOUR_MS);
  const regularCutoff = new Date(now - PROPOSAL_TIMEOUT_HOURS_REGULAR * HOUR_MS);

  const candidates = await Appointment.find({
    routingStatus: "proposed",
    status: "pending",
    $or: [
      // Urgent "Consultation ponctuelle rapide" → 12h window.
      { isEmergency: true, proposedAt: { $lte: urgentCutoff } },
      {
        isEmergency: true,
        proposedAt: { $exists: false },
        createdAt: { $lte: urgentCutoff },
      },
      // Regular requests → 24h window.
      { isEmergency: { $ne: true }, proposedAt: { $lte: regularCutoff } },
      {
        isEmergency: { $ne: true },
        proposedAt: { $exists: false },
        createdAt: { $lte: regularCutoff },
      },
    ],
  })
    .select("_id proposedTo")
    .limit(500);

  // Surface saturation instead of silently deferring overflow to the next run.
  if (candidates.length === 500) {
    console.warn(
      "[proposal-timeout] hit batch limit of 500 — extra timed-out proposals deferred to the next run",
    );
  }

  let timedOut = 0;
  for (const c of candidates) {
    const proposedTo = c.proposedTo ?? [];

    // Atomic claim — only the actor that flips THIS dossier out of "proposed"
    // advances the cascade. A racing live refusal (which uses the same guard)
    // makes this no-op, and vice-versa, so the attempt is counted exactly once.
    // The previously-proposed pro(s) join refusedBy so the matcher won't re-pick
    // a professional who already let the request lapse.
    const claimed = await Appointment.findOneAndUpdate(
      { _id: c._id, routingStatus: "proposed", status: "pending" },
      {
        $set: { routingStatus: "pending" },
        $unset: { proposedTo: "", proposedAt: "" },
        $inc: { cascadeAttempts: 1 },
        ...(proposedTo.length
          ? { $addToSet: { refusedBy: { $each: proposedTo } } }
          : {}),
      },
    );

    if (!claimed) continue; // a concurrent refusal/re-route already handled it
    timedOut++;

    try {
      // Re-run jumelage. The matcher re-proposes to the next eligible pro, or —
      // once the 2 attempts are exhausted — drops the dossier into the general
      // pool (routingStatus "general") and alerts admins itself. Awaited so its
      // SMTP fan-out completes before the cron resolves.
      await routeAppointmentToProfessionals(String(c._id));
    } catch (err) {
      console.error("[proposal-timeout] re-route error:", String(c._id), err);
    }
  }

  return { timedOut };
}

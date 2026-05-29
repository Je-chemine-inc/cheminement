import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import "@/models/User"; // register the User model so populate() resolves refs
import {
  sendUnscheduledMatchReminder,
  sendAdminUnscheduledMatchEscalation,
} from "@/lib/notifications";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Remind the pro this many days after they accepted, if no 1st RDV yet. */
const PRO_REMINDER_AFTER_DAYS = 3;
/** Escalate to admins this many days after acceptance if still unscheduled. */
const ADMIN_ESCALATE_AFTER_DAYS = 7;

/** Matched-but-unscheduled = a pro accepted (routingStatus "accepted") but the
 *  request still has no date (status "pending"). Delays are measured from
 *  `matchedAt` (acceptance), falling back to `createdAt` for legacy rows. */
function matchedBeforeFilter(cutoff: Date) {
  return {
    routingStatus: "accepted",
    status: "pending",
    professionalId: { $exists: true, $ne: null },
    $or: [
      { matchedAt: { $lte: cutoff } },
      { matchedAt: { $exists: false }, createdAt: { $lte: cutoff } },
    ],
  };
}

/**
 * Two-stage nudge for matched-but-unscheduled requests. Safe under a daily cron
 * via per-stage dedup flags:
 *   1) PRO reminder after PRO_REMINDER_AFTER_DAYS  (firstRdvReminderSent)
 *   2) ADMIN escalation after ADMIN_ESCALATE_AFTER_DAYS (firstRdvAdminEscalatedSent),
 *      so a request never quietly rots when the pro stays unresponsive.
 */
export async function runUnscheduledMatchReminders(): Promise<{
  proReminders: number;
  adminEscalations: number;
}> {
  await connectToDatabase();
  const now = Date.now();

  // ---- Stage 1: remind the professional --------------------------------
  const proCutoff = new Date(now - PRO_REMINDER_AFTER_DAYS * DAY_MS);
  const proCandidates = await Appointment.find({
    ...matchedBeforeFilter(proCutoff),
    firstRdvReminderSent: { $ne: true },
  })
    .populate("professionalId", "firstName lastName email language")
    .populate("clientId", "firstName lastName")
    .limit(500);

  let proReminders = 0;
  for (const apt of proCandidates) {
    const pro = apt.professionalId as unknown as {
      firstName?: string;
      lastName?: string;
      email?: string;
      language?: string;
    } | null;
    const client = apt.clientId as unknown as {
      firstName?: string;
      lastName?: string;
    } | null;

    if (!pro?.email) {
      await Appointment.findByIdAndUpdate(apt._id, {
        firstRdvReminderSent: true,
      });
      continue;
    }

    const ok = await sendUnscheduledMatchReminder({
      professionalName: `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim(),
      professionalEmail: pro.email,
      clientName: `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim(),
      locale: pro.language === "en" ? "en" : "fr",
    });

    if (ok) {
      await Appointment.findByIdAndUpdate(apt._id, {
        firstRdvReminderSent: true,
      });
      proReminders++;
    }
  }

  // ---- Stage 2: escalate to admins -------------------------------------
  const adminCutoff = new Date(now - ADMIN_ESCALATE_AFTER_DAYS * DAY_MS);
  const adminCandidates = await Appointment.find({
    ...matchedBeforeFilter(adminCutoff),
    firstRdvAdminEscalatedSent: { $ne: true },
  })
    .populate("professionalId", "firstName lastName")
    .populate("clientId", "firstName lastName email")
    .limit(500);

  let adminEscalations = 0;
  for (const apt of adminCandidates) {
    const pro = apt.professionalId as unknown as {
      firstName?: string;
      lastName?: string;
    } | null;
    const client = apt.clientId as unknown as {
      firstName?: string;
      lastName?: string;
      email?: string;
    } | null;

    const since = apt.matchedAt
      ? new Date(apt.matchedAt).getTime()
      : new Date(apt.createdAt).getTime();
    const daysWaiting = Math.max(1, Math.floor((now - since) / DAY_MS));

    await sendAdminUnscheduledMatchEscalation({
      clientName:
        `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() ||
        "Client",
      clientEmail: client?.email ?? "—",
      professionalName:
        `${pro?.firstName ?? ""} ${pro?.lastName ?? ""}`.trim() || "—",
      motif: apt.issueType,
      appointmentId: String(apt._id),
      daysWaiting,
    });
    await Appointment.findByIdAndUpdate(apt._id, {
      firstRdvAdminEscalatedSent: true,
    });
    adminEscalations++;
  }

  return { proReminders, adminEscalations };
}

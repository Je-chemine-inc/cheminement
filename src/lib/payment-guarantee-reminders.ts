import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { getAppointmentStartAt } from "@/lib/appointment-start";
import { clientLacksPaymentGuaranteeForAppointment } from "@/lib/client-payment-guarantee";
import {
  sendPaymentGuaranteeDay1Reminder,
  sendPaymentGuarantee48hClientReminder,
  sendPaymentGuarantee48hProfessionalAlert,
  sendPostMeetingPaymentReminder,
  sendAdminNoPaymentBeforeMeetingAlert,
} from "@/lib/notifications";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

function formatAppointmentDateLabel(apt: {
  date?: Date;
  time?: string;
}): string {
  if (!apt.date) return "—";
  const d = new Date(apt.date);
  if (isNaN(d.getTime())) return "—";
  const dateStr = d.toLocaleDateString("fr-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return apt.time ? `${dateStr} à ${apt.time}` : dateStr;
}

/**
 * Relances automatiques : J+1 sans carte/PAD ; H-48 avant le RDV (client + pro).
 * À appeler depuis un cron (ex. toutes les heures) via `/api/cron/payment-guarantee-reminders`.
 */
export async function runPaymentGuaranteeReminders(): Promise<{
  day1Sent: number;
  h48ClientSent: number;
  h48ProSent: number;
  postMeetingSent: number;
}> {
  await connectToDatabase();
  const now = Date.now();
  const billingUrl = `${getBaseUrl()}/client/dashboard/billing`;

  let day1Sent = 0;
  let h48ClientSent = 0;
  let h48ProSent = 0;

  const day1Cutoff = new Date(now - DAY_MS);
  const day1Candidates = await Appointment.find({
    status: "scheduled",
    firstScheduledAt: { $lte: day1Cutoff, $exists: true },
    guaranteeDay1ReminderSent: { $ne: true },
  }).populate("clientId", "firstName lastName email");

  for (const apt of day1Candidates) {
    const clientPop = apt.clientId as unknown as {
      _id: { toString: () => string };
      firstName: string;
      lastName: string;
      email: string;
    };
    const user = await User.findById(clientPop._id);
    if (!user) continue;
    if (!clientLacksPaymentGuaranteeForAppointment(apt, user)) continue;

    const ok = await sendPaymentGuaranteeDay1Reminder({
      clientName: `${clientPop.firstName} ${clientPop.lastName}`,
      clientEmail: clientPop.email,
      billingUrl,
    });
    if (ok) {
      await Appointment.findByIdAndUpdate(apt._id, {
        guaranteeDay1ReminderSent: true,
      });
      day1Sent++;
    }
  }

  const upcoming = await Appointment.find({
    status: "scheduled",
    date: { $exists: true },
    $or: [
      { guarantee48hClientReminderSent: { $ne: true } },
      { guarantee48hProfessionalAlertSent: { $ne: true } },
    ],
  })
    .populate("clientId", "firstName lastName email")
    .populate("professionalId", "firstName lastName email")
    .limit(500);

  for (const apt of upcoming) {
    const start = getAppointmentStartAt(apt);
    if (!start) continue;
    const t = start.getTime();
    if (t <= now) continue;
    if (t > now + 48 * HOUR_MS) continue;

    const clientPop = apt.clientId as unknown as {
      _id: { toString: () => string };
      firstName: string;
      lastName: string;
      email: string;
    };
    const user = await User.findById(clientPop._id);
    if (!user) continue;
    if (!clientLacksPaymentGuaranteeForAppointment(apt, user)) continue;

    const dateLabel = formatAppointmentDateLabel(apt);
    const updates: Record<string, boolean> = {};

    if (!apt.guarantee48hClientReminderSent) {
      const ok = await sendPaymentGuarantee48hClientReminder({
        clientName: `${clientPop.firstName} ${clientPop.lastName}`,
        clientEmail: clientPop.email,
        billingUrl,
        appointmentDateLabel: dateLabel,
      });
      if (ok) {
        updates.guarantee48hClientReminderSent = true;
        h48ClientSent++;
      }
    }

    if (!apt.guarantee48hProfessionalAlertSent && apt.professionalId) {
      const pro = apt.professionalId as unknown as {
        firstName?: string;
        lastName?: string;
        email?: string;
      };
      if (pro.email) {
        const ok = await sendPaymentGuarantee48hProfessionalAlert({
          professionalEmail: pro.email,
          professionalName: `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim(),
          clientName: `${clientPop.firstName} ${clientPop.lastName}`,
          appointmentDateLabel: dateLabel,
          appointmentId: String(apt._id),
        });
        if (ok) {
          updates.guarantee48hProfessionalAlertSent = true;
          h48ProSent++;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await Appointment.findByIdAndUpdate(apt._id, { $set: updates });
    }
  }

  // Post-meeting: clients who had no payment method at the time of their session
  let postMeetingSent = 0;
  const postMeetingCandidates = await Appointment.find({
    status: { $in: ["completed", "no-show"] },
    postMeetingPaymentReminderSent: { $ne: true },
    date: { $exists: true },
  })
    .populate("clientId", "firstName lastName email language")
    .limit(200);

  for (const apt of postMeetingCandidates) {
    const clientPop = apt.clientId as unknown as {
      _id: { toString: () => string };
      firstName: string;
      lastName: string;
      email: string;
      language?: string;
    };
    const user = await User.findById(clientPop._id);
    if (!user) continue;
    if (!clientLacksPaymentGuaranteeForAppointment(apt, user)) continue;

    const dateLabel = formatAppointmentDateLabel(apt);
    const locale: "fr" | "en" = clientPop.language === "fr" ? "fr" : "en";

    const [clientOk] = await Promise.all([
      sendPostMeetingPaymentReminder({
        clientName: `${clientPop.firstName} ${clientPop.lastName}`,
        clientEmail: clientPop.email,
        appointmentDateLabel: dateLabel,
        locale,
      }),
      sendAdminNoPaymentBeforeMeetingAlert({
        clientName: `${clientPop.firstName} ${clientPop.lastName}`,
        clientEmail: clientPop.email,
        appointmentDateLabel: dateLabel,
        appointmentId: String(apt._id),
      }),
    ]);

    if (clientOk) {
      await Appointment.findByIdAndUpdate(apt._id, {
        $set: { postMeetingPaymentReminderSent: true },
      });
      postMeetingSent++;
    }
  }

  return { day1Sent, h48ClientSent, h48ProSent, postMeetingSent };
}

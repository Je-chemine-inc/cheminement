import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import {
  sendInteracPaymentReminder,
  sendAdminInteracTrustRequestAlert,
} from "@/lib/notifications";

const HOUR_MS = 60 * 60 * 1000;

function formatDateLabel(apt: { date?: Date; time?: string }): string {
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
 * Relances automatiques Interac :
 * - J+1 (24h après transferDueAt) : première relance courriel
 * - J+2 (48h après transferDueAt) : deuxième relance courriel
 * - J+3 (72h après transferDueAt) : bascule payment.status → "overdue" + alerte admin
 */
export async function runInteracReminders(): Promise<{
  reminder24hSent: number;
  reminder48hSent: number;
  markedOverdue: number;
}> {
  await connectToDatabase();
  const now = Date.now();
  const depositEmail = await getInteracDepositEmail();

  let reminder24hSent = 0;
  let reminder48hSent = 0;
  let markedOverdue = 0;

  // Appointments with Interac pending payment and a transferDueAt set
  const candidates = await Appointment.find({
    "payment.method": "transfer",
    "payment.status": { $nin: ["paid", "refunded", "cancelled"] },
    "payment.transferDueAt": { $exists: true, $lt: new Date(now - 24 * HOUR_MS) },
  })
    .populate("clientId", "firstName lastName email")
    .populate("professionalId", "firstName lastName email")
    .limit(300);

  for (const apt of candidates) {
    const client = apt.clientId as unknown as {
      firstName: string;
      lastName: string;
      email: string;
    };
    if (!client?.email) continue;

    const dueAt = apt.payment.transferDueAt!.getTime();
    const hoursOverdue = (now - dueAt) / HOUR_MS;
    const dateLabel = formatDateLabel(apt);
    const updates: Record<string, unknown> = {};

    // 72h+ → mark overdue + admin alert
    if (hoursOverdue >= 72 && apt.payment.status !== "overdue") {
      updates["payment.status"] = "overdue";
      markedOverdue++;

      const pro = apt.professionalId as unknown as {
        firstName?: string;
        lastName?: string;
        email?: string;
      } | null;
      // Reuse existing admin alert with the interac trust context
      await sendAdminInteracTrustRequestAlert({
        clientName: `${client.firstName} ${client.lastName}`,
        clientEmail: client.email,
      }).catch(() => {});
      void pro; // alert already covers admin
    }

    // 48h+ → second reminder (only if first was already sent)
    if (hoursOverdue >= 48 && !apt.interacReminder48hSent) {
      const ok = await sendInteracPaymentReminder({
        clientName: `${client.firstName} ${client.lastName}`,
        clientEmail: client.email,
        depositEmail,
        amountCad: apt.payment.price,
        interacReferenceCode: apt.payment.interacReferenceCode || "",
        appointmentDateLabel: dateLabel,
        reminderNumber: 2,
      });
      if (ok) {
        updates.interacReminder48hSent = true;
        reminder48hSent++;
      }
    }

    // 24h+ → first reminder
    if (hoursOverdue >= 24 && !apt.interacReminder24hSent) {
      const ok = await sendInteracPaymentReminder({
        clientName: `${client.firstName} ${client.lastName}`,
        clientEmail: client.email,
        depositEmail,
        amountCad: apt.payment.price,
        interacReferenceCode: apt.payment.interacReferenceCode || "",
        appointmentDateLabel: dateLabel,
        reminderNumber: 1,
      });
      if (ok) {
        updates.interacReminder24hSent = true;
        reminder24hSent++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await Appointment.findByIdAndUpdate(apt._id, { $set: updates });
    }
  }

  return { reminder24hSent, reminder48hSent, markedOverdue };
}

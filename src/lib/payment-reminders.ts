import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import { resolveBillingUrl } from "@/lib/client-portal-urls";
import {
  sendSessionInvoiceEmail,
  sendAdminPaymentOverdueAlert,
} from "@/lib/notifications";
import { sendSessionInvoiceSms } from "@/lib/sms";

const HOUR_MS = 60 * 60 * 1000;
const BILLABLE_OUTCOMES = ["completed", "cancelled_late", "no_show"];

function appUrlBase(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

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
 * Relances automatiques post-séance pour TOUTE facture impayée (carte OU
 * Interac — le courriel post-séance propose les deux). Ancré sur
 * `sessionCompletedAt` (H+0 = clôture de la séance) :
 *   - H+12 : 1ʳᵉ relance (courriel + SMS)
 *   - H+36 : 2ᵉ relance (courriel + SMS)
 *   - H+48 : bascule `payment.status` → "overdue" + alerte admin (suivi humain)
 *
 * Idempotent : drapeaux `paymentReminder12hSent` / `paymentReminder36hSent` et
 * l'état "overdue". Sûr en exécution répétée (horaire ou quotidienne). Les
 * relances suivent l'ordre (la 2ᵉ n'est envoyée qu'après la 1ʳᵉ), donc une
 * facture vue tardivement reçoit #1 puis #2 sur des passages successifs.
 */
export async function runPaymentReminders(): Promise<{
  firstReminders: number;
  secondReminders: number;
  markedOverdue: number;
}> {
  await connectToDatabase();
  const now = Date.now();
  const depositEmail = await getInteracDepositEmail();
  const base = appUrlBase();

  let firstReminders = 0;
  let secondReminders = 0;
  let markedOverdue = 0;

  const candidates = await Appointment.find({
    "payment.status": "pending",
    "payment.price": { $gt: 0 },
    invoiceNumber: { $exists: true, $ne: null },
    sessionOutcome: { $in: BILLABLE_OUTCOMES },
    sessionCompletedAt: { $exists: true, $lte: new Date(now - 12 * HOUR_MS) },
    // A billed appointment later cancelled at the appointment level no longer
    // owes — keep genuine debts (not cancelled, plus late cancellations which
    // are billed 100% as a fee yet carry appointment status "cancelled").
    $or: [{ status: { $ne: "cancelled" } }, { sessionOutcome: "cancelled_late" }],
  })
    .populate("clientId", "firstName lastName email language phone status")
    .populate("professionalId", "firstName lastName")
    .limit(300);

  for (const apt of candidates) {
    const client = apt.clientId as unknown as {
      firstName: string;
      lastName: string;
      email: string;
      language?: string;
      phone?: string;
      status?: string;
    };
    if (!client?.email || !apt.sessionCompletedAt || !apt.invoiceNumber) {
      continue;
    }

    // Quebec LSSSS art. 14: for adult loved-one bookings, route the reminder to
    // the beneficiary; minors (< 14) still go through the requester/guardian.
    const recipient = resolveAppointmentRecipient(
      { bookingFor: apt.bookingFor, lovedOneInfo: apt.lovedOneInfo },
      client,
    );
    const ageH = (now - new Date(apt.sessionCompletedAt).getTime()) / HOUR_MS;
    const pro = apt.professionalId as unknown as {
      firstName?: string;
      lastName?: string;
    } | null;
    const professionalName = `${pro?.firstName ?? ""} ${
      pro?.lastName ?? ""
    }`.trim();
    const invoiceNumber = apt.invoiceNumber as string;
    const amountCad = apt.payment.price;

    // H+48 → "Paiement en retard" + admin alert, then stop dunning.
    if (ageH >= 48 && apt.payment.status !== "overdue") {
      await Appointment.findByIdAndUpdate(apt._id, {
        $set: { "payment.status": "overdue" },
      });
      markedOverdue++;
      await sendAdminPaymentOverdueAlert({
        clientName: recipient.name,
        clientEmail: recipient.email,
        professionalName,
        amountCad,
        invoiceNumber,
        appointmentId: String(apt._id),
      }).catch((err) => console.error("sendAdminPaymentOverdueAlert:", err));
      continue;
    }

    const dateLabel = formatDateLabel(apt);
    const clientLegalName = `${client.firstName} ${client.lastName}`.trim();
    // Always the no-login pay link (works with or without an account).
    const payUrl = await resolveBillingUrl({
      userStatus: client.status,
      appointment: apt,
      base,
      recipientLocale: recipient.language,
      forceTokenLink: true,
    });

    const sendReminder = async (n: 1 | 2) => {
      await sendSessionInvoiceEmail({
        clientEmail: recipient.email,
        clientName: recipient.name,
        amountCad,
        invoiceNumber,
        appointmentDateLabel: dateLabel,
        payUrl,
        depositEmail,
        clientLegalName,
        professionalName,
        reminderNumber: n,
        locale: recipient.language,
      }).catch((err) => console.error("payment reminder email:", err));
      if (client.phone) {
        await sendSessionInvoiceSms(client.phone, {
          invoiceNumber,
          amountCad,
          payUrl,
          depositEmail,
          reminderNumber: n,
          lang: recipient.language,
        }).catch((err) => console.error("payment reminder sms:", err));
      }
    };

    if (
      ageH >= 36 &&
      apt.paymentReminder12hSent &&
      !apt.paymentReminder36hSent
    ) {
      // H+36 → second reminder (only after the first one fired, to keep order).
      await sendReminder(2);
      await Appointment.findByIdAndUpdate(apt._id, {
        $set: { paymentReminder36hSent: true },
      });
      secondReminders++;
    } else if (ageH >= 12 && !apt.paymentReminder12hSent) {
      // H+12 → first reminder.
      await sendReminder(1);
      await Appointment.findByIdAndUpdate(apt._id, {
        $set: { paymentReminder12hSent: true },
      });
      firstReminders++;
    }
  }

  return { firstReminders, secondReminders, markedOverdue };
}

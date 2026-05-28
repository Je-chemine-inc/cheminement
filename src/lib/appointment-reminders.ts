import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { getAppointmentStartAt } from "@/lib/appointment-start";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import { clientLacksPaymentGuaranteeForAppointment } from "@/lib/client-payment-guarantee";
import {
  resolveBillingUrl,
  resolveAppointmentManageUrl,
} from "@/lib/client-portal-urls";
import {
  sendAppointment72hReminder,
  sendAppointment48hReminder,
} from "@/lib/notifications";
import {
  sendAppointment72hSms,
  sendAppointment48hSms,
} from "@/lib/sms";

const HOUR_MS = 60 * 60 * 1000;

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

function formatAppointmentDateLabel(
  apt: { date?: Date; time?: string },
  lang: "fr" | "en",
): string {
  if (!apt.date) return "—";
  const d = new Date(apt.date);
  if (isNaN(d.getTime())) return "—";
  const dateStr = d.toLocaleDateString(lang === "fr" ? "fr-CA" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const at = lang === "fr" ? "à" : "at";
  return apt.time ? `${dateStr} ${at} ${apt.time}` : dateStr;
}

/**
 * Sends two reminders before each scheduled appointment:
 *   - H-72 (window 72h..48h before): email + SMS, includes cancel + reschedule links
 *   - H-48 (window 48h..0h  before): email + SMS, NO cancel/reschedule (policy)
 *
 * Designed to be safe under hourly cron: each branch dedupes via boolean
 * flags on the Appointment document.
 */
export async function runAppointmentReminders(): Promise<{
  reminder72hSent: number;
  reminder48hSent: number;
}> {
  await connectToDatabase();
  const now = Date.now();
  const baseUrl = getBaseUrl();

  let reminder72hSent = 0;
  let reminder48hSent = 0;

  // Pull every upcoming scheduled appointment that might still need a reminder.
  const upcoming = await Appointment.find({
    status: "scheduled",
    date: { $exists: true },
    $or: [
      { reminder72hSent: { $ne: true } },
      { reminder48hSent: { $ne: true } },
    ],
  })
    .populate("clientId", "firstName lastName email phone language")
    .populate("professionalId", "firstName lastName")
    .limit(500);

  for (const apt of upcoming) {
    const start = getAppointmentStartAt(apt);
    if (!start) continue;
    const hoursUntil = (start.getTime() - now) / HOUR_MS;
    if (hoursUntil <= 0) continue;

    const client = apt.clientId as unknown as {
      _id: { toString: () => string };
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      language?: string;
    } | null;
    if (!client?.email) continue;

    const professional = apt.professionalId as unknown as {
      firstName?: string;
      lastName?: string;
    } | null;
    const professionalName = professional
      ? `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim()
      : undefined;

    // Quebec LSSSS art. 14: route appointment reminders to the beneficiary
    // (the loved one is the one attending), unless they're a minor under 14.
    const recipient = resolveAppointmentRecipient(
      { bookingFor: apt.bookingFor, lovedOneInfo: apt.lovedOneInfo },
      client,
    );
    const recipientPhone = recipient.isLovedOne
      ? apt.lovedOneInfo?.phone || client.phone
      : client.phone;
    const locale = recipient.language;
    const dateLabel = formatAppointmentDateLabel(apt, locale);
    // Resolve URLs based on whether the account holder has claimed their
    // account. Unclaimed accounts (no password yet) cannot reach auth-gated
    // dashboard routes; for them the helpers fall back to /pay?token=… and
    // /signup/member?email=… respectively. The full User doc is also reused
    // below to compute `noPaymentMethod` for the H-48 reminder.
    const accountHolder = await User.findById(client._id);
    const userStatus = accountHolder?.status;
    const cancelUrl = resolveAppointmentManageUrl({
      userStatus,
      recipientEmail: recipient.email,
      appointmentId: String(apt._id),
      action: "cancel",
      base: baseUrl,
    });
    const rescheduleUrl = resolveAppointmentManageUrl({
      userStatus,
      recipientEmail: recipient.email,
      appointmentId: String(apt._id),
      action: "reschedule",
      base: baseUrl,
    });
    const updates: Record<string, boolean> = {};

    // H-72 window: 48h < hoursUntil <= 72h
    if (!apt.reminder72hSent && hoursUntil > 48 && hoursUntil <= 72) {
      const ok = await sendAppointment72hReminder({
        clientName: recipient.name,
        clientEmail: recipient.email,
        professionalName,
        appointmentDateLabel: dateLabel,
        cancelUrl,
        rescheduleUrl,
        locale,
      });
      if (ok) {
        updates.reminder72hSent = true;
        reminder72hSent++;
        if (recipientPhone) {
          await sendAppointment72hSms(
            recipientPhone,
            dateLabel,
            cancelUrl,
            locale,
          ).catch((err) =>
            console.error("sendAppointment72hSms:", err),
          );
        }
      }
    }

    // H-48 window: 0h < hoursUntil <= 48h
    if (!apt.reminder48hSent && hoursUntil > 0 && hoursUntil <= 48) {
      // Only add the "Choose payment method" CTA if the requester (the
      // account holder) still has no card / direct debit / Interac choice.
      // The lookup hits the requester's User doc because payment lives there,
      // even when the email goes to the loved one.
      const noPaymentMethod =
        accountHolder != null &&
        clientLacksPaymentGuaranteeForAppointment(apt, accountHolder);

      // Resolve URLs based on whether the account is claimed (active).
      // Re-using the helper from H-72 above keeps the auth-gating consistent.
      const confirmUrl = resolveAppointmentManageUrl({
        userStatus: userStatus,
        recipientEmail: recipient.email,
        appointmentId: String(apt._id),
        action: "confirm",
        base: baseUrl,
      });
      const billingUrl = noPaymentMethod
        ? await resolveBillingUrl({
            userStatus: userStatus,
            appointment: apt,
            base: baseUrl,
          })
        : undefined;

      const ok = await sendAppointment48hReminder({
        clientName: recipient.name,
        clientEmail: recipient.email,
        professionalName,
        appointmentId: String(apt._id),
        appointmentDateLabel: dateLabel,
        noPaymentMethod,
        locale,
        confirmUrl,
        billingUrl,
      });
      if (ok) {
        updates.reminder48hSent = true;
        reminder48hSent++;
        if (recipientPhone) {
          await sendAppointment48hSms(recipientPhone, dateLabel, locale).catch(
            (err) => console.error("sendAppointment48hSms:", err),
          );
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await Appointment.findByIdAndUpdate(apt._id, { $set: updates });
    }
  }

  return { reminder72hSent, reminder48hSent };
}

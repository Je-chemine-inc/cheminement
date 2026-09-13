import { after } from "next/server";
import Profile from "@/models/Profile";
import User from "@/models/User";
import type { IAppointment } from "@/models/Appointment";
import {
  sendGuestPaymentConfirmation,
  sendPaymentInvitation,
} from "@/lib/notifications";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import { resolveBillingUrl } from "@/lib/client-portal-urls";
import { resolveSessionLocation } from "@/lib/session-location";

/**
 * The two halves of confirming a client's FIRST appointment, shared by
 * schedule-first (a matched request) and accept-direct (a request from a
 * showcase page, spec 003): where an in-person session happens, and the single
 * email that confirms it and carries the payment invitation. Moved out of
 * schedule-first unchanged, so both paths behave exactly alike.
 */

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

/**
 * Where an in-person first session happens: what the professional just typed,
 * then whatever the appointment already carries, then their saved office
 * address. Null when nothing states it — the caller refuses to confirm.
 *
 * A typed address becomes the professional's default office when asked, so
 * they type it once rather than at every first appointment; stored on
 * `street` because what they typed is a single line, and never over an office
 * address they already set.
 */
export async function resolveFirstAppointmentLocation(input: {
  professionalId: string;
  typed?: string;
  current?: string;
  saveAsDefaultOffice?: boolean;
  logPrefix: string;
}): Promise<string | null> {
  const typed = input.typed?.trim();
  let resolved = typed || input.current?.trim() || "";

  const profile = await Profile.findOne({ userId: input.professionalId })
    .select("officeAddress officeNotes")
    .lean();

  if (!resolved) {
    const office = resolveSessionLocation({
      appointmentType: "in-person",
      officeAddress: profile?.officeAddress,
    });
    resolved = office.lines.join(", ");
  }

  if (!resolved) return null;

  if (input.saveAsDefaultOffice && typed && profile && !profile.officeAddress?.street) {
    await Profile.updateOne(
      { userId: input.professionalId },
      { $set: { "officeAddress.street": typed } },
    ).catch((err) =>
      console.error(`${input.logPrefix} saving default office failed:`, err),
    );
  }
  return resolved;
}

type PopulatedClient = {
  _id: { toString: () => string };
  firstName?: string;
  lastName?: string;
  email?: string;
  language?: string;
  role?: string;
  status?: string;
} | null;

/**
 * Queue the single 1st-RDV confirmation email. An active client gets the
 * payment invitation; anyone else (a guest, an account not yet claimed) gets
 * the guest confirmation with the link to finish their account. The
 * appointment must be saved and its client populated with
 * `firstName lastName email language role status`.
 */
export async function queueFirstAppointmentConfirmation(input: {
  appointment: IAppointment;
  professionalId: string;
  logPrefix: string;
}): Promise<void> {
  const { appointment, logPrefix } = input;
  const client = appointment.clientId as unknown as PopulatedClient;
  if (!client?.email || !appointment.date || !appointment.time) return;

  const date = appointment.date.toISOString();
  const time = appointment.time;
  const professional = await User.findById(input.professionalId)
    .select("firstName lastName email")
    .lean();
  const professionalName = professional
    ? `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim()
    : undefined;

  const isActiveClient = client.role === "client" && client.status === "active";

  // Quebec LSSSS art. 14: adult loved-one bookings route to the beneficiary.
  const recipient = resolveAppointmentRecipient(
    {
      bookingFor: appointment.bookingFor,
      lovedOneInfo: appointment.lovedOneInfo,
    },
    {
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      language: client.language,
    },
  );
  const locale = recipient.language;
  const base = getBaseUrl();

  const billingUrl = await resolveBillingUrl({
    userStatus: isActiveClient ? "active" : "inactive",
    appointment: appointment as Parameters<
      typeof resolveBillingUrl
    >[0]["appointment"],
    base,
    recipientLocale: locale,
  });

  if (!isActiveClient) {
    const guestPayArgs = {
      guestName: recipient.name,
      guestEmail: recipient.email,
      professionalName,
      date,
      time,
      duration: appointment.duration || 60,
      type: appointment.type,
      therapyType:
        (appointment.therapyType as "solo" | "couple" | "group") || "solo",
      price: appointment.payment?.price ?? 0,
      paymentLink: billingUrl,
      locale,
      // Nudge the guest to finalize their account (parallel to the jumelage
      // email) — claim flow seeded with their email.
      completeAccountUrl: `${base}/signup/member?email=${encodeURIComponent(
        recipient.email,
      )}`,
    };
    after(() =>
      sendGuestPaymentConfirmation(guestPayArgs).catch((err) =>
        console.error(`${logPrefix} guest confirmation error:`, err),
      ),
    );
    return;
  }

  const payInviteArgs = {
    clientName: recipient.name,
    clientEmail: recipient.email,
    professionalName: professionalName ?? "",
    professionalEmail: professional?.email ?? "",
    date,
    time,
    duration: appointment.duration || 60,
    type: appointment.type,
    price: appointment.payment?.price ?? 0,
    paymentUrl: billingUrl,
    locale,
    // This branch is active-clients only (isActiveClient above), so the
    // auth-gated profile deep-link is safe. Payment is the primary CTA;
    // this nudges the profile-completion half ("ignore if already done").
    completeProfileUrl: `${base}/client/dashboard/profile`,
  };
  after(() =>
    sendPaymentInvitation(payInviteArgs).catch((err) =>
      console.error(`${logPrefix} payment invitation error:`, err),
    ),
  );
}

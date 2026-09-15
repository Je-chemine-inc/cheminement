import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import {
  sendGuestPaymentConfirmation,
  sendPaymentInvitation,
  sendMeetingLinkNotification,
  sendCancellationNotification,
  sendRefundConfirmation,
  sendAdminAppointmentRefundProblemAlert,
} from "@/lib/notifications";
import { refundAppointmentPayment } from "@/lib/appointment-refund";
import { cancellationRefund } from "@/lib/cancellation-refund";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";
import {
  resolveAppointmentRecipient,
  canAccessAccount,
} from "@/lib/guardian-utils";
import { resolveBillingUrl } from "@/lib/client-portal-urls";

import { provisionGuestAsClient } from "@/lib/provision-guest-as-client";
import { redactPaymentForProfessional } from "@/lib/redact-payment";
import { coverageBadgesFor } from "@/lib/coverage-badges";
import { parseAppointmentDate } from "@/lib/appointment-date";
import {
  pickAppointmentPatch,
  toWriterRole,
  type AppointmentPatchInput,
} from "@/lib/appointment-writable-fields";
import { FREE_CANCELLATION_HOURS } from "@/lib/cancellation-policy";
import { afterSlotFreed } from "@/lib/waitlist-slot-freed";

// Get the base URL for payment links
function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

// Cancellation policy (strict 48h rule):
// - >= 48h before the appointment: client may self-cancel free of charge.
// - <  48h: self-cancel is BLOCKED at the API and hidden in the UI.
//   Late cancellations are only possible via direct admin/pro contact, which
//   uses the admin/pro endpoints (not gated here). The refund amount (15 % fee
//   on a late client cancellation) is lib/cancellation-refund.ts.
/** Payment states where money moved (or is moving) — such a row is never deleted. */
const APPOINTMENT_PAYMENT_STATUSES_WITH_MONEY = [
  "paid",
  "processing",
  "refunded",
  "partially_refunded",
];
// The same constant the showcase pages quote to the public.
const HOURS_BEFORE_APPOINTMENT_FOR_FREE_CANCELLATION = FREE_CANCELLATION_HOURS;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const { id } = await params;

    const appointmentQuery = Appointment.findById(id)
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone");
    // Spec 002: a professional is shown their pay for the whole session, which
    // lives in the (select:false) payer snapshot. Redacted to {kind, total} below.
    if (session.user.role === "professional") {
      appointmentQuery.select("+thirdPartyBilling");
    }
    const appointment = await appointmentQuery;

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Check if user has access to this appointment
    const isClient = appointment.clientId._id.toString() === session.user.id;
    const isProfessional =
      appointment.professionalId &&
      appointment.professionalId._id.toString() === session.user.id;
    const isAdmin = session.user.role === "admin";
    // Professionals can view unassigned pending appointments
    const canViewUnassigned =
      session.user.role === "professional" &&
      !appointment.professionalId &&
      appointment.status === "pending";

    if (!isClient && !isProfessional && !isAdmin && !canViewUnassigned) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (session.user.role === "professional") {
      // Spec 002: the kind of payer and sessions used — never who or how much.
      const badges = await coverageBadgesFor([appointment]).catch(() => new Map());
      return NextResponse.json(
        redactPaymentForProfessional({
          ...appointment.toObject(),
          coverageBadge: badges.get(String(appointment._id)) ?? null,
        }),
      );
    }

    return NextResponse.json(appointment);
  } catch (error: unknown) {
    console.error("Get appointment error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch appointment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const { id } = await params;
    const rawBody: unknown = await req.json();

    // Get the appointment before update to check for status changes
    const oldAppointment = await Appointment.findById(id);

    if (!oldAppointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Authorization: this route was previously reachable by ANY authenticated
    // user with a valid appointment id (it only checked that a session existed),
    // letting anyone patch / cancel / reschedule someone else's appointment.
    // Restrict to: an admin; the assigned professional; a professional claiming
    // an unassigned pending request (the existing self-assign flow below); the
    // appointment's own client; or a guardian of that client account.
    const role = session.user.role;
    const ownerClientId = oldAppointment.clientId?.toString();
    const ownerProId = oldAppointment.professionalId?.toString();
    const isProClaimingUnassigned =
      role === "professional" &&
      oldAppointment.status === "pending" &&
      !oldAppointment.professionalId;
    let authorized =
      role === "admin" ||
      ownerProId === session.user.id ||
      isProClaimingUnassigned;
    if (
      !authorized &&
      (role === "client" || role === "guest" || role === "prospect")
    ) {
      authorized =
        ownerClientId === session.user.id ||
        (ownerClientId
          ? await canAccessAccount(session.user.id, ownerClientId)
          : false);
    }
    if (!authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Narrow the body to what this caller may change. It used to be written
    // unfiltered, so an authorized client could send
    // `{ "$set": { "payment.status": "paid" } }` or overwrite the professional's
    // session notes. Server-derived fields are added to `data` further down.
    const picked = pickAppointmentPatch(rawBody, toWriterRole(role));
    if (!picked.ok) {
      return NextResponse.json({ error: picked.error }, { status: picked.status });
    }
    if (picked.dropped.length > 0) {
      console.warn(
        `[appointments/${id} PATCH] ignored fields for ${role}: ${picked.dropped.join(", ")}`,
      );
    }
    const data: Omit<AppointmentPatchInput, "date"> & {
      date?: string | Date | null;
      professionalId?: string;
      firstScheduledAt?: Date;
      scheduledStartAt?: Date;
    } = { ...picked.data };

    // A client withdrawing their pending request from a showcase page frees the
    // held slot and closes the request (spec 003). It is not a session yet, so
    // the 48h rule below does not apply to it.
    if (
      data.status === "cancelled" &&
      (role === "client" || role === "guest" || role === "prospect") &&
      oldAppointment.directRequest?.state === "pending"
    ) {
      const { releaseDirectRequest } = await import("@/lib/direct-request");
      const released = await releaseDirectRequest({ appointmentId: id, outcome: "withdrawn" });
      if (!released) {
        return NextResponse.json(
          { error: "This request is no longer pending", code: "DIRECT_REQUEST_CLOSED" },
          { status: 409 },
        );
      }
      const freedFor = oldAppointment.directRequest?.professionalId;
      after(() => afterSlotFreed(freedFor));
      return NextResponse.json({ message: "Demande retirée", appointment: released.appointment });
    }

    // Strict 48h cancellation rule: a client cannot self-cancel within 48h
    // of the appointment. Admin/pro keep the ability to mark it cancelled
    // (handled via their dashboards; this endpoint is used by clients too).
    if (
      data.status === "cancelled" &&
      oldAppointment &&
      oldAppointment.status !== "cancelled" &&
      oldAppointment.date &&
      (session.user.role === "client" ||
        session.user.role === "guest" ||
        session.user.role === "prospect")
    ) {
      const apptStart = new Date(oldAppointment.date);
      const hoursUntil =
        (apptStart.getTime() - Date.now()) / (60 * 60 * 1000);
      if (hoursUntil < HOURS_BEFORE_APPOINTMENT_FOR_FREE_CANCELLATION) {
        return NextResponse.json(
          {
            error:
              "Self-cancellation is no longer possible (within 48h of the appointment). Please contact support.",
            code: "CANCELLATION_WINDOW_CLOSED",
          },
          { status: 403 },
        );
      }
    }

    // If a professional is accepting an unassigned pending request,
    // assign themselves as the professional
    if (
      session.user.role === "professional" &&
      oldAppointment &&
      oldAppointment.status === "pending" &&
      !oldAppointment.professionalId &&
      data.status === "scheduled"
    ) {
      data.professionalId = session.user.id;
    }

    // Relance J+1 : ancrage du premier passage en « scheduled »
    if (
      oldAppointment &&
      oldAppointment.status === "pending" &&
      data.status === "scheduled" &&
      !oldAppointment.firstScheduledAt
    ) {
      data.firstScheduledAt = new Date();
    }

    // Anchor any incoming calendar day at UTC noon before it is stored.
    // A caller sending a bare "YYYY-MM-DD" would otherwise land on UTC
    // midnight, which is the previous evening in Montréal — the appointment
    // then shows a day early everywhere. Doing it here covers every caller of
    // this endpoint, not just the one that was reported.
    if (data.date !== undefined && data.date !== null && data.date !== "") {
      const anchored = parseAppointmentDate(data.date as string | Date);
      if (!anchored) {
        return NextResponse.json(
          { error: "Invalid appointment date" },
          { status: 400 },
        );
      }
      data.date = anchored;
    }

    // If status is being set to ongoing and scheduledStartAt is not provided,
    // derive scheduledStartAt from the existing date/time fields so that
    // timers can consistently count from the scheduled start time.
    if (
      data.status === "ongoing" &&
      !data.scheduledStartAt &&
      oldAppointment &&
      oldAppointment.date
    ) {
      try {
        const baseDate =
          oldAppointment.date instanceof Date
            ? new Date(oldAppointment.date)
            : new Date(oldAppointment.date as Date);
        if (!isNaN(baseDate.getTime())) {
          const [hoursStr, minutesStr] = (oldAppointment.time || "00:00").split(
            ":",
          );
          const hours = parseInt(hoursStr || "0", 10);
          const minutes = parseInt(minutesStr || "0", 10);
          baseDate.setHours(hours);
          baseDate.setMinutes(minutes);
          baseDate.setSeconds(0);
          baseDate.setMilliseconds(0);
          data.scheduledStartAt = baseDate;
        }
      } catch {
        // If anything goes wrong deriving scheduledStartAt, skip setting it
      }
    }

    // A professional setting an UNASSIGNED PENDING request to "cancelled" is only
    // valid as a REFUSAL of a proposal made to them — it must NOT cancel the
    // demande nor email the client (client feedback: a pro declining a request
    // stays invisible to the client). We handle it exactly like the proposals-
    // list /refuse route: record the refusal ATOMICALLY (single winner, so
    // cascadeAttempts can't double-count on a double-submit / concurrent decline)
    // and re-run jumelage to offer it to ANOTHER professional ("tenter un autre
    // jumelage"), falling back to the general pool / admin queue if none fits —
    // so it lands back in "Demandes de service", flagged. Emergency + regular
    // alike. A general-pool / awaiting-admin row that was NOT proposed to this
    // pro is rejected: a pro can't cancel a demande that isn't theirs.
    if (
      data.status === "cancelled" &&
      oldAppointment.status === "pending" &&
      !oldAppointment.professionalId &&
      session.user.role === "professional"
    ) {
      // A pending request from a showcase page is declined through
      // decline-direct, which frees its slot and never cascades (spec 003).
      if (oldAppointment.directRequest?.state === "pending") {
        return NextResponse.json(
          { error: "Answer this request from its direct request card", code: "USE_DIRECT_ROUTES" },
          { status: 409 },
        );
      }
      const wasProposedToThisPro =
        oldAppointment.routingStatus === "proposed" &&
        (oldAppointment.proposedTo ?? []).some(
          (p: { toString: () => string }) => p.toString() === session.user.id,
        );
      if (!wasProposedToThisPro) {
        return NextResponse.json(
          { error: "You cannot cancel a request that was not proposed to you." },
          { status: 403 },
        );
      }
      // Single-winner claim (mirrors /refuse CASE 2): `refusedBy: {$ne}` makes the
      // whole update idempotent, so a duplicate/concurrent decline can't land a
      // second cascadeAttempts +1.
      const claimed = await Appointment.findOneAndUpdate(
        {
          _id: id,
          status: "pending",
          routingStatus: "proposed",
          refusedBy: { $ne: session.user.id },
        },
        {
          $set: { routingStatus: "pending" },
          $addToSet: { refusedBy: session.user.id },
          $inc: { cascadeAttempts: 1 },
          $unset: { proposedTo: "", proposedAt: "" },
        },
        { new: true },
      );
      if (claimed) {
        // Re-route OUTSIDE the response; after() keeps the container alive for the
        // matcher's own email fan-out. The client is never emailed here.
        after(async () => {
          try {
            await routeAppointmentToProfessionals(id);
          } catch (err) {
            console.error("[refuse-demande] re-route failed:", err);
          }
        });
      }
      return NextResponse.json({
        message: "Demande refusée",
        rerouted: Boolean(claimed),
      });
    }

    const appointment = await Appointment.findByIdAndUpdate(id, data, {
      new: true,
    })
      .populate(
        "clientId",
        "firstName lastName email phone location language stripeCustomerId",
      )
      .populate("professionalId", "firstName lastName email phone");

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // A scheduled session cancelled or moved frees its time for the
    // professional's waitlist (spec 003 phase 4).
    const movedDay =
      data.date instanceof Date &&
      (!oldAppointment.date || data.date.getTime() !== oldAppointment.date.getTime());
    const movedTime = data.time !== undefined && data.time !== oldAppointment.time;
    if (
      oldAppointment.status === "scheduled" &&
      oldAppointment.professionalId &&
      (appointment.status === "cancelled" || movedDay || movedTime)
    ) {
      const freedFor = oldAppointment.professionalId;
      after(() => afterSlotFreed(freedFor));
    }

    // Interac / virement : paiement attendu dans les 24h après la séance (référence = fin de séance)
    if (
      oldAppointment &&
      oldAppointment.status !== "completed" &&
      appointment.status === "completed" &&
      appointment.payment?.method === "transfer"
    ) {
      const due = new Date();
      due.setHours(due.getHours() + 24);
      await Appointment.findByIdAndUpdate(id, {
        "payment.transferDueAt": due,
      });
    }

    // Pivot de confirmation : RDV fixé → en attente de garantie (paiement) + e-mail coordonnées bancaires
    if (
      oldAppointment &&
      oldAppointment.status === "pending" &&
      appointment.status === "scheduled"
    ) {
      const client = appointment.clientId as unknown as {
        _id: { toString: () => string };
        email: string;
        firstName: string;
        lastName: string;
        language?: string;
      };
      const professional = appointment.professionalId as unknown as {
        _id: { toString: () => string };
        firstName: string;
        lastName: string;
      };

      // Quebec LSSSS art. 14: route to the beneficiary for adult loved-one
      // bookings. The payer's identity is still the requester (account holder)
      // but the email must land in the beneficiary's inbox.
      const recipient = resolveAppointmentRecipient(
        {
          bookingFor: appointment.bookingFor,
          lovedOneInfo: appointment.lovedOneInfo,
        },
        client,
      );

      const clientUserBefore = await User.findById(client._id);
      const wasGuest = clientUserBefore?.role === "guest" || clientUserBefore?.role === "prospect";

      if (wasGuest) {
        await provisionGuestAsClient(client._id.toString(), {
          issueType: appointment.issueType,
          activate: false, // inactive until client claims account via invitation link
        });
      }

      await Appointment.findByIdAndUpdate(id, {
        awaitingPaymentGuarantee: true,
      });

      // Resolve via the shared helper so the token TTL (14d + 24h refresh)
      // stays in lockstep with cron-driven reminders that reuse the same
      // token. Active clients still get the auth-gated dashboard URL.
      const billingUrl = await resolveBillingUrl({
        userStatus: wasGuest ? "inactive" : "active",
        appointment: appointment as Parameters<
          typeof resolveBillingUrl
        >[0]["appointment"],
        base: getBaseUrl(),
        recipientLocale: recipient.language,
      });

      if (wasGuest) {
        // For unclaimed guests, billingUrl is already the /pay?token=… link
        // freshly minted/refreshed by resolveBillingUrl above.
        const paymentLink = billingUrl;

        const guestPayArgs = {
          guestName: recipient.name,
          guestEmail: recipient.email,
          professionalName: `${professional.firstName} ${professional.lastName}`,
          date: appointment.date
            ? appointment.date.toISOString()
            : "To be scheduled",
          time: appointment.time || "To be scheduled",
          duration: appointment.duration || 60,
          type: appointment.type,
          therapyType: appointment.therapyType || "solo",
          price: appointment.payment.price,
          paymentLink,
          locale: recipient.language,
        };
        after(() =>
          sendGuestPaymentConfirmation(guestPayArgs).catch((err) =>
            console.error("Error sending guest payment invitation:", err),
          ),
        );
      } else if (clientUserBefore && clientUserBefore.role === "client") {
        const payInviteArgs = {
          clientName: recipient.name,
          clientEmail: recipient.email,
          professionalName: `${professional.firstName} ${professional.lastName}`,
          professionalEmail: "",
          date: appointment.date
            ? appointment.date.toISOString()
            : "To be scheduled",
          time: appointment.time || "To be scheduled",
          duration: appointment.duration || 60,
          type: appointment.type,
          meetingLink: appointment.meetingLink,
          location: appointment.location,
          price: appointment.payment.price,
          paymentUrl: billingUrl,
          locale: recipient.language,
        };
        after(() =>
          sendPaymentInvitation(payInviteArgs).catch((err) =>
            console.error("Error sending payment invitation:", err),
          ),
        );
      }
    }

    // Send meeting link notification to guest users when professional adds meeting link
    if (
      oldAppointment &&
      !oldAppointment.meetingLink &&
      appointment.meetingLink &&
      data.meetingLink
    ) {
      const client = appointment.clientId as unknown as {
        _id: { toString: () => string };
        email: string;
        firstName: string;
        lastName: string;
        language?: string;
      };
      const professional = appointment.professionalId as unknown as {
        firstName: string;
        lastName: string;
      };

      // Check if client is a guest user
      const clientUser = await User.findById(client._id);
      if (clientUser && (clientUser.role === "guest" || clientUser.role === "prospect")) {
        // LSSSS art. 14: the meeting link must reach the person attending —
        // the loved one when adult, the requester when self / minor.
        const meetingRecipient = resolveAppointmentRecipient(
          {
            bookingFor: appointment.bookingFor,
            lovedOneInfo: appointment.lovedOneInfo,
          },
          client,
        );
        const meetingArgs = {
          guestName: meetingRecipient.name,
          guestEmail: meetingRecipient.email,
          professionalName: `${professional.firstName} ${professional.lastName}`,
          date: appointment.date
            ? appointment.date.toISOString()
            : "To be scheduled",
          time: appointment.time || "To be scheduled",
          duration: appointment.duration || 60,
          type: appointment.type,
          meetingLink: appointment.meetingLink,
          locale: meetingRecipient.language,
        };
        after(() =>
          sendMeetingLinkNotification(meetingArgs).catch((err) =>
            console.error("Error sending meeting link notification email:", err),
          ),
        );
      }
    }

    // Send cancellation notification if status changed to cancelled
    if (
      oldAppointment &&
      appointment.status === "cancelled" &&
      oldAppointment.status !== "cancelled"
    ) {
      const cancelledBy: "client" | "professional" =
        session.user.role === "client" ? "client" : "professional";

      // Update cancellation metadata
      appointment.cancelledBy = cancelledBy;
      appointment.cancelledAt = new Date();

      // Get client and professional info for cancellation email
      const client = appointment.clientId as unknown as {
        firstName: string;
        lastName: string;
        email: string;
        language?: string;
      };
      const professional = appointment.professionalId as unknown as {
        firstName: string;
        lastName: string;
        email: string;
      };

      // Quebec LSSSS art. 14: cancellation comms must reach the beneficiary
      // (the loved one, when adult), not the requester.
      const cancelRecipient = resolveAppointmentRecipient(
        {
          bookingFor: appointment.bookingFor,
          lovedOneInfo: appointment.lovedOneInfo,
        },
        client,
      );

      // Only a confirmed, SCHEDULED appointment notifies the other party on
      // cancellation. A pending "demande de service" being cancelled (e.g. an
      // admin declining a request) must NOT email the client — the client is
      // only told about real, booked appointments. (A professional refusing a
      // proposed demande is handled earlier as a refusal + re-route, returning
      // before this block.)
      if (oldAppointment.status === "scheduled") {
        const cancelArgs = {
          clientName: cancelRecipient.name,
          clientEmail: cancelRecipient.email,
          professionalName: professional
            ? `${professional.firstName} ${professional.lastName}`
            : undefined,
          professionalEmail: professional?.email || "",
          date: appointment.date?.toISOString(),
          time: appointment.time,
          duration: appointment.duration || 60,
          type: appointment.type as "video" | "in-person" | "phone" | "both",
          cancelledBy: cancelledBy,
          locale: cancelRecipient.language,
        };
        after(() =>
          sendCancellationNotification(cancelArgs).catch((err) =>
            console.error("Error sending cancellation notification:", err),
          ),
        );
      }

      // Automatic refund of a card-paid appointment. The refund is claimed on the
      // appointment and sent with an idempotency key (lib/appointment-refund.ts),
      // so a double request never refunds twice; it records refunded or partially
      // refunded and voids the receipt on a full refund. The cancellation stands
      // whatever Stripe says: when Stripe refused or did not confirm the refund,
      // the team is told, so the client is still refunded.
      if (
        appointment.payment.stripePaymentIntentId &&
        appointment.payment.status === "paid"
      ) {
        const appointmentDateTime = appointment.date ? new Date(appointment.date) : new Date();
        const hoursUntilAppointment = (appointmentDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
        const { refundCents, feeCents } = cancellationRefund({
          priceCad: appointment.payment.price || 0,
          cancelledBy: String(cancelledBy),
          hoursUntil: hoursUntilAppointment,
          freeHours: HOURS_BEFORE_APPOINTMENT_FOR_FREE_CANCELLATION,
        });

        if (refundCents > 0) {
          const result = await refundAppointmentPayment({
            appointmentId: id,
            amountCents: refundCents,
            by: "cancellation",
            byUserId: session.user.id,
            reason: data.cancelReason || "Appointment cancelled",
            metadata: {
              cancelledBy: String(cancelledBy),
              cancellationFeeCents: String(feeCents),
              hoursBeforeAppointment: hoursUntilAppointment.toFixed(2),
            },
          });

          if (result.outcome === "refunded") {
            appointment.payment.status = result.full ? "refunded" : "partially_refunded";
            appointment.payment.refundedAt = new Date();
            appointment.payment.refundedAmount = result.amountCents / 100;
            // Send refund confirmation email (LSSSS art. 14: to beneficiary).
            const refundArgs = {
              name: cancelRecipient.name,
              email: cancelRecipient.email,
              amount: result.amountCents / 100,
              appointmentDate: appointment.date?.toISOString(),
              locale: cancelRecipient.language,
            };
            after(() =>
              sendRefundConfirmation(refundArgs).catch((err) =>
                console.error("Error sending refund confirmation:", err),
              ),
            );
          } else if (result.outcome === "refused" || result.outcome === "unconfirmed") {
            console.error(`[appointments/${id}] cancellation refund ${result.outcome}`);
            const alertArgs = {
              appointmentId: id,
              clientName: cancelRecipient.name,
              professionalName: professional ? `${professional.firstName} ${professional.lastName}` : "",
              amountCents: refundCents,
              outcome: result.outcome,
              message: result.outcome === "refused" ? result.message : null,
            };
            after(() =>
              sendAdminAppointmentRefundProblemAlert(alertArgs).catch((err) =>
                console.error("Error sending the refund problem alert:", err),
              ),
            );
          }
          // in_progress / not_refundable: another request is refunding it, or it already was.
        }
      } else if (appointment.payment.status === "pending") {
        // If payment is still pending, mark as cancelled
        appointment.payment.status = "cancelled";
        await appointment.save();
      }
    }

    if (session.user.role === "professional") {
      return NextResponse.json(
        redactPaymentForProfessional(appointment.toObject()),
      );
    }

    return NextResponse.json(appointment);
  } catch (error: unknown) {
    console.error("Update appointment error:", error);
    return NextResponse.json(
      {
        error: "Failed to update appointment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // This route had no role or ownership check at all: any signed-in user could
    // hard-delete any appointment by id — including closed, invoiced sessions
    // already credited to the professional. No screen calls it (admins use the
    // soft-cancel at /api/admin/appointments/[id]), so it is now admin-only.
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    const { id } = await params;

    // A session with billing history is part of the accounting record (invoice
    // number, receipt, ledger credit) and must never disappear. The guard is in
    // the delete filter itself, so a closure landing in the same instant can't
    // slip through between a check and the delete.
    const appointment = await Appointment.findOneAndDelete({
      _id: id,
      sessionCompletedAt: null,
      invoiceNumber: null,
      fiscalReceiptIssuedAt: null,
      "payment.status": { $nin: APPOINTMENT_PAYMENT_STATUSES_WITH_MONEY },
    });

    if (!appointment) {
      const exists = await Appointment.exists({ _id: id });
      if (exists) {
        return NextResponse.json(
          {
            error:
              "This appointment has billing history and cannot be deleted. Cancel it instead.",
            code: "APPOINTMENT_HAS_BILLING_HISTORY",
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ message: "Appointment deleted successfully" });
  } catch (error: unknown) {
    console.error("Delete appointment error:", error);
    return NextResponse.json(
      {
        error: "Failed to delete appointment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

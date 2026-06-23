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
  sendAdminRequestReturnedToQueueAlert,
} from "@/lib/notifications";
import {
  resolveAppointmentRecipient,
  canAccessAccount,
} from "@/lib/guardian-utils";
import { resolveBillingUrl } from "@/lib/client-portal-urls";
import { voidReceiptForRefund } from "@/lib/payment-settlement";

import { stripe } from "@/lib/stripe";
import { provisionGuestAsClient } from "@/lib/provision-guest-as-client";

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
//   uses the admin/pro endpoints (not gated here). The fee constant is kept
//   in case admins want to apply it manually but is no longer auto-charged.
const CANCELLATION_FEE_PERCENTAGE = 0.15;
const HOURS_BEFORE_APPOINTMENT_FOR_FREE_CANCELLATION = 48;

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

    const appointment = await Appointment.findById(id)
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone");

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
      const obj = appointment.toObject();
      if (obj.payment) {
        const p = obj.payment as unknown as Record<string, unknown>;
        delete p.price;
        delete p.platformFee;
        delete p.listPrice;
      }
      return NextResponse.json(obj);
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
    const data = await req.json();

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

    // A professional refusing an unassigned PENDING "demande de service" is NOT a
    // cancellation, and the CLIENT must not be emailed about it (client feedback:
    // a pro declining a request stays invisible to the client). Rewrite the
    // update so the request RETURNS to the admin "Demande de service" queue
    // (routingStatus "awaiting_admin") for manual reassignment, record the
    // refusal, and clear the stale proposal. The normal cancel path — and its
    // client cancellation email — never runs because status stays "pending".
    // Admins are alerted right after the update (the requested "drapeau").
    const proRefusedDemande =
      data.status === "cancelled" &&
      oldAppointment.status === "pending" &&
      !oldAppointment.professionalId &&
      session.user.role === "professional";
    if (proRefusedDemande) {
      delete data.status;
      data.routingStatus = "awaiting_admin";
      data.$addToSet = { refusedBy: session.user.id };
      data.$unset = { proposedTo: "", proposedAt: "" };
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

    // A professional just refused a demande → notify admins only (no client
    // email). The request is now flagged in their service-requests queue.
    if (proRefusedDemande) {
      const refusedClient = appointment.clientId as unknown as {
        firstName?: string;
        lastName?: string;
        email?: string;
      } | null;
      const refusedClientName =
        `${refusedClient?.firstName ?? ""} ${refusedClient?.lastName ?? ""}`.trim() ||
        "Client";
      after(() =>
        sendAdminRequestReturnedToQueueAlert({
          clientName: refusedClientName,
          clientEmail: refusedClient?.email ?? "",
          motif: appointment.issueType || undefined,
          appointmentId: appointment._id.toString(),
          attempts: appointment.cascadeAttempts ?? 0,
        }).catch((err) =>
          console.error("[cancel] admin refusal alert failed:", err),
        ),
      );
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
      // only told about real, booked appointments. (A professional refusing an
      // unassigned demande is intercepted earlier and returned to the admin
      // queue, so it never reaches this block at all.)
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

      // Process automatic refund with fee calculation if appointment was paid
      if (
        appointment.payment.stripePaymentIntentId &&
        appointment.payment.status === "paid"
      ) {
        try {
          console.log(
            `Processing refund for appointment ${id} (Payment Intent: ${appointment.payment.stripePaymentIntentId})`,
          );

          // Calculate hours until appointment
          const appointmentDateTime = appointment.date
            ? new Date(appointment.date)
            : new Date();
          const now = new Date();
          const hoursUntilAppointment =
            (appointmentDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

          // Determine if cancellation fee applies (only for client cancellations)
          const isFreeCancel =
            hoursUntilAppointment >=
            HOURS_BEFORE_APPOINTMENT_FOR_FREE_CANCELLATION;
          const isClientCancellation = cancelledBy === "client";

          let refundAmount = appointment.payment.price || 0;
          let cancellationFee = 0;

          // Apply cancellation fee only for client cancellations within 24 hours
          if (isClientCancellation && !isFreeCancel) {
            cancellationFee = refundAmount * CANCELLATION_FEE_PERCENTAGE;
            refundAmount = refundAmount - cancellationFee;
          }

          // Process refund through Stripe (in cents)
          const refundAmountCents = Math.round(refundAmount * 100);

          if (refundAmountCents > 0) {
            const refund = await stripe.refunds.create({
              payment_intent: appointment.payment.stripePaymentIntentId,
              amount: refundAmountCents,
              reason: "requested_by_customer",
              metadata: {
                appointmentId: id,
                cancelledBy: cancelledBy,
                cancellationFee: cancellationFee.toFixed(2),
                refundReason: data.cancelReason || "Appointment cancelled",
                hoursBeforeAppointment: hoursUntilAppointment.toFixed(2),
              },
            });

            console.log(
              `Refund processed successfully: ${refund.id} - Amount: $${refund.amount / 100} (Fee: $${cancellationFee.toFixed(2)})`,
            );

            // Send refund confirmation email (LSSSS art. 14: to beneficiary).
            const refundArgs = {
              name: cancelRecipient.name,
              email: cancelRecipient.email,
              amount: refund.amount / 100,
              appointmentDate: appointment.date?.toISOString(),
              locale: cancelRecipient.language,
            };
            after(() =>
              sendRefundConfirmation(refundArgs).catch((err) =>
                console.error("Error sending refund confirmation:", err),
              ),
            );
          } else {
            console.log(
              `No refund issued (100% cancellation fee applied): $${cancellationFee.toFixed(2)}`,
            );
          }

          // Update payment status to refunded
          appointment.payment.status = "refunded";
          appointment.payment.refundedAt = new Date();
          await appointment.save();

          // Void the client's fiscal receipt so a refunded payment no longer
          // shows a valid paid receipt (same invariant as the manual refund
          // route + webhook). Don't fail the cancellation if voiding errors.
          await voidReceiptForRefund(id).catch((e) =>
            console.error("voidReceiptForRefund (cancel path):", e),
          );
        } catch (refundError: unknown) {
          console.error("Error processing automatic refund:", refundError);
          // Don't fail the cancellation if refund fails - log it for manual processing
          console.error(
            `Manual refund required for appointment ${id}. Payment Intent: ${appointment.payment.stripePaymentIntentId}`,
          );
        }
      } else if (appointment.payment.status === "pending") {
        // If payment is still pending, mark as cancelled
        appointment.payment.status = "cancelled";
        await appointment.save();
      }
    }

    if (session.user.role === "professional") {
      const obj = appointment.toObject();
      if (obj.payment) {
        const p = obj.payment as unknown as Record<string, unknown>;
        delete p.price;
        delete p.platformFee;
        delete p.listPrice;
      }
      return NextResponse.json(obj);
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

    await connectToDatabase();

    const { id } = await params;

    const appointment = await Appointment.findByIdAndDelete(id);

    if (!appointment) {
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

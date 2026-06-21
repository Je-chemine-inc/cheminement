import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { calculateAppointmentPricing } from "@/lib/pricing";
import {
  sendGuestPaymentConfirmation,
  sendPaymentInvitation,
} from "@/lib/notifications";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import { resolveBillingUrl } from "@/lib/client-portal-urls";
import { parseAppointmentDate } from "@/lib/appointment-date";

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

/**
 * POST /api/appointments/[id]/schedule-first
 *
 * Step 2 of the matching flow: the assigned professional confirms the FIRST
 * appointment with a real date/time. Distinct from acceptance (which only
 * matches — see /accept). This is what flips the matched request
 * (status "pending" + routingStatus "accepted") to "scheduled", and sends the
 * client the single 1st-RDV confirmation email that carries the payment
 * invitation (a real date now exists, so the payment guard passes).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      date?: string;
      time?: string;
      duration?: number;
      type?: string;
      location?: string;
      notes?: string;
    };
    const { date, time, duration, type, location, notes } = body;

    if (!date || !time) {
      return NextResponse.json(
        { error: "date and time are required" },
        { status: 400 },
      );
    }

    const appointment = await Appointment.findById(id).populate(
      "clientId",
      "firstName lastName email language role status",
    );
    if (!appointment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only the assigned professional can schedule, and only a matched request
    // (accepted but not yet scheduled) is eligible.
    if (appointment.professionalId?.toString() !== session.user.id) {
      return NextResponse.json(
        { error: "You are not assigned to this request" },
        { status: 403 },
      );
    }
    if (appointment.status !== "pending" || appointment.routingStatus !== "accepted") {
      return NextResponse.json(
        { error: "This request is not awaiting a first appointment" },
        { status: 400 },
      );
    }

    const allowedTypes = ["video", "in-person", "phone", "both"];
    const resolvedType =
      type && allowedTypes.includes(type) ? type : appointment.type;

    // UTC-noon anchor so the booked calendar day survives timezone display.
    const appointmentDate = parseAppointmentDate(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!appointmentDate || appointmentDate < today) {
      return NextResponse.json(
        { error: "Cannot schedule an appointment in the past" },
        { status: 400 },
      );
    }

    // Double-booking guard against other scheduled sessions for this pro.
    const conflict = await Appointment.findOne({
      _id: { $ne: appointment._id },
      professionalId: session.user.id,
      date: appointmentDate,
      time,
      status: "scheduled",
    });
    if (conflict) {
      return NextResponse.json(
        { error: "This time slot is already booked" },
        { status: 409 },
      );
    }

    // Refresh pricing to the assigned pro's rate (matched-via-routing requests
    // carry platform-default pricing until now).
    const pricing = await calculateAppointmentPricing(
      session.user.id,
      appointment.therapyType,
    );

    appointment.date = appointmentDate;
    appointment.time = time;
    if (typeof duration === "number" && duration > 0) {
      appointment.duration = duration;
    }
    appointment.type = resolvedType as "video" | "in-person" | "phone" | "both";
    if (resolvedType === "in-person") {
      appointment.location = location?.trim() || appointment.location;
    }
    if (notes?.trim()) appointment.notes = notes.trim();
    appointment.status = "scheduled";
    appointment.firstScheduledAt = new Date();
    appointment.awaitingPaymentGuarantee = true;
    appointment.payment.price = pricing.sessionPrice;
    appointment.payment.platformFee = pricing.platformFee;
    appointment.payment.professionalPayout = pricing.professionalPayout;
    await appointment.save();

    // Build the single 1st-RDV confirmation email (carries the payment CTA).
    const client = appointment.clientId as unknown as {
      _id: { toString: () => string };
      firstName?: string;
      lastName?: string;
      email?: string;
      language?: string;
      role?: string;
      status?: string;
    } | null;

    if (client?.email) {
      const professional = await User.findById(session.user.id)
        .select("firstName lastName email")
        .lean();
      const professionalName = professional
        ? `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim()
        : undefined;

      const isActiveClient =
        client.role === "client" && client.status === "active";

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
          date: appointmentDate.toISOString(),
          time,
          duration: appointment.duration || 60,
          type: appointment.type,
          therapyType:
            (appointment.therapyType as "solo" | "couple" | "group") || "solo",
          price: appointment.payment?.price ?? 0,
          paymentLink: billingUrl,
          locale,
        };
        after(() =>
          sendGuestPaymentConfirmation(guestPayArgs).catch((err) =>
            console.error("[schedule-first] guest confirmation error:", err),
          ),
        );
      } else {
        const payInviteArgs = {
          clientName: recipient.name,
          clientEmail: recipient.email,
          professionalName: professionalName ?? "",
          professionalEmail: professional?.email ?? "",
          date: appointmentDate.toISOString(),
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
            console.error("[schedule-first] payment invitation error:", err),
          ),
        );
      }
    }

    return NextResponse.json({
      id: appointment._id.toString(),
      date: appointmentDate.toISOString(),
      time,
      duration: appointment.duration,
      type: appointment.type,
      status: appointment.status,
    });
  } catch (error) {
    console.error("schedule-first error:", error);
    return NextResponse.json(
      {
        error: "Failed to schedule first appointment",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

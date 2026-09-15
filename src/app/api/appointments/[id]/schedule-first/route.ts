import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { appointmentDayKey, parseAppointmentDate } from "@/lib/appointment-date";
import {
  queueFirstAppointmentConfirmation,
  resolveFirstAppointmentLocation,
} from "@/lib/first-appointment-confirmation";
import { findSlotCollision, slotCollisionError } from "@/lib/slot-occupancy";

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
      /** Store the address typed here as the professional's default office. */
      saveAsDefaultOffice?: boolean;
    };
    const { date, time, duration, type, location, notes, saveAsDefaultOffice } =
      body;

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

    // A client's pending request from a showcase page holds its time (spec 003).
    const held = await findSlotCollision({
      professionalId: session.user.id,
      dayKey: appointmentDayKey(appointmentDate),
      time,
      durationMinutes:
        typeof duration === "number" && duration > 0 ? duration : appointment.duration,
      exceptAppointmentId: id,
      holdsOnly: true,
    });
    if (held) {
      return NextResponse.json(slotCollisionError(held), { status: 409 });
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

    // An in-person FIRST appointment must state where it happens. Nothing used
    // to ask: this route accepted `location` but the professional's scheduling
    // modal never sent it, so a client's very first session was confirmed with
    // no address anywhere — and the reminder then had only the platform's own
    // footer address to show. Later appointments were fine because the other
    // scheduling paths do collect one.
    if (resolvedType === "in-person") {
      const resolved = await resolveFirstAppointmentLocation({
        professionalId: session.user.id,
        typed: location,
        current: appointment.location,
        saveAsDefaultOffice,
        logPrefix: "[schedule-first]",
      });
      if (!resolved) {
        return NextResponse.json(
          {
            error:
              "An address is required for an in-person session. Add your office address, or enter the address for this appointment.",
            code: "OFFICE_ADDRESS_REQUIRED",
          },
          { status: 400 },
        );
      }
      appointment.location = resolved;
    }
    if (notes?.trim()) appointment.notes = notes.trim();
    appointment.status = "scheduled";
    appointment.firstScheduledAt = new Date();
    appointment.awaitingPaymentGuarantee = true;
    appointment.payment.price = pricing.sessionPrice;
    appointment.payment.platformFee = pricing.platformFee;
    appointment.payment.professionalPayout = pricing.professionalPayout;
    await appointment.save();

    // The single 1st-RDV confirmation email (carries the payment CTA).
    await queueFirstAppointmentConfirmation({
      appointment,
      professionalId: session.user.id,
      logPrefix: "[schedule-first]",
    });

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

import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { sendAppointmentChangeNotification } from "@/lib/notifications";
import { parseAppointmentDate } from "@/lib/appointment-date";

type PopulatedParty = {
  firstName?: string;
  lastName?: string;
  email?: string;
  language?: string;
} | null;

const ALLOWED_TYPES = ["video", "in-person", "phone", "both"];

const localeOf = (p: PopulatedParty): "fr" | "en" =>
  p?.language === "en" ? "en" : "fr";
const nameOf = (p: PopulatedParty): string =>
  `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim();

/**
 * Loads the appointment and confirms the caller is the professional who owns
 * it. Returns either the populated document or an error response.
 */
async function loadOwnedAppointment(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "professional") {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { error: NextResponse.json({ error: "Invalid id" }, { status: 400 }) };
  }
  await connectToDatabase();
  const appointment = await Appointment.findById(id)
    .populate("clientId", "firstName lastName email language")
    .populate("professionalId", "firstName lastName email language");
  if (!appointment) {
    return {
      error: NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      ),
    };
  }
  if (
    !appointment.professionalId ||
    appointment.professionalId._id.toString() !== session.user.id
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { appointment, error: null as null };
}

/**
 * Professional self-service edit. Reschedule (date/time) and/or modify (type,
 * duration, location, notes, meeting link) one of the professional's own
 * appointments — straight from the agenda. Guards against past dates and
 * double-booking; when the slot moves, the client is notified by email.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const loaded = await loadOwnedAppointment(id);
    if (loaded.error) return loaded.error;
    const appointment = loaded.appointment;

    const body = (await req.json()) as {
      date?: string;
      time?: string;
      duration?: number;
      type?: string;
      location?: string | null;
      notes?: string | null;
      meetingLink?: string | null;
    };

    if (body.type && !ALLOWED_TYPES.includes(body.type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const previousDate = appointment.date
      ? appointment.date.toISOString()
      : undefined;
    const previousTime = appointment.time;

    // Dates anchored to UTC noon so the booked calendar day survives display.
    const parsedDate =
      body.date !== undefined ? parseAppointmentDate(body.date) : undefined;
    if (body.date !== undefined && !parsedDate) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    const newDate = parsedDate ?? appointment.date;
    const newTime = body.time !== undefined ? body.time : appointment.time;

    const dateChanged =
      !!parsedDate &&
      (!appointment.date || parsedDate.getTime() !== appointment.date.getTime());
    const timeChanged = body.time !== undefined && body.time !== appointment.time;
    const isReschedule = dateChanged || timeChanged;

    if (parsedDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (parsedDate < today) {
        return NextResponse.json(
          { error: "Cannot move appointments into the past" },
          { status: 400 },
        );
      }
    }

    if (isReschedule && newDate && newTime) {
      const conflict = await Appointment.findOne({
        _id: { $ne: appointment._id },
        professionalId: appointment.professionalId,
        date: newDate,
        time: newTime,
        status: "scheduled",
      });
      if (conflict) {
        return NextResponse.json(
          { error: "This time slot is already booked" },
          { status: 409 },
        );
      }
    }

    if (body.date !== undefined) appointment.date = newDate;
    if (body.time !== undefined) appointment.time = newTime;
    if (typeof body.duration === "number" && body.duration > 0) {
      appointment.duration = body.duration;
    }
    if (body.type) appointment.type = body.type as typeof appointment.type;
    if (body.location !== undefined) {
      appointment.location = body.location?.trim() || undefined;
    }
    if (body.notes !== undefined) {
      appointment.notes = body.notes?.trim() || undefined;
    }
    if (body.meetingLink !== undefined) {
      appointment.meetingLink = body.meetingLink?.trim() || undefined;
    }

    await appointment.save();

    const client = appointment.clientId as unknown as PopulatedParty;
    const professional = appointment.professionalId as unknown as PopulatedParty;
    if (
      isReschedule &&
      (appointment.status === "scheduled" || appointment.status === "pending") &&
      client?.email
    ) {
      after(() =>
        sendAppointmentChangeNotification({
          action: "rescheduled",
          actor: "professional",
          clientName: nameOf(client),
          clientEmail: client.email as string,
          clientLocale: localeOf(client),
          professionalName: nameOf(professional),
          professionalLocale: localeOf(professional),
          date: appointment.date?.toISOString(),
          time: appointment.time,
          type: appointment.type as "video" | "in-person" | "phone" | "both",
          location: appointment.location,
          previousDate,
          previousTime,
        }).catch((err) =>
          console.error("[pro appt edit] reschedule notify error:", err),
        ),
      );
    }

    const populated = await Appointment.findById(appointment._id)
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone");

    return NextResponse.json(populated);
  } catch (error) {
    console.error("Professional appointment edit error:", error);
    return NextResponse.json(
      {
        error: "Failed to update appointment",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

/**
 * Professional self-service cancel. Soft-cancels (status → cancelled) so
 * payment / ledger history is preserved, then notifies the client. Idempotent.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const loaded = await loadOwnedAppointment(id);
    if (loaded.error) return loaded.error;
    const appointment = loaded.appointment;

    if (appointment.status === "cancelled") {
      return NextResponse.json({ success: true, alreadyCancelled: true });
    }

    const previousDate = appointment.date
      ? appointment.date.toISOString()
      : undefined;
    const previousTime = appointment.time;

    appointment.status = "cancelled";
    appointment.cancelledBy = "professional";
    appointment.cancelledAt = new Date();
    appointment.cancelReason = "professional_cancelled";
    await appointment.save();

    const client = appointment.clientId as unknown as PopulatedParty;
    const professional = appointment.professionalId as unknown as PopulatedParty;
    if (client?.email) {
      after(() =>
        sendAppointmentChangeNotification({
          action: "cancelled",
          actor: "professional",
          clientName: nameOf(client),
          clientEmail: client.email as string,
          clientLocale: localeOf(client),
          professionalName: nameOf(professional),
          professionalLocale: localeOf(professional),
          type: appointment.type as "video" | "in-person" | "phone" | "both",
          previousDate,
          previousTime,
        }).catch((err) =>
          console.error("[pro appt cancel] notify error:", err),
        ),
      );
    }

    return NextResponse.json({ success: true, status: appointment.status });
  } catch (error) {
    console.error("Professional appointment cancel error:", error);
    return NextResponse.json(
      {
        error: "Failed to cancel appointment",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

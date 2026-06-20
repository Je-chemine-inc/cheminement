import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import User from "@/models/User";
import Profile from "@/models/Profile";
import Appointment from "@/models/Appointment";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { parseAppointmentDate } from "@/lib/appointment-date";
import {
  sendAppointmentConfirmation,
  sendProfessionalNotification,
} from "@/lib/notifications";

const ALLOWED_TYPES = ["video", "in-person", "phone", "both"];

/**
 * §4 "Fixer directement un rendez-vous": schedule an EXISTING service-request
 * dossier IN PLACE — assign a professional + date + time and flip it to
 * scheduled — straight from the admin "Demande de service" / "Pool Général"
 * queues, without creating a duplicate appointment.
 *
 * Works on any still-open dossier (status "pending", whatever its routingStatus:
 * pending / proposed / general / awaiting_admin / accepted). The "raison du
 * rendez-vous" (motif) is STRICTLY OPTIONAL — if omitted, the dossier keeps its
 * existing issueType (the problématique can be filled in later).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();
    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });
    // Mirror the queue's view/assign permission so an admin who can manage the
    // matching queue can also schedule from it (was manageUsers-only → 403).
    if (
      !admin?.permissions?.manageUsers &&
      !admin?.permissions?.managePatients
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const data = await req.json();
    const {
      professionalId,
      date,
      time,
      type,
      duration,
      motif,
      notes,
      location,
    } = data as {
      professionalId?: string;
      date?: string;
      time?: string;
      type?: string;
      duration?: number;
      motif?: string;
      notes?: string;
      location?: string;
    };

    const trimmedMotif = motif?.trim();

    if (!professionalId || !date || !time) {
      return NextResponse.json(
        { error: "professionalId, date and time are required" },
        { status: 400 },
      );
    }
    if (!mongoose.Types.ObjectId.isValid(professionalId)) {
      return NextResponse.json({ error: "Invalid professionalId" }, { status: 400 });
    }
    if (type && !ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const appointment = await Appointment.findById(id).populate(
      "clientId",
      "firstName lastName email language",
    );
    if (!appointment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Only an open dossier can be scheduled. Already scheduled/cancelled/etc.
    // go through the normal edit (PATCH) or cancel/rebook flow instead.
    if (appointment.status !== "pending") {
      return NextResponse.json(
        { error: "Only a pending request can be scheduled here" },
        { status: 409 },
      );
    }

    const professional = await User.findOne({
      _id: professionalId,
      role: "professional",
      status: { $in: ["active", "pending"] },
    });
    if (!professional) {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }

    // UTC-noon anchor so the booked calendar day survives timezone display.
    const appointmentDate = parseAppointmentDate(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!appointmentDate || appointmentDate < today) {
      return NextResponse.json(
        { error: "Cannot book appointments in the past" },
        { status: 400 },
      );
    }

    const conflict = await Appointment.findOne({
      _id: { $ne: appointment._id },
      professionalId,
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

    const resolvedType = (type || appointment.type) as
      | "video"
      | "in-person"
      | "phone"
      | "both";
    const pricing = await calculateAppointmentPricing(
      professionalId,
      appointment.therapyType || "solo",
    );
    const profile = await Profile.findOne({ userId: professionalId });
    const resolvedDuration =
      typeof duration === "number" && duration > 0
        ? duration
        : appointment.duration ||
          profile?.availability?.sessionDurationMinutes ||
          60;

    // Schedule the dossier IN PLACE.
    appointment.professionalId = new mongoose.Types.ObjectId(professionalId);
    appointment.date = appointmentDate;
    appointment.time = time;
    appointment.type = resolvedType;
    appointment.duration = resolvedDuration;
    appointment.status = "scheduled";
    appointment.routingStatus = "accepted";
    appointment.matchedAt = new Date();
    appointment.proposedTo = undefined;
    appointment.proposedAt = undefined;
    if (trimmedMotif) {
      appointment.issueType = trimmedMotif;
      appointment.needs = [trimmedMotif];
    }
    if (typeof notes === "string") {
      appointment.notes = notes.trim() || undefined;
    }
    appointment.location =
      resolvedType === "in-person" ? location?.trim() || undefined : undefined;
    if (appointment.payment) {
      appointment.payment.price = pricing.sessionPrice;
      appointment.payment.platformFee = pricing.platformFee;
      appointment.payment.professionalPayout = pricing.professionalPayout;
    }
    await appointment.save();

    // Confirm to both parties (fire-and-forget; after() keeps the container
    // alive on Vercel until the SMTP sends settle).
    const client = appointment.clientId as unknown as {
      firstName?: string;
      lastName?: string;
      email?: string;
      language?: string;
    } | null;
    if (client?.email) {
      const clientLocale: "fr" | "en" =
        client.language === "en" ? "en" : "fr";
      const emailData = {
        clientName: `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim(),
        clientEmail: client.email,
        professionalName: `${professional.firstName ?? ""} ${
          professional.lastName ?? ""
        }`.trim(),
        professionalEmail: professional.email,
        date: appointmentDate.toISOString(),
        time,
        duration: resolvedDuration,
        type: resolvedType,
        location: appointment.location,
      };
      after(() =>
        Promise.all([
          sendAppointmentConfirmation({ ...emailData, locale: clientLocale }),
          sendProfessionalNotification(emailData),
        ]).catch((err) =>
          console.error("[admin schedule] notification error:", err),
        ),
      );
    }

    return NextResponse.json({
      id: appointment._id.toString(),
      status: appointment.status,
      routingStatus: appointment.routingStatus,
      professionalId,
      date: appointmentDate.toISOString(),
      time,
    });
  } catch (error) {
    console.error("Admin direct schedule error:", error);
    return NextResponse.json(
      {
        error: "Failed to schedule appointment",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

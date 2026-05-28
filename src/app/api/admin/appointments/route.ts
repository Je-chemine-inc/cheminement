import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import User from "@/models/User";
import Profile from "@/models/Profile";
import Appointment from "@/models/Appointment";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { getValidMotifLabels } from "@/lib/motifs";
import {
  sendAppointmentConfirmation,
  sendProfessionalNotification,
} from "@/lib/notifications";

/**
 * Admin substitution booking. Allows an admin to create a fully-scheduled
 * appointment on behalf of a professional (e.g. when an admin schedules
 * directly with a client and the pro hasn't acted yet).
 *
 * Differs from `POST /api/appointments` in that:
 *  - The actor is an admin, not the client/pro;
 *  - `professionalId` is REQUIRED (no auto-routing);
 *  - We skip the client phone-verification gate;
 *  - The appointment is created already `status: "scheduled"` and
 *    `routingStatus: "accepted"` — no service-request queue.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (
      !session?.user?.id ||
      session.user.role !== "admin"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });
    if (!admin?.permissions?.manageUsers) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const data = await req.json();
    const {
      clientId,
      professionalId,
      date,
      time,
      duration,
      type,
      motif,
      notes,
      location,
    } = data as {
      clientId?: string;
      professionalId?: string;
      date?: string;
      time?: string;
      duration?: number;
      type?: string;
      motif?: string;
      notes?: string;
      location?: string;
    };

    if (
      !clientId ||
      !professionalId ||
      !date ||
      !time ||
      !type ||
      !motif?.trim()
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }
    if (
      !mongoose.Types.ObjectId.isValid(clientId) ||
      !mongoose.Types.ObjectId.isValid(professionalId)
    ) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const allowedTypes = ["video", "in-person", "phone", "both"];
    if (!allowedTypes.includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const validLabels = await getValidMotifLabels();
    if (!validLabels.has(motif)) {
      return NextResponse.json(
        { error: `Invalid motif: ${motif}` },
        { status: 400 },
      );
    }

    const [client, professional] = await Promise.all([
      User.findById(clientId),
      User.findOne({
        _id: professionalId,
        role: "professional",
        status: { $in: ["active", "pending"] },
      }),
    ]);
    if (!client || client.role !== "client") {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!professional) {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }

    const appointmentDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isNaN(appointmentDate.getTime()) || appointmentDate < today) {
      return NextResponse.json(
        { error: "Cannot book appointments in the past" },
        { status: 400 },
      );
    }

    const conflict = await Appointment.findOne({
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

    const pricing = await calculateAppointmentPricing(professionalId, "solo");
    const profile = await Profile.findOne({ userId: professionalId });
    const resolvedDuration =
      typeof duration === "number" && duration > 0
        ? duration
        : profile?.availability?.sessionDurationMinutes || 60;

    const appointment = new Appointment({
      clientId,
      professionalId,
      date: appointmentDate,
      time,
      duration: resolvedDuration,
      type,
      therapyType: "solo",
      bookingFor: "self",
      needs: [motif],
      issueType: motif,
      notes: notes?.trim() || undefined,
      location: type === "in-person" ? location?.trim() || undefined : undefined,
      status: "scheduled",
      routingStatus: "accepted",
      price: pricing.sessionPrice,
      platformFee: pricing.platformFee,
      professionalPayout: pricing.professionalPayout,
      payment: {
        price: pricing.sessionPrice,
        platformFee: pricing.platformFee,
        professionalPayout: pricing.professionalPayout,
        status: "pending",
      },
    });
    await appointment.save();

    // Fire-and-forget notifications to both parties.
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
      type: type as "video" | "in-person" | "phone" | "both",
      location: appointment.location,
    };
    Promise.all([
      sendAppointmentConfirmation({ ...emailData, locale: clientLocale }),
      sendProfessionalNotification(emailData),
    ]).catch((err) =>
      console.error("[admin booking] notification error:", err),
    );

    return NextResponse.json(
      {
        id: appointment._id.toString(),
        date: appointmentDate.toISOString(),
        time,
        duration: resolvedDuration,
        type,
        status: appointment.status,
        professionalId,
        clientId,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Admin booking error:", error);
    return NextResponse.json(
      {
        error: "Failed to create appointment",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

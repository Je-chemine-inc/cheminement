import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Profile from "@/models/Profile";
import Appointment from "@/models/Appointment";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { getValidMotifLabels } from "@/lib/motifs";
import {
  sendAppointmentConfirmation,
} from "@/lib/notifications";

/**
 * Pro-initiated booking. Lets a professional schedule an appointment directly
 * with a client from the pro portal (ProfessionalBookAppointmentModal).
 *
 * Mirrors /api/admin/appointments but:
 *  - actor must be the professional (no admin permission check);
 *  - professionalId is derived from the session, never trusted from the body;
 *  - skips sendProfessionalNotification — the pro is the one booking, so we
 *    don't email them their own action.
 *
 * Why this route exists: /api/appointments POST is the client-initiated funnel
 * and is gated to client/guest/prospect roles. Pros need a dedicated endpoint
 * for their portal booking flow.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const data = await req.json();
    const {
      clientId,
      date,
      time,
      duration,
      type,
      motif,
      notes,
      location,
    } = data as {
      clientId?: string;
      date?: string;
      time?: string;
      duration?: number;
      type?: string;
      motif?: string;
      notes?: string;
      location?: string;
    };

    if (!clientId || !date || !time || !type || !motif?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
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

    const professionalId = session.user.id;
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

    // Client confirmation email. after() keeps the serverless function alive
    // until SMTP completes on Vercel; without it Gmail SMTP (1-2s) is killed.
    if (client.email) {
      const emailData = {
        clientName: `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim(),
        clientEmail: client.email,
        professionalName: `${professional.firstName ?? ""} ${
          professional.lastName ?? ""
        }`.trim(),
        professionalEmail: professional.email ?? "",
        date: appointmentDate.toISOString(),
        time,
        duration: resolvedDuration,
        type: type as "video" | "in-person" | "phone" | "both",
        location: appointment.location,
      };
      after(() =>
        sendAppointmentConfirmation(emailData).catch((err) =>
          console.error("[pro booking] client confirmation error:", err),
        ),
      );
    }

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
    console.error("Professional booking error:", error);
    return NextResponse.json(
      {
        error: "Failed to create appointment",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

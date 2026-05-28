import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import Profile from "@/models/Profile";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { sendProfessionalNotification } from "@/lib/notifications";

/**
 * Lets a returning client request a follow-up appointment with the professional
 * they are already matched with. The request lands in the pro's queue as a
 * pending appointment (the pro accepts/refuses via the existing routes).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const body = await req.json();
    const { date, time, duration, type, notes } = body as {
      date?: string;
      time?: string;
      duration?: number;
      type?: string;
      notes?: string;
    };

    if (!date || !time || !type) {
      return NextResponse.json(
        { error: "Missing required field: date, time, or type" },
        { status: 400 },
      );
    }
    const allowedTypes = ["video", "in-person", "phone"];
    if (!allowedTypes.includes(String(type))) {
      return NextResponse.json(
        { error: "Invalid appointment type" },
        { status: 400 },
      );
    }

    // Find the client's current professional from their most recent matched appointment
    const lastApt = await Appointment.findOne({
      clientId: session.user.id,
      professionalId: { $exists: true, $ne: null },
      status: { $in: ["scheduled", "completed", "ongoing"] },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select("professionalId needs issueType therapyType")
      .lean<{
        professionalId?: unknown;
        needs?: string[];
        issueType?: string;
        therapyType?: string;
      }>();

    if (!lastApt?.professionalId) {
      return NextResponse.json(
        {
          error: "No current professional. Use the standard booking flow.",
          code: "NO_CURRENT_PROFESSIONAL",
        },
        { status: 400 },
      );
    }

    const professional = await User.findOne({
      _id: lastApt.professionalId,
      role: "professional",
      status: { $in: ["active", "pending"] },
    })
      .select("firstName lastName email")
      .lean<{ firstName?: string; lastName?: string; email?: string }>();

    if (!professional) {
      return NextResponse.json(
        { error: "Current professional is no longer available" },
        { status: 404 },
      );
    }

    // Require phone verification for clients before booking (mirrors /api/appointments)
    const clientUser = await User.findById(session.user.id)
      .select("phoneVerifiedAt firstName lastName email")
      .lean<{
        phoneVerifiedAt?: Date | null;
        firstName?: string;
        lastName?: string;
        email?: string;
      }>();
    if (clientUser && !clientUser.phoneVerifiedAt) {
      return NextResponse.json(
        {
          error: "Phone verification required before booking",
          code: "PHONE_NOT_VERIFIED",
        },
        { status: 403 },
      );
    }

    // Validate date is not in the past
    const appointmentDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (appointmentDate < today) {
      return NextResponse.json(
        { error: "Cannot book appointments in the past" },
        { status: 400 },
      );
    }

    // Avoid double-booking with the same professional
    const conflict = await Appointment.findOne({
      professionalId: lastApt.professionalId,
      date: appointmentDate,
      time,
      status: { $in: ["scheduled"] },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "This time slot is already booked" },
        { status: 409 },
      );
    }

    const therapyType: "solo" | "couple" | "group" =
      lastApt.therapyType === "couple" || lastApt.therapyType === "group"
        ? lastApt.therapyType
        : "solo";
    const pricing = await calculateAppointmentPricing(
      String(lastApt.professionalId),
      therapyType,
    );
    const profile = await Profile.findOne({ userId: lastApt.professionalId })
      .select("availability")
      .lean<{ availability?: { sessionDurationMinutes?: number } }>();
    const finalDuration =
      typeof duration === "number" && duration > 0
        ? duration
        : profile?.availability?.sessionDurationMinutes || 60;

    // IMPORTANT: do NOT pre-assign `professionalId` here. The accept route
    // refuses to act on an appointment that already has a professional
    // attached (it treats that as "already assigned"). Instead we route this
    // through the standard pro-proposal queue by putting the requested
    // professional in `proposedTo` and leaving `professionalId` blank — they
    // then accept or refuse via the same /accept and /refuse routes that
    // handle the auto-router's proposals.
    const appointment = new Appointment({
      clientId: session.user.id,
      proposedTo: [lastApt.professionalId],
      routingStatus: "proposed",
      date: appointmentDate,
      time,
      duration: finalDuration,
      type,
      therapyType,
      bookingFor: "self",
      needs: lastApt.needs || [],
      issueType: lastApt.issueType,
      notes: typeof notes === "string" ? notes.trim() : undefined,
      status: "pending",
      payment: {
        status: "pending",
        price: pricing.sessionPrice,
        platformFee: pricing.platformFee,
        professionalPayout: pricing.professionalPayout,
      },
    });
    await appointment.save();

    // Notify the professional that a returning client has requested a session
    if (professional.email && clientUser?.email) {
      const clientName =
        `${clientUser.firstName ?? ""} ${clientUser.lastName ?? ""}`.trim() ||
        "Client";
      const notifArgs = {
        clientName,
        clientEmail: clientUser.email,
        professionalName:
          `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim() ||
          "Professional",
        professionalEmail: professional.email,
        date: appointmentDate.toISOString(),
        time,
        duration: finalDuration,
        type: type as "video" | "in-person" | "phone" | "both",
      };
      after(() =>
        sendProfessionalNotification(notifArgs).catch((err) =>
          console.error(
            `[request-with-current-pro] notify professional failed:`,
            err,
          ),
        ),
      );
    }

    return NextResponse.json({
      success: true,
      appointmentId: String(appointment._id),
    });
  } catch (error: unknown) {
    console.error("request-with-current-pro POST:", error);
    return NextResponse.json(
      { error: "Failed to create appointment request" },
      { status: 500 },
    );
  }
}

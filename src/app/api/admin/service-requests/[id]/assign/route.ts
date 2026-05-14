import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { sendJumelageSuccessEmail } from "@/lib/notifications";

/**
 * Manually jumelage a pending service-request: admin picks a professional
 * for an unassigned request and notifies the client (jumelage success email).
 *
 * The request stays at `status: "pending"` (no date/time yet — that's set
 * later by booking) but `routingStatus` jumps to "accepted" and the chosen
 * professional is locked in. If pricing depends on the pro, refresh it here
 * so the pricing reflects the assigned pro's rate.
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
    if (!admin?.permissions?.manageUsers) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { professionalId } = (await req.json()) as {
      professionalId?: string;
    };
    if (!professionalId || !mongoose.Types.ObjectId.isValid(professionalId)) {
      return NextResponse.json(
        { error: "professionalId is required" },
        { status: 400 },
      );
    }

    const [appointment, professional] = await Promise.all([
      Appointment.findById(id).populate(
        "clientId",
        "firstName lastName email language",
      ),
      User.findOne({
        _id: professionalId,
        role: "professional",
        status: { $in: ["active", "pending"] },
      }),
    ]);
    if (!appointment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!professional) {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }
    if (appointment.professionalId) {
      return NextResponse.json(
        { error: "Request already assigned to a professional" },
        { status: 409 },
      );
    }

    const pricing = await calculateAppointmentPricing(
      professionalId,
      appointment.therapyType,
    );

    appointment.professionalId = new mongoose.Types.ObjectId(professionalId);
    appointment.routingStatus = "accepted";
    appointment.payment.price = pricing.sessionPrice;
    appointment.payment.platformFee = pricing.platformFee;
    appointment.payment.professionalPayout = pricing.professionalPayout;
    await appointment.save();

    const client = appointment.clientId as unknown as {
      firstName?: string;
      lastName?: string;
      email?: string;
      language?: string;
    } | null;

    if (client?.email) {
      const lang: "fr" | "en" = client.language === "fr" ? "fr" : "en";
      void sendJumelageSuccessEmail({
        clientName:
          `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim() ||
          "Client",
        clientEmail: client.email,
        professionalName: `${professional.firstName ?? ""} ${
          professional.lastName ?? ""
        }`.trim(),
        locale: lang,
      }).catch((err) =>
        console.error("[admin manual jumelage] email error:", err),
      );
    }

    return NextResponse.json({
      id: appointment._id.toString(),
      professionalId,
      routingStatus: appointment.routingStatus,
    });
  } catch (error) {
    console.error("Admin manual jumelage error:", error);
    return NextResponse.json(
      {
        error: "Failed to assign professional",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

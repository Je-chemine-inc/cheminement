import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";

/**
 * POST /api/appointments/route-submission
 *
 * Admin-only manual trigger for automatic routing. Delegates to the canonical
 * matcher so it follows the SAME 3-level single-pro cascade (strict → relaxed →
 * general pool) as every other flow. This endpoint previously ran its own
 * divergent top-5 matcher, which contradicted the one-pro-at-a-time model and
 * sent no notifications; that logic has been removed in favour of delegation.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const { appointmentId } = await req.json();

    if (!appointmentId) {
      return NextResponse.json(
        { error: "Appointment ID is required" },
        { status: 400 },
      );
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Only route pending appointments that haven't been routed yet.
    if (appointment.routingStatus !== "pending" || appointment.professionalId) {
      return NextResponse.json(
        { error: "Appointment already routed or assigned" },
        { status: 400 },
      );
    }

    const result = await routeAppointmentToProfessionals(appointmentId);

    return NextResponse.json({
      message:
        result.routingStatus === "proposed"
          ? "Appointment routed successfully"
          : "No matching professional found, moved to general list",
      routingStatus: result.routingStatus,
      matches: result.matches,
    });
  } catch (error) {
    console.error("Route submission error:", error);
    return NextResponse.json(
      { error: "Failed to route appointment" },
      { status: 500 },
    );
  }
}

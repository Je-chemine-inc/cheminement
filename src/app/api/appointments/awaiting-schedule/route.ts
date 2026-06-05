import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/appointments/awaiting-schedule
 *
 * Appointments this professional has ACCEPTED (matched) but for which the first
 * RDV date is not yet set — i.e. `routingStatus: "accepted"` + `status: "pending"`.
 * Drives the pro portal's "À planifier" tab, where the pro confirms the 1st RDV
 * via POST /api/appointments/[id]/schedule-first.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "professional") {
      return NextResponse.json(
        { error: "Only professionals can access this endpoint" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    const appointments = await Appointment.find({
      professionalId: session.user.id,
      routingStatus: "accepted",
      status: "pending",
    })
      .populate("clientId", "firstName lastName email phone location")
      // Urgent requests first so the 24h take-charge SLA stays visible, then recency.
      .sort({ isEmergency: -1, createdAt: -1 });

    // Drop rows whose client User has been deleted (mirrors proposed/general).
    const safe = appointments.filter((apt) => apt.clientId != null);

    return NextResponse.json(safe);
  } catch (error) {
    console.error("Get awaiting-schedule appointments error:", error);
    return NextResponse.json(
      { error: "Failed to fetch appointments awaiting schedule" },
      { status: 500 },
    );
  }
}

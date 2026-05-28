import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/appointments/proposed
 * Get appointments proposed to the current professional
 */
export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // Optional filter

    // Build query for appointments proposed to this professional
    const query: Record<string, unknown> = {
      proposedTo: session.user.id,
      routingStatus: "proposed",
      status: "pending",
    };

    // Optional status filter
    if (status) {
      query.status = status;
    }

    const appointments = await Appointment.find(query)
      .populate("clientId", "firstName lastName email phone location")
      .sort({ createdAt: -1 });

    // Drop rows whose client User has been deleted — see /api/appointments/general
    // for the same defense against orphan records.
    const safe = appointments.filter((apt) => apt.clientId != null);

    return NextResponse.json(safe);
  } catch (error) {
    console.error("Get proposed appointments error:", error);
    return NextResponse.json(
      { error: "Failed to fetch proposed appointments" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/appointments/general
 * Get appointments in the general list (available to all professionals)
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
    const issueType = searchParams.get("issueType");
    const type = searchParams.get("type"); // video, in-person, phone
    const therapyType = searchParams.get("therapyType"); // solo, couple, group

    // Build query for appointments in general list
    // (either routing status is "general" or "refused" - meaning all professionals refused)
    const query: Record<string, unknown> = {
      routingStatus: { $in: ["general", "refused"] },
      status: "pending",
      // Exclude appointments this professional already refused
      refusedBy: { $ne: session.user.id },
    };

    // Optional filters
    if (issueType) {
      query.issueType = issueType;
    }
    if (type) {
      query.type = type;
    }
    if (therapyType) {
      query.therapyType = therapyType;
    }

    const appointments = await Appointment.find(query)
      .populate("clientId", "firstName lastName email phone location")
      .sort({ createdAt: -1 });

    // Drop rows whose client User has been deleted — the pro UI assumes
    // clientId is populated and crashes on null, which used to white-screen
    // the entire Propositions page when one orphan record was in the queue.
    const safe = appointments.filter((apt) => apt.clientId != null);

    return NextResponse.json(safe);
  } catch (error) {
    console.error("Get general appointments error:", error);
    return NextResponse.json(
      { error: "Failed to fetch general appointments" },
      { status: 500 },
    );
  }
}

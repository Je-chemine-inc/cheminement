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

    // The general pool is a PULL mechanism open to EVERY professional at all
    // times (client feedback §2): a pro can browse it and self-"piger" a client
    // whenever they like. The "accepting new clients" toggle gates only the
    // automatic PUSH (cascade proposals + broadcast emails), never this view.

    const { searchParams } = new URL(req.url);
    const issueType = searchParams.get("issueType");
    const type = searchParams.get("type"); // video, in-person, phone
    const therapyType = searchParams.get("therapyType"); // solo, couple, group

    // Clients who have already had an appointment with this pro: when those
    // clients return via the "Demander un rendez-vous avec un autre
    // professionnel" CTA (isReturningClient=true), they explicitly want a
    // DIFFERENT pro. Hide their requests from this pro's general queue so we
    // can't re-match them with the same one. Restricted to returning-client
    // requests so brand-new requests from those same clients (if any) still
    // show up.
    const priorClientIds = await Appointment.distinct("clientId", {
      professionalId: session.user.id,
    });

    // Build query for appointments in general list
    // (either routing status is "general" or "refused" - meaning all professionals refused)
    const query: Record<string, unknown> = {
      routingStatus: { $in: ["general", "refused"] },
      status: "pending",
      // Exclude appointments this professional already refused
      refusedBy: { $ne: session.user.id },
    };

    if (priorClientIds.length > 0) {
      query.$nor = [
        { isReturningClient: true, clientId: { $in: priorClientIds } },
      ];
    }

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
      // Urgent requests first so they stand out in the general pool, then recency.
      .sort({ isEmergency: -1, createdAt: -1 });

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

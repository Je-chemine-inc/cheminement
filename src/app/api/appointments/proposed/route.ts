import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import {
  triggerDueCascadeCron,
  triggerDuePaymentReminders,
  triggerDueAppointmentReminders,
} from "@/lib/lazy-cron";

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

    // Opportunistically advance the matching cascade (24h/12h proposal timeouts)
    // off this professional's poll, so a lapsed proposal moves to the next pro /
    // general pool without an external scheduler. Throttled + idempotent (see
    // lazy-cron.ts); after() runs it post-response.
    after(() => triggerDueCascadeCron());
    // Same opportunistic trigger for the post-session invoice dunning
    // (H+12/H+36 reminders, H+48 overdue). Separately throttled (30 min).
    after(() => triggerDuePaymentReminders());
    // And the pre-appointment H-72 (cancel/reschedule) / H-48 reminders, which
    // the Vercel Hobby daily cron doesn't reliably run. Throttled (30 min).
    after(() => triggerDueAppointmentReminders());

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
      // Urgent "Consultation ponctuelle rapide" requests float to the top so the
      // pro sees them before the 12h accept-SLA lapses, then by recency.
      .sort({ isEmergency: -1, createdAt: -1 });

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

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import Appointment from "@/models/Appointment";

/**
 * §4 "Définir comme Consultation ponctuelle rapide": the admin toggles the
 * urgent flag on a dossier straight from the "Demande de service" / "Pool
 * Général" queues — a one-click action, no popup, no required field.
 *
 * Setting isEmergency=true drives the existing urgent behaviour: the "Urgence"
 * badge, top-sort in the admin queues + pro proposals, and the 12h accept SLA
 * (vs 24h regular) in the proposal-timeout cron. Setting it false reverts the
 * dossier to a standard request. Works on any dossier regardless of routingStatus.
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

    const { isEmergency } = (await req.json().catch(() => ({}))) as {
      isEmergency?: boolean;
    };

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { $set: { isEmergency: Boolean(isEmergency) } },
      { new: true },
    ).select("_id isEmergency");

    if (!appointment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: appointment._id.toString(),
      isEmergency: appointment.isEmergency,
    });
  } catch (error) {
    console.error("Admin set-emergency error:", error);
    return NextResponse.json(
      {
        error: "Failed to update the request",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { canAccessAccount } from "@/lib/guardian-utils";

/**
 * POST /api/appointments/[id]/confirm
 *
 * Triggered when the client clicks the "Confirmer ma présence" CTA in the
 * H-48 reminder email or the dashboard. Stamps `clientConfirmedAt` so the
 * professional sees a "Présence confirmée" badge in their portal.
 *
 * Idempotent: re-clicking just refreshes the timestamp.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const { id } = await params;
    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Authorize: the requesting user must be the client OR their guardian.
    const clientId = appointment.clientId.toString();
    const isOwner = clientId === session.user.id;
    const isGuardian = !isOwner
      ? await canAccessAccount(session.user.id, clientId)
      : false;
    if (!isOwner && !isGuardian) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (appointment.status !== "scheduled") {
      return NextResponse.json(
        { error: "Only scheduled appointments can be confirmed" },
        { status: 400 },
      );
    }

    appointment.clientConfirmedAt = new Date();
    await appointment.save();

    return NextResponse.json({
      id: appointment._id.toString(),
      clientConfirmedAt: appointment.clientConfirmedAt.toISOString(),
    });
  } catch (error) {
    console.error("Confirm appointment error:", error);
    return NextResponse.json(
      { error: "Failed to confirm appointment" },
      { status: 500 },
    );
  }
}

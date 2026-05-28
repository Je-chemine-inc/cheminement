import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/appointments/[id]/refuse
 * Professional refuses a proposed appointment
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "professional") {
      return NextResponse.json(
        { error: "Only professionals can refuse appointments" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    const { id } = await params;
    const { reason } = await req.json().catch(() => ({ reason: "" }));

    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Check if appointment can be refused
    if (appointment.status !== "pending") {
      return NextResponse.json(
        { error: "Appointment is no longer pending" },
        { status: 400 },
      );
    }

    if (appointment.professionalId) {
      return NextResponse.json(
        { error: "Appointment already assigned to a professional" },
        { status: 400 },
      );
    }

    // Check if this professional was proposed this appointment
    const isProposed = appointment.proposedTo?.some(
      (pId: { toString: () => string }) => pId.toString() === session.user.id,
    );

    if (!isProposed) {
      return NextResponse.json(
        { error: "You were not proposed this appointment" },
        { status: 403 },
      );
    }

    // Check if already refused
    const alreadyRefused = appointment.refusedBy?.some(
      (pId: { toString: () => string }) => pId.toString() === session.user.id,
    );

    if (alreadyRefused) {
      return NextResponse.json(
        { error: "You have already refused this appointment" },
        { status: 400 },
      );
    }

    // Add this professional to refusedBy array
    const updatedRefusedBy = [
      ...(appointment.refusedBy || []),
      session.user.id,
    ];

    // Check if all proposed professionals have refused
    const allRefused = appointment.proposedTo?.every(
      (pId: { toString: () => string }) =>
        updatedRefusedBy.some(
          (rId: { toString: () => string }) =>
            rId.toString() === pId.toString(),
        ),
    );

    // Update appointment
    const updateData: Record<string, unknown> = {
      refusedBy: updatedRefusedBy,
    };

    // If all proposed professionals refused, move to general list
    if (allRefused) {
      updateData.routingStatus = "general";
    }

    const updatedAppointment = await Appointment.findByIdAndUpdate(
      id,
      updateData,
      { new: true },
    ).populate("clientId", "firstName lastName email phone location language");

    return NextResponse.json({
      message: allRefused
        ? "Appointment refused and moved to general list"
        : "Appointment refused successfully",
      movedToGeneral: allRefused,
      appointment: updatedAppointment,
    });
  } catch (error) {
    console.error("Refuse appointment error:", error);
    return NextResponse.json(
      { error: "Failed to refuse appointment" },
      { status: 500 },
    );
  }
}

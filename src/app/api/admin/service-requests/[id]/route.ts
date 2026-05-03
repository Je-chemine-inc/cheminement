import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";

// DELETE /api/admin/service-requests/[id]
// Permanently removes a pending service request (Appointment with no professional yet).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const adminRecord = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("permissions")
      .lean();

    if (
      adminRecord?.permissions &&
      !adminRecord.permissions.managePatients &&
      !adminRecord.permissions.manageBilling
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || id.length !== 24) {
      return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (appointment.status !== "pending" || appointment.professionalId) {
      return NextResponse.json(
        {
          error:
            "This request is already in progress or assigned and cannot be deleted from this list.",
        },
        { status: 400 },
      );
    }

    await Appointment.deleteOne({ _id: appointment._id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("admin service-request delete:", error);
    return NextResponse.json(
      {
        error: "Failed to delete request",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

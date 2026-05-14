import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import Appointment from "@/models/Appointment";

/**
 * Manual "marquer comme payé" — used by admins to acknowledge an Interac
 * e-transfer (or any out-of-band payment) for a specific appointment.
 *
 * Sets `payment.status = "paid"` and `payment.paidAt = now`. If the payment
 * method was not yet set, marks it as "transfer" since that's the typical
 * trigger for this action.
 */
export async function POST(
  _req: NextRequest,
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
    if (!admin?.permissions?.manageBilling && !admin?.permissions?.manageUsers) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (appointment.payment.status === "paid") {
      return NextResponse.json({
        id: appointment._id.toString(),
        payment: {
          status: appointment.payment.status,
          paidAt: appointment.payment.paidAt,
        },
      });
    }

    appointment.payment.status = "paid";
    appointment.payment.paidAt = new Date();
    if (!appointment.payment.method) {
      appointment.payment.method = "transfer";
    }
    await appointment.save();

    return NextResponse.json({
      id: appointment._id.toString(),
      payment: {
        status: appointment.payment.status,
        paidAt: appointment.payment.paidAt,
        method: appointment.payment.method,
      },
    });
  } catch (error) {
    console.error("Admin mark-paid error:", error);
    return NextResponse.json(
      {
        error: "Failed to mark as paid",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import ClientReceipt from "@/models/ClientReceipt";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import Admin from "@/models/Admin";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    await connectToDatabase();

    const adminRecord = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("permissions")
      .lean();
    const perms = adminRecord?.permissions;
    if (perms && !perms.manageBilling && !perms.managePatients) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const receipt = await ClientReceipt.findById(id);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    if (receipt.status === "paid") {
      return NextResponse.json({ success: true, alreadyPaid: true });
    }

    receipt.status = "paid";
    await receipt.save();

    await Appointment.findByIdAndUpdate(receipt.appointmentId, {
      "payment.status": "paid",
      "payment.paidAt": new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("admin/client-receipts/[id]/mark-paid POST:", error);
    return NextResponse.json(
      { error: "Failed to mark receipt as paid" },
      { status: 500 },
    );
  }
}

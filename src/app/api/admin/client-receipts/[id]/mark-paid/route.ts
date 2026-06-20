import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import ClientReceipt from "@/models/ClientReceipt";
import { authOptions } from "@/lib/auth";
import Admin from "@/models/Admin";
import { settleInteracPayment } from "@/lib/payment-settlement";

export async function POST(
  req: NextRequest,
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
    // M4: fail CLOSED — a role==="admin" session with no active Admin record
    // (perms undefined) must NOT slip through. Require an explicit permission.
    const perms = adminRecord?.permissions;
    if (!perms || (!perms.manageBilling && !perms.managePatients)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const receipt = await ClientReceipt.findById(id);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    // Optional reconciliation metadata (payer name / note) captured by the admin
    // when associating an Interac transfer — e.g. one received under a spouse's
    // name or with a missing invoice number.
    const body = (await req.json().catch(() => ({}))) as {
      payerName?: string;
      note?: string;
    };

    if (receipt.status === "paid") {
      return NextResponse.json({ success: true, alreadyPaid: true });
    }

    // Flip BOTH the appointment payment and this receipt to paid (shared with
    // the appointment-level mark-paid button so the two never drift apart).
    await settleInteracPayment(receipt.appointmentId.toString(), {
      payerName: body.payerName,
      note: body.note,
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

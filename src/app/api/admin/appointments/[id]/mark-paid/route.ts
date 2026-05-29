import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import { settleInteracPayment } from "@/lib/payment-settlement";

/**
 * Manual "marquer comme payé" — used by admins to acknowledge an Interac
 * e-transfer (or any out-of-band payment) for a specific appointment.
 *
 * Delegates to settleInteracPayment, which sets `payment.status = "paid"` +
 * `payment.paidAt` (and method "transfer" if unset) AND flips the linked
 * client receipt from `pending_transfer` to `paid` so the client can finally
 * see it. Idempotent.
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

    const { found, alreadyPaid, payment } = await settleInteracPayment(id);
    if (!found) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ id, payment, alreadyPaid });
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

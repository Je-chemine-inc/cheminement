import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import {
  canReprice,
  computeRepriceAmounts,
  repriceSetPaths,
} from "@/lib/appointment-reprice";

/**
 * Admin re-price of a single appointment.
 *
 * A settings or per-professional pricing change never rewrites existing
 * appointments — the price agreed at booking stands until an admin deliberately
 * changes it here. Paid/refunded appointments and any appointment whose fiscal
 * receipt has been issued are refused.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid appointment id" }, { status: 400 });
    }

    await connectToDatabase();

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    const allowed = canReprice(appointment);
    if (!allowed.ok) {
      // 409: the appointment exists but its money is settled.
      return NextResponse.json({ error: allowed.reason }, { status: 409 });
    }

    const body = await req.json();
    const computed = computeRepriceAmounts(
      body?.clientPrice,
      body?.professionalPayout,
    );
    if (!computed.ok) {
      return NextResponse.json({ error: computed.reason }, { status: 400 });
    }

    const updated = await Appointment.findOneAndUpdate(
      { _id: id },
      { $set: repriceSetPaths(computed.amounts) },
      { new: true },
    );

    return NextResponse.json({
      id,
      payment: {
        price: updated?.payment?.price,
        platformFee: updated?.payment?.platformFee,
        professionalPayout: updated?.payment?.professionalPayout,
        status: updated?.payment?.status,
      },
    });
  } catch (err: unknown) {
    console.error("Appointment reprice error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

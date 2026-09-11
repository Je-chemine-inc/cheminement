import { NextResponse } from "next/server";
import Appointment from "@/models/Appointment";
import { requireBillingAdmin } from "@/lib/organization-admin";

const HOURS_48_MS = 48 * 60 * 60 * 1000;

/**
 * Paiements Stripe en échec ; Interac / virement toujours en attente > 48 h après clôture séance.
 */
export async function GET() {
  try {
    const gate = await requireBillingAdmin();
    if (gate.error) return gate.error;

    const stripeFailures = await Appointment.find({
      "payment.status": "failed",
    })
      .populate("clientId", "firstName lastName email")
      .populate("professionalId", "firstName lastName email")
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    const cutoff = new Date(Date.now() - HOURS_48_MS);

    const interacPendingTooLong = await Appointment.find({
      status: { $in: ["completed", "no-show"] },
      "payment.method": "transfer",
      "payment.status": "pending",
      "payment.price": { $gt: 0 },
      sessionCompletedAt: { $exists: true, $lte: cutoff },
    })
      .populate("clientId", "firstName lastName email")
      .populate("professionalId", "firstName lastName email")
      .sort({ sessionCompletedAt: 1 })
      .limit(200)
      .lean();

    return NextResponse.json({
      stripeFailures,
      interacPendingTooLong,
      counts: {
        stripeFailures: stripeFailures.length,
        interacPendingTooLong: interacPendingTooLong.length,
      },
    });
  } catch (e: unknown) {
    console.error("admin accounting anomalies:", e);
    return NextResponse.json(
      { error: "Failed to load anomalies" },
      { status: 500 },
    );
  }
}

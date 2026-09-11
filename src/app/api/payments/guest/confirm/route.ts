import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { stripe } from "@/lib/stripe";

/**
 * POST /api/payments/guest/confirm — the /pay page calls this right after
 * `stripe.confirmPayment` resolves.
 *
 * It is the only place a guest payment becomes `processing`. That state used to
 * be written when the payment intent was merely CREATED, so a payer who opened
 * the form and left made the session look settled to every reminder. Now it is
 * written only when Stripe itself reports the payment in flight — in practice a
 * bank debit (ACSS), which takes days to clear and must not be dunned meanwhile.
 * `succeeded` needs nothing here: the webhook marks it paid and issues the
 * receipt.
 *
 * Trust: the pay token identifies the appointment, the intent must be the one
 * stored on it, and Stripe's own metadata must point back to it.
 */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    const token =
      body && typeof body === "object" && "token" in body
        ? (body as { token: unknown }).token
        : undefined;
    const paymentIntentId =
      body && typeof body === "object" && "paymentIntentId" in body
        ? (body as { paymentIntentId: unknown }).paymentIntentId
        : undefined;
    if (typeof token !== "string" || typeof paymentIntentId !== "string") {
      return NextResponse.json(
        { error: "token and paymentIntentId are required" },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const appointment = await Appointment.findOne({
      "payment.paymentToken": token,
      "payment.paymentTokenExpiry": { $gt: new Date() },
    }).select("_id payment.stripePaymentIntentId payment.status");
    if (!appointment) {
      return NextResponse.json(
        { error: "Invalid or expired payment link" },
        { status: 404 },
      );
    }
    if (appointment.payment?.stripePaymentIntentId !== paymentIntentId) {
      return NextResponse.json(
        { error: "This payment does not belong to this appointment" },
        { status: 409 },
      );
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.metadata?.appointmentId !== String(appointment._id)) {
      return NextResponse.json(
        { error: "This payment does not belong to this appointment" },
        { status: 409 },
      );
    }

    if (pi.status === "processing") {
      // Conditional, so it never overwrites `paid` written by a fast webhook.
      await Appointment.updateOne(
        {
          _id: appointment._id,
          "payment.stripePaymentIntentId": pi.id,
          "payment.status": { $in: ["pending", "failed", "overdue"] },
        },
        { $set: { "payment.status": "processing" } },
      );
    }

    return NextResponse.json({ status: pi.status });
  } catch (error) {
    console.error("Guest payment confirm error:", error);
    return NextResponse.json(
      { error: "Failed to confirm payment" },
      { status: 500 },
    );
  }
}

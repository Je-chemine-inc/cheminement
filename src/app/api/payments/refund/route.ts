import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { sendRefundConfirmation } from "@/lib/notifications";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import { refundAppointmentPayment } from "@/lib/appointment-refund";

/**
 * POST /api/payments/refund `{ appointmentId, reason? }` — an admin refunds a card-paid appointment in
 * full. The refund goes through lib/appointment-refund.ts: claimed on the appointment, sent with an
 * idempotency key, so a double click or a retry never refunds twice.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Refunds are admin-only. This route previously also authorized the
    // appointment's professional OR the client themselves, which let a client
    // POST their own appointmentId and claw back a full, policy-free Stripe
    // refund — even after attending a paid session. The legitimate,
    // policy-gated refund-on-cancel path lives in PATCH /api/appointments/[id]
    // (48h free-cancellation window + cancellation fee).
    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Only an administrator can issue a refund" },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as { appointmentId?: unknown; reason?: unknown } | null;
    const appointmentId = typeof body?.appointmentId === "string" ? body.appointmentId : "";

    if (!appointmentId) {
      return NextResponse.json(
        { error: "Appointment ID is required" },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const appointment = await Appointment.findById(appointmentId)
      .populate("clientId", "email firstName lastName language")
      .populate("professionalId", "firstName lastName");

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    if (!appointment.payment.stripePaymentIntentId) {
      return NextResponse.json(
        { error: "No payment found for this appointment" },
        { status: 400 },
      );
    }

    if (appointment.payment.status === "refunded" || appointment.payment.status === "partially_refunded") {
      return NextResponse.json(
        { error: "This appointment has already been refunded" },
        { status: 400 },
      );
    }

    if (appointment.payment.status !== "paid") {
      return NextResponse.json(
        {
          error: `Cannot refund appointment with payment status: ${appointment.payment.status}`,
        },
        { status: 400 },
      );
    }

    const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "Appointment cancelled";
    const result = await refundAppointmentPayment({
      appointmentId,
      amountCents: Math.round((appointment.payment.price ?? 0) * 100),
      by: "admin",
      byUserId: session.user.id,
      reason,
    });

    switch (result.outcome) {
      case "not_refundable":
        return NextResponse.json(
          { error: "This appointment cannot be refunded (already refunded, or nothing was paid)", code: "NOT_REFUNDABLE" },
          { status: 409 },
        );
      case "in_progress":
        return NextResponse.json(
          { error: "A refund for this appointment is already in progress", code: "REFUND_IN_PROGRESS" },
          { status: 409 },
        );
      case "refused":
        return NextResponse.json(
          { error: "Stripe refused the refund", code: "STRIPE_REFUSED", details: result.message },
          { status: 400 },
        );
      case "unconfirmed":
        return NextResponse.json(
          {
            error:
              "Stripe did not confirm the refund. Check the payment in Stripe before trying again: a new attempt checks Stripe first and never refunds twice.",
            code: "REFUND_UNCONFIRMED",
          },
          { status: 502 },
        );
    }

    const refundedAt = new Date();
    // Refund confirmation email — LSSSS art. 14 routing.
    const clientInfo = appointment.clientId as unknown as {
      firstName: string;
      lastName: string;
      email: string;
      language?: string;
    };
    const refundRecipient = resolveAppointmentRecipient(
      {
        bookingFor: appointment.bookingFor,
        lovedOneInfo: appointment.lovedOneInfo,
      },
      clientInfo,
    );
    sendRefundConfirmation({
      name: refundRecipient.name,
      email: refundRecipient.email,
      amount: result.amountCents / 100,
      appointmentDate: appointment.date?.toISOString(),
      locale: refundRecipient.language,
    }).catch((err) => console.error("Error sending refund confirmation:", err));

    return NextResponse.json({
      message: "Refund processed successfully",
      refund: {
        id: result.stripeRefundId,
        amount: result.amountCents / 100,
        status: result.pending ? "pending" : "succeeded",
        refundedAt,
      },
      appointment: {
        id: appointment._id,
        paymentStatus: result.full ? "refunded" : "partially_refunded",
      },
    });
  } catch (error: unknown) {
    console.error(
      "Refund error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to process refund",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { sendRefundConfirmation } from "@/lib/notifications";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { appointmentId, reason } = await req.json();

    if (!appointmentId) {
      return NextResponse.json(
        { error: "Appointment ID is required" },
        { status: 400 },
      );
    }

    await connectToDatabase();

    // Get appointment details
    const appointment = await Appointment.findById(appointmentId)
      .populate("clientId", "email firstName lastName language")
      .populate("professionalId", "firstName lastName");

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Check if user is authorized (admin, professional, or the client)
    const professionalDoc = appointment.professionalId;
    const professionalId =
      typeof professionalDoc === "object" &&
      professionalDoc !== null &&
      "_id" in professionalDoc
        ? (
            professionalDoc as { _id: { toString: () => string } }
          )._id.toString()
        : String(professionalDoc);

    const clientDoc = appointment.clientId;
    const clientId =
      typeof clientDoc === "object" && clientDoc !== null && "_id" in clientDoc
        ? (clientDoc as { _id: { toString: () => string } })._id.toString()
        : String(clientDoc);

    const isAuthorized =
      session.user.role === "admin" ||
      professionalId === session.user.id ||
      clientId === session.user.id;

    if (!isAuthorized) {
      return NextResponse.json(
        { error: "You are not authorized to refund this appointment" },
        { status: 403 },
      );
    }

    // Check if payment exists and was paid
    if (!appointment.payment.stripePaymentIntentId) {
      return NextResponse.json(
        { error: "No payment found for this appointment" },
        { status: 400 },
      );
    }

    // Check if already refunded
    if (appointment.payment.status === "refunded") {
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

    // Process refund through Stripe
    const refund = await stripe.refunds.create({
      payment_intent: appointment.payment.stripePaymentIntentId,
      reason: "requested_by_customer",
      metadata: {
        appointmentId: appointmentId,
        refundedBy: session.user.id,
        refundReason: reason || "Appointment cancelled",
      },
    });

    // Update appointment payment status
    appointment.payment.status = "refunded";
    appointment.payment.refundedAt = new Date();
    await appointment.save();

    // Send refund confirmation email — LSSSS art. 14 routing.
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
      amount: refund.amount / 100,
      appointmentDate: appointment.date?.toISOString(),
      locale: refundRecipient.language,
    }).catch((err) => console.error("Error sending refund confirmation:", err));

    return NextResponse.json({
      message: "Refund processed successfully",
      refund: {
        id: refund.id,
        amount: refund.amount / 100, // Convert from cents to dollars
        status: refund.status,
        refundedAt: appointment.payment.refundedAt,
      },
      appointment: {
        id: appointment._id,
        paymentStatus: appointment.payment.status,
      },
    });
  } catch (error: unknown) {
    console.error(
      "Refund error:",
      error instanceof Error ? error.message : error,
    );

    // Handle specific Stripe errors
    if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "StripeInvalidRequestError"
    ) {
      return NextResponse.json(
        {
          error: "Invalid refund request",
          details: error instanceof Error ? error.message : error,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Failed to process refund",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

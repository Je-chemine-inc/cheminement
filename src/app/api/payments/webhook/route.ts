import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { encryptPaymentMethodReference } from "@/lib/field-encryption";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import Stripe from "stripe";
import {
  sendGuestPaymentComplete,
  sendPaymentFailedNotification,
  sendRefundConfirmation,
} from "@/lib/notifications";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";

// Disable body parsing, need raw body for webhook signature verification
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 },
    );
  }

  await connectToDatabase();

  // Handle different event types
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object);
        break;

      case "payment_intent.canceled":
        await handlePaymentIntentCanceled(event.data.object);
        break;

      case "charge.refunded":
        await handleChargeRefunded(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed", details: message },
      { status: 500 },
    );
  }
}

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
) {
  console.log("Payment succeeded:", paymentIntent.id);

  const appointmentId = paymentIntent.metadata.appointmentId;

  if (!appointmentId) {
    console.error("No appointmentId in payment intent metadata");
    return;
  }

  const appointment = await Appointment.findById(appointmentId);

  if (!appointment) {
    console.error(`Appointment ${appointmentId} not found`);
    return;
  }

  // Update appointment payment status
  appointment.payment.status = "paid";
  appointment.payment.paidAt = new Date();

  // Store payment method if available
  if (paymentIntent.payment_method) {
    const rawPmId =
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method.id;
    appointment.payment.stripePaymentMethodId =
      encryptPaymentMethodReference(rawPmId) ?? rawPmId;
  }

  // Clear payment token after successful payment
  appointment.payment.paymentToken = undefined;
  appointment.payment.paymentTokenExpiry = undefined;
  appointment.awaitingPaymentGuarantee = false;

  await appointment.save();

  console.log(`Appointment ${appointmentId} payment completed`);

  // Send confirmation email for guest payments
  if (
    paymentIntent.metadata.type === "guest_payment" ||
    paymentIntent.metadata.visitorEmail
  ) {
    try {
      const populatedAppointment = await Appointment.findById(appointmentId)
        .populate("clientId", "firstName lastName email language")
        .populate("professionalId", "firstName lastName");

      if (populatedAppointment) {
        const client = populatedAppointment.clientId as unknown as {
          _id: { toString: () => string };
          firstName: string;
          lastName: string;
          email: string;
          language?: string;
        };
        const professional = populatedAppointment.professionalId as unknown as {
          firstName: string;
          lastName: string;
        };

        // Check if client is a guest
        const clientUser = await User.findById(client._id);
        if (clientUser && clientUser.role === "guest") {
          // LSSSS art. 14: route to the beneficiary for adult loved-one bookings.
          const recipient = resolveAppointmentRecipient(
            {
              bookingFor: populatedAppointment.bookingFor,
              lovedOneInfo: populatedAppointment.lovedOneInfo,
            },
            client,
          );
          sendGuestPaymentComplete({
            guestName: recipient.name,
            guestEmail: recipient.email,
            professionalName: `${professional.firstName} ${professional.lastName}`,
            date: populatedAppointment.date?.toISOString() || "",
            time: populatedAppointment.time,
            duration: populatedAppointment.duration || 60,
            type: populatedAppointment.type,
            therapyType: populatedAppointment.therapyType || "solo",
            price: populatedAppointment.payment.price,
            meetingLink: populatedAppointment.meetingLink,
            locale: recipient.language,
          }).catch((err) =>
            console.error(
              "Error sending guest payment confirmation email:",
              err,
            ),
          );
        }
      }
    } catch (emailError) {
      console.error("Error sending payment confirmation email:", emailError);
    }
  }
}

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log("Payment failed:", paymentIntent.id);

  const appointmentId = paymentIntent.metadata.appointmentId;

  if (!appointmentId) {
    console.error("No appointmentId in payment intent metadata");
    return;
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate("clientId", "firstName lastName email language")
    .populate("professionalId", "firstName lastName");

  if (!appointment) {
    console.error(`Appointment ${appointmentId} not found`);
    return;
  }

  appointment.payment.status = "failed";
  await appointment.save();

  console.log(`Appointment ${appointmentId} payment failed`);

  // Send payment failed notification to client
  try {
    const client = appointment.clientId as unknown as {
      firstName: string;
      lastName: string;
      email: string;
      language?: string;
    };
    const professional = appointment.professionalId as unknown as {
      firstName: string;
      lastName: string;
    };

    // LSSSS art. 14: route to the beneficiary for adult loved-one bookings.
    const recipient = resolveAppointmentRecipient(
      {
        bookingFor: appointment.bookingFor,
        lovedOneInfo: appointment.lovedOneInfo,
      },
      client,
    );

    sendPaymentFailedNotification({
      name: recipient.name,
      email: recipient.email,
      amount: appointment.payment.price || 0,
      appointmentDate: appointment.date?.toISOString(),
      professionalName: professional
        ? `${professional.firstName} ${professional.lastName}`
        : undefined,
      locale: recipient.language,
    }).catch((err) =>
      console.error("Error sending payment failed notification:", err),
    );
  } catch (emailError) {
    console.error("Error preparing payment failed email:", emailError);
  }
}

async function handlePaymentIntentCanceled(
  paymentIntent: Stripe.PaymentIntent,
) {
  console.log("Payment canceled:", paymentIntent.id);

  const appointmentId = paymentIntent.metadata.appointmentId;

  if (!appointmentId) {
    return;
  }

  const appointment = await Appointment.findById(appointmentId);

  if (appointment) {
    appointment.payment.status = "cancelled";
    await appointment.save();
  }
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  console.log("Charge refunded:", charge.id);

  // Find appointment by payment intent
  if (!charge.payment_intent) {
    return;
  }

  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent.id;

  const appointment = await Appointment.findOne({
    "payment.stripePaymentIntentId": paymentIntentId,
  });

  if (!appointment) {
    console.error(
      `Appointment not found for payment intent ${paymentIntentId}`,
    );
    return;
  }

  appointment.payment.status = "refunded";
  appointment.payment.refundedAt = new Date();
  await appointment.save();

  console.log(`Appointment ${appointment._id} refunded`);

  // Send refund confirmation to client — LSSSS art. 14 routing.
  try {
    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate("clientId", "firstName lastName email language")
      .populate("professionalId", "firstName lastName");

    if (populatedAppointment) {
      const client = populatedAppointment.clientId as unknown as {
        firstName: string;
        lastName: string;
        email: string;
        language?: string;
      };

      const recipient = resolveAppointmentRecipient(
        {
          bookingFor: populatedAppointment.bookingFor,
          lovedOneInfo: populatedAppointment.lovedOneInfo,
        },
        client,
      );

      sendRefundConfirmation({
        name: recipient.name,
        email: recipient.email,
        amount: charge.amount_refunded / 100,
        appointmentDate: populatedAppointment.date?.toISOString(),
        locale: recipient.language,
      }).catch((err) =>
        console.error("Error sending refund confirmation:", err),
      );
    }
  } catch (emailError) {
    console.error("Error sending refund confirmation email:", emailError);
  }
}

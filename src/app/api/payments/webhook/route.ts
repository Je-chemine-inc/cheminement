import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { encryptPaymentMethodReference } from "@/lib/field-encryption";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import StripeWebhookEvent from "@/models/StripeWebhookEvent";
import Stripe from "stripe";
import {
  sendGuestPaymentComplete,
  sendPaymentFailedNotification,
  sendRefundConfirmation,
} from "@/lib/notifications";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import {
  voidReceiptForRefund,
  restoreReceiptForReversedRefund,
} from "@/lib/payment-settlement";
import { issueFiscalReceipt } from "@/lib/session-post-closure";
import { markClientPaymentGuaranteeGreen } from "@/lib/payment-guarantee";

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

  // Idempotency (M7): atomically claim this event id so a Stripe redelivery
  // (Stripe retries on any non-2xx and may re-deliver even on success) is a
  // no-op instead of re-firing side effects (duplicate confirmation emails,
  // double state writes). If processing fails below, the claim is released so
  // the retry reprocesses.
  try {
    await StripeWebhookEvent.create({ eventId: event.id, type: event.type });
  } catch (claimErr: unknown) {
    if ((claimErr as { code?: number })?.code === 11000) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    throw claimErr;
  }

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

      case "charge.dispute.created":
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;

      case "charge.refund.updated":
        await handleRefundUpdated(event.data.object as Stripe.Refund);
        break;

      case "setup_intent.succeeded":
        await handleSetupIntentSucceeded(event.data.object as Stripe.SetupIntent);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    // Release the idempotency claim so Stripe's retry can reprocess the event.
    await StripeWebhookEvent.deleteOne({ eventId: event.id }).catch(() => {});
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

  // GOLDEN RULE: payment is now confirmed → issue the official fiscal receipt.
  // Idempotent + gated on a closed, billable session, so it is a no-op for
  // pre-session payments and for sessions whose receipt was already sent at
  // closure (saved-card charge that settled at H+0).
  await issueFiscalReceipt(appointmentId).catch((err) =>
    console.error("issueFiscalReceipt (payment_intent.succeeded):", err),
  );

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

  // M6: the manual refund route and the PATCH cancel route already email the
  // client inline before this webhook fires for the same API-initiated refund.
  // Capture whether the refund was ALREADY recorded so we don't double-email.
  const alreadyRefunded =
    appointment.payment.status === "refunded" ||
    appointment.payment.status === "partially_refunded";

  // M8: distinguish a full refund from a partial one (e.g. a cancellation-fee
  // refund, or a partial refund issued from the Stripe dashboard).
  const isFullRefund = charge.amount_refunded >= charge.amount;
  appointment.payment.status = isFullRefund ? "refunded" : "partially_refunded";
  appointment.payment.refundedAt = new Date();
  appointment.payment.refundedAmount = charge.amount_refunded / 100;
  await appointment.save();

  // Void the client's fiscal receipt only on a FULL refund — a partial refund
  // still leaves the client having paid the retained amount.
  if (isFullRefund) {
    await voidReceiptForRefund(String(appointment._id));
  }

  console.log(
    `Appointment ${appointment._id} ${isFullRefund ? "refunded" : "partially refunded"}`,
  );

  // M6: only email when WE are the first to record this refund (e.g. a refund
  // issued straight from the Stripe dashboard, where no inline path emailed).
  if (alreadyRefunded) {
    return;
  }

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

/**
 * M9: a chargeback/dispute was opened. Flag the appointment so the fiscal
 * receipt is no longer downloadable (the receipt route gates on
 * payment.status === "paid" && !disputed) and the money is visibly contested.
 * Stripe emails the platform about disputes natively, so we don't add an email
 * here — we just record state. Funds are held by Stripe until resolution.
 */
async function handleDisputeCreated(dispute: Stripe.Dispute) {
  console.warn("Charge dispute created:", dispute.id);

  const paymentIntentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!paymentIntentId) return;

  const appointment = await Appointment.findOne({
    "payment.stripePaymentIntentId": paymentIntentId,
  });
  if (!appointment) {
    console.error(
      `Appointment not found for disputed payment intent ${paymentIntentId}`,
    );
    return;
  }

  appointment.payment.disputed = true;
  await appointment.save();
  console.warn(`Appointment ${appointment._id} flagged disputed`);
}

/**
 * M9: a refund's async status changed. If the refund FAILED/was canceled, the
 * money never actually went back, so an appointment we eagerly marked
 * "refunded" must be reverted to "paid" (and its voided receipt restored).
 */
async function handleRefundUpdated(refund: Stripe.Refund) {
  if (refund.status !== "failed" && refund.status !== "canceled") {
    return;
  }
  console.warn(`Refund ${refund.id} ${refund.status}`);

  const paymentIntentId =
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : refund.payment_intent?.id;
  if (!paymentIntentId) return;

  const appointment = await Appointment.findOne({
    "payment.stripePaymentIntentId": paymentIntentId,
  });
  if (!appointment) return;

  if (
    appointment.payment.status === "refunded" ||
    appointment.payment.status === "partially_refunded"
  ) {
    appointment.payment.status = "paid";
    appointment.payment.refundedAt = undefined;
    appointment.payment.refundedAmount = undefined;
    await appointment.save();
    await restoreReceiptForReversedRefund(String(appointment._id));
    console.warn(
      `Appointment ${appointment._id} reverted to paid after failed refund`,
    );
  }
}

/**
 * M2: an ACSS/PAD SetupIntent finished verifying ("processing" → "succeeded").
 * The setup-complete routes deliberately did NOT mark the guarantee green for a
 * still-"processing" mandate, so green it now that the bank mandate is
 * confirmed usable. Card SetupIntents already greened synchronously at setup.
 * (Requires the Stripe endpoint to be subscribed to setup_intent.succeeded.)
 */
async function handleSetupIntentSucceeded(si: Stripe.SetupIntent) {
  const appointmentId = si.metadata?.appointmentId;
  if (!appointmentId) return;

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) return;

  const customerId =
    typeof si.customer === "string" ? si.customer : si.customer?.id;
  const pm = si.payment_method;
  const paymentMethodId = typeof pm === "string" ? pm : pm?.id;
  if (!customerId || !paymentMethodId) return;

  let pmType: "card" | "acss_debit" | undefined;
  try {
    const pmObj = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pmObj.type === "card" || pmObj.type === "acss_debit") {
      pmType = pmObj.type;
    }
  } catch (e) {
    console.warn("[setup_intent.succeeded] pm type lookup failed:", e);
  }

  await markClientPaymentGuaranteeGreen(
    appointment.clientId.toString(),
    customerId,
    paymentMethodId,
    true,
    pmType,
  );
  console.log(
    `Guarantee greened via setup_intent.succeeded for appointment ${appointmentId}`,
  );
}

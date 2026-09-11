import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { stripe, toCents } from "@/lib/stripe";
import {
  decideGuestPayment,
  GUEST_PAY_REFUSAL_MESSAGES,
  hasClosedLateOrNoShowFee,
} from "@/lib/guest-payment-eligibility";

/** Stripe states where the payer still has to act: safe to hand back. */
const AWAITING_PAYER = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
]);
/** Stripe states where money is moving or has moved. */
const IN_FLIGHT = new Set(["processing", "succeeded"]);

/**
 * Is the stored payment intent genuinely paying? A missing intent is not; any
 * other Stripe error is rethrown rather than guessed at, so an outage never
 * resets a payment that is really in flight.
 */
async function isPaymentIntentInFlight(
  paymentIntentId: string | null | undefined,
): Promise<boolean> {
  if (!paymentIntentId) return false;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    return IN_FLIGHT.has(pi.status);
  } catch (error) {
    if (
      error instanceof Stripe.errors.StripeError &&
      error.code === "resource_missing"
    ) {
      return false;
    }
    throw error;
  }
}

/** The stored intent, if the payer can still complete it as-is. */
async function findReusablePaymentIntent(
  paymentIntentId: string | null | undefined,
  amountCents: number,
  methodType: string,
): Promise<Stripe.PaymentIntent | null> {
  if (!paymentIntentId) return null;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const reusable =
      AWAITING_PAYER.has(pi.status) &&
      pi.amount === amountCents &&
      pi.payment_method_types.includes(methodType);
    return reusable ? pi : null;
  } catch {
    // Unknown or unreadable: just create a fresh one.
    return null;
  }
}

// GET - Get appointment details by payment token
export async function GET(req: NextRequest) {
  try {
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Payment token is required" },
        { status: 400 },
      );
    }

    const appointment = await Appointment.findOne({
      "payment.paymentToken": token,
      "payment.paymentTokenExpiry": { $gt: new Date() },
    })
      .populate(
        "clientId",
        "firstName lastName email paymentGuaranteeStatus paymentGuaranteeSource",
      )
      .populate("professionalId", "firstName lastName");

    if (!appointment) {
      return NextResponse.json(
        { error: "Invalid or expired payment link" },
        { status: 404 },
      );
    }

    // Check if appointment is still valid. A late cancellation closed by the
    // professional carries a fee the client is asked to pay through this very
    // link, so it is not "cancelled" for payment purposes.
    if (
      appointment.status === "cancelled" &&
      !hasClosedLateOrNoShowFee(appointment)
    ) {
      return NextResponse.json(
        { error: "This appointment has been cancelled" },
        { status: 400 },
      );
    }

    const client = appointment.clientId as unknown as {
      firstName: string;
      lastName: string;
      email: string;
      paymentGuaranteeStatus?: string;
      paymentGuaranteeSource?: string;
    };

    const interacTrustGreen =
      client.paymentGuaranteeStatus === "green" &&
      client.paymentGuaranteeSource === "interac_trust";
    const interacTrustPending =
      client.paymentGuaranteeStatus === "pending_admin" &&
      appointment.payment?.method === "transfer";

    const professional = appointment.professionalId as unknown as {
      firstName?: string;
      lastName?: string;
    } | null;

    return NextResponse.json({
      appointmentId: appointment._id,
      date: appointment.date,
      time: appointment.time,
      duration: appointment.duration,
      type: appointment.type,
      therapyType: appointment.therapyType,
      price: appointment.payment.price,
      guestName: `${client.firstName} ${client.lastName}`,
      guestEmail: client.email,
      professionalName: professional
        ? `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim() ||
          "Professional"
        : "Professional",
      alreadyPaid: appointment.payment.status === "paid",
      paidAt: appointment.payment.paidAt,
      appointmentStatus: appointment.status,
      hasPaymentMethodOnFile:
        Boolean(appointment.payment.stripePaymentMethodId) || interacTrustGreen,
      interacTrustPending,
    });
  } catch (error) {
    console.error("Error fetching guest appointment:", error);
    return NextResponse.json(
      { error: "Failed to fetch appointment details" },
      { status: 500 },
    );
  }
}

// POST - Create payment intent for guest payment
export async function POST(req: NextRequest) {
  try {
    await connectToDatabase();

    const { token, paymentMethod = "card" } = await req.json();

    if (!token) {
      return NextResponse.json(
        { error: "Payment token is required" },
        { status: 400 },
      );
    }

    const validPaymentMethods = ["card", "direct_debit"];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return NextResponse.json(
        { error: "Invalid payment method" },
        { status: 400 },
      );
    }

    const appointment = await Appointment.findOne({
      "payment.paymentToken": token,
      "payment.paymentTokenExpiry": { $gt: new Date() },
    })
      .populate("clientId", "firstName lastName email stripeCustomerId")
      .populate("professionalId", "firstName lastName");

    if (!appointment) {
      return NextResponse.json(
        { error: "Invalid or expired payment link" },
        { status: 404 },
      );
    }

    // A `processing` row written by the old code at intent CREATION may be a
    // payment nobody ever made. Ask Stripe: if nothing is actually in flight,
    // put the row back to pending so this attempt can go ahead.
    if (appointment.payment.status === "processing") {
      const inFlight = await isPaymentIntentInFlight(
        appointment.payment.stripePaymentIntentId,
      );
      if (inFlight) {
        return NextResponse.json(
          {
            error: GUEST_PAY_REFUSAL_MESSAGES.PAYMENT_IN_PROGRESS,
            code: "PAYMENT_IN_PROGRESS",
          },
          { status: 409 },
        );
      }
      await Appointment.updateOne(
        {
          _id: appointment._id,
          "payment.status": "processing",
          "payment.stripePaymentIntentId":
            appointment.payment.stripePaymentIntentId ?? null,
        },
        { $set: { "payment.status": "pending" } },
      );
      appointment.payment.status = "pending";
    }

    // Completed sessions, and closed late cancellations / no-shows whose fee is
    // billed to the client (see guest-payment-eligibility.ts).
    const decision = decideGuestPayment(appointment);
    if (!decision.payable) {
      return NextResponse.json(
        { error: GUEST_PAY_REFUSAL_MESSAGES[decision.code], code: decision.code },
        { status: decision.code === "PAYMENT_IN_PROGRESS" ? 409 : 400 },
      );
    }

    const client = appointment.clientId as unknown as {
      _id: { toString: () => string };
      email: string;
      firstName: string;
      lastName: string;
      stripeCustomerId?: string;
    };

    const professional = appointment.professionalId as unknown as {
      _id: { toString: () => string };
      firstName?: string;
      lastName?: string;
    } | null;

    if (!professional?._id) {
      return NextResponse.json(
        {
          error:
            "This appointment has no professional assigned. Please contact support.",
        },
        { status: 400 },
      );
    }

    const amount = appointment.payment.price;

    if (typeof amount !== "number" || amount <= 0 || !Number.isFinite(amount)) {
      return NextResponse.json(
        { error: "Invalid session amount for payment." },
        { status: 400 },
      );
    }

    const platformFee = appointment.payment.platformFee;
    const professionalPayout = appointment.payment.professionalPayout;

    // Get or create Stripe customer for guest
    let customerId = client.stripeCustomerId;

    if (!customerId) {
      const existingCustomers = await stripe.customers.list({
        email: client.email.toLowerCase(),
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: client.email.toLowerCase(),
          name: `${client.firstName} ${client.lastName}`,
          metadata: {
            visitorId: client._id.toString(),
            type: "guest",
          },
        });
        customerId = customer.id;
      }

      // Update guest user with Stripe customer ID
      await User.findByIdAndUpdate(client._id, {
        stripeCustomerId: customerId,
      });
    }

    // Configure payment method types based on selected method
    let paymentMethodTypes: string[] = ["card"];

    if (paymentMethod === "direct_debit") {
      paymentMethodTypes = ["acss_debit"];
    } else {
      paymentMethodTypes = ["card"];
    }

    // Create Payment Intent config
    const paymentIntentConfig: Parameters<
      typeof stripe.paymentIntents.create
    >[0] = {
      amount: toCents(amount),
      currency: "cad",
      customer: customerId,
      metadata: {
        appointmentId: String(appointment._id),
        visitorId: client._id.toString(),
        visitorEmail: client.email,
        professionalId: professional._id.toString(),
        sessionDate: appointment.date ? appointment.date.toISOString() : "N/A",
        sessionTime: appointment.time || "N/A",
        platformFee: platformFee.toString(),
        professionalPayout: professionalPayout.toString(),
        type: "guest_payment",
        paymentMethod: paymentMethod,
      },
      description: `Therapy session with ${professional.firstName ?? ""} ${professional.lastName ?? ""} on ${appointment.date ? appointment.date.toLocaleDateString() : "TBD"}`,
      payment_method_types: paymentMethodTypes,
    };

    // Add payment method options for direct debit (ACSS)
    if (paymentMethod === "direct_debit") {
      paymentIntentConfig.payment_method_options = {
        acss_debit: {
          mandate_options: {
            payment_schedule: "sporadic",
            transaction_type: "personal",
          },
          verification_method: "automatic",
        },
      };
    }

    // Re-opening the link must not stack up payment intents: hand back the one
    // already waiting for this exact amount and method.
    const reusable = await findReusablePaymentIntent(
      appointment.payment.stripePaymentIntentId,
      toCents(amount),
      paymentMethodTypes[0],
    );
    const paymentIntent =
      reusable ?? (await stripe.paymentIntents.create(paymentIntentConfig));

    // Record the attempt, but do NOT mark it `processing`: nothing is paid yet.
    // Writing it here meant a payer who closed the tab left the session
    // "processing" forever — and every reminder treats that as settled, so the
    // fee was never chased again. /api/payments/guest/confirm sets it once
    // Stripe reports a payment actually in flight.
    appointment.payment.stripePaymentIntentId = paymentIntent.id;
    appointment.payment.method = paymentMethod;
    await appointment.save();

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amount,
      currency: "CAD",
    });
  } catch (error: unknown) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error("Guest payment intent (Stripe):", error.message, error.code);
      const status =
        typeof error.statusCode === "number" &&
        error.statusCode >= 400 &&
        error.statusCode < 500
          ? error.statusCode
          : 400;
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          type: error.type,
        },
        { status },
      );
    }
    console.error("Error creating guest payment intent:", error);
    return NextResponse.json(
      {
        error: "Failed to create payment intent",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

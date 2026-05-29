import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Stripe from "stripe";
import { authOptions } from "@/lib/auth";
import { stripe, toCents } from "@/lib/stripe";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { appointmentId, paymentMethod = "card" } = await req.json();

    if (!appointmentId) {
      return NextResponse.json(
        { error: "Appointment ID is required" },
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

    await connectToDatabase();

    // Get appointment details
    const appointment = await Appointment.findById(appointmentId)
      .populate("clientId", "email firstName lastName")
      .populate("professionalId", "firstName lastName");

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Verify the user is the client for this appointment
    const clientDoc = appointment.clientId;
    const clientId =
      typeof clientDoc === "object" && clientDoc !== null && "_id" in clientDoc
        ? (clientDoc as { _id: { toString: () => string } })._id.toString()
        : String(clientDoc);

    if (clientId !== session.user.id) {
      return NextResponse.json(
        { error: "You can only pay for your own appointments" },
        { status: 403 },
      );
    }

    if (appointment.status === "pending") {
      return NextResponse.json(
        {
          error:
            "Your appointment must be confirmed by your professional before any payment step.",
        },
        { status: 400 },
      );
    }

    if (
      appointment.status === "cancelled" ||
      appointment.status === "no-show"
    ) {
      return NextResponse.json(
        { error: "This appointment cannot be paid." },
        { status: 400 },
      );
    }

    // Charge only after the professional marks the session as completed
    if (appointment.status !== "completed") {
      return NextResponse.json(
        {
          error:
            "Payment is processed only after your professional marks the session as completed. Add a payment method under Billing to confirm your appointment; your card or bank details are handled securely by Stripe.",
        },
        { status: 400 },
      );
    }

    // Check if already paid
    if (appointment.payment.status === "paid") {
      return NextResponse.json(
        { error: "This appointment has already been paid" },
        { status: 400 },
      );
    }

    const client = appointment.clientId as unknown as {
      _id: { toString: () => string };
      email: string;
      firstName: string;
      lastName: string;
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

    // Create or retrieve Stripe Customer for the client
    let customerId = null;

    // Search for existing customer by email
    const existingCustomers = await stripe.customers.list({
      email: client.email,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      // Create new customer
      const customer = await stripe.customers.create({
        email: client.email,
        name: `${client.firstName} ${client.lastName}`,
        metadata: {
          userId: session.user.id,
          role: "client",
        },
      });
      customerId = customer.id;
    }

    // Configure payment method types based on selected method
    let paymentMethodTypes: string[] = ["card"];

    if (paymentMethod === "direct_debit") {
      // Pre-authorized debit for Canada
      paymentMethodTypes = ["acss_debit"];
    } else {
      // Default to card
      paymentMethodTypes = ["card"];
    }

    // Create Payment Intent with specific payment method types
    const paymentIntentConfig: Parameters<
      typeof stripe.paymentIntents.create
    >[0] = {
      amount: toCents(amount),
      currency: "cad",
      customer: customerId,
      metadata: {
        appointmentId: String(appointment._id),
        clientId: session.user.id,
        professionalId: professional._id.toString(),
        sessionDate: appointment.date ? appointment.date.toISOString() : "N/A",
        sessionTime: appointment.time || "N/A",
        platformFee: platformFee.toString(),
        professionalPayout: professionalPayout.toString(),
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

    // M3: reuse an in-flight PaymentIntent for this appointment instead of
    // creating a second live one. Creating a new PI would overwrite the stored
    // stripePaymentIntentId, orphaning the first PI and leaving the refund path
    // keyed on a stale id. If a usable PI already exists for the same amount +
    // method, return it; if the client switched method/amount, cancel the stale
    // one first.
    const existingPiId = appointment.payment.stripePaymentIntentId;
    if (existingPiId && appointment.payment.status === "processing") {
      try {
        const existing = await stripe.paymentIntents.retrieve(existingPiId);
        const settledOrDead =
          existing.status === "succeeded" || existing.status === "canceled";
        const sameCharge =
          existing.amount === toCents(amount) &&
          existing.payment_method_types?.[0] === paymentMethodTypes[0];
        if (!settledOrDead && sameCharge) {
          return NextResponse.json({
            clientSecret: existing.client_secret,
            paymentIntentId: existing.id,
            amount,
            currency: "CAD",
            reused: true,
          });
        }
        if (!settledOrDead) {
          // Method/amount changed → cancel the stale PI so it isn't orphaned.
          await stripe.paymentIntents.cancel(existingPiId).catch(() => {});
        }
      } catch (e) {
        console.warn("[create-intent] existing PI retrieve failed:", e);
      }
    }

    const paymentIntent = await stripe.paymentIntents.create(
      paymentIntentConfig,
      {
        idempotencyKey: `intent_${String(appointment._id)}_${toCents(
          amount,
        )}_${paymentMethod}`,
      },
    );

    // Update appointment payment information
    appointment.payment.stripePaymentIntentId = paymentIntent.id;
    appointment.payment.status = "processing";
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
      console.error("Create payment intent (Stripe):", error.message, error.code);
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

    console.error(
      "Create payment intent error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to create payment intent",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { encryptPaymentMethodReference } from "@/lib/field-encryption";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { markClientPaymentGuaranteeGreen } from "@/lib/payment-guarantee";

/**
 * After the client completes the SetupIntent in the browser, persist the
 * Stripe payment method id on the appointment (reference only — full bank/card
 * data stays with Stripe).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { appointmentId, setupIntentId } = await req.json();

    if (!appointmentId || !setupIntentId) {
      return NextResponse.json(
        { error: "appointmentId and setupIntentId are required" },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const appointment = await Appointment.findById(appointmentId);

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    const clientId = appointment.clientId.toString();

    if (clientId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const user = await User.findById(session.user.id);
    if (!user?.stripeCustomerId) {
      return NextResponse.json(
        { error: "Stripe customer not found for user" },
        { status: 400 },
      );
    }

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

    const siCustomer =
      typeof setupIntent.customer === "string"
        ? setupIntent.customer
        : setupIntent.customer?.id;

    if (siCustomer !== user.stripeCustomerId) {
      return NextResponse.json(
        { error: "Invalid setup intent for this account" },
        { status: 400 },
      );
    }

    if (setupIntent.metadata?.appointmentId !== appointmentId) {
      return NextResponse.json(
        { error: "Setup intent does not match this appointment" },
        { status: 400 },
      );
    }

    if (
      setupIntent.status !== "succeeded" &&
      setupIntent.status !== "processing"
    ) {
      return NextResponse.json(
        {
          error:
            "Payment method setup is not complete. Please finish verification in the form.",
        },
        { status: 400 },
      );
    }

    const pm = setupIntent.payment_method;
    const paymentMethodId =
      typeof pm === "string" ? pm : pm && "id" in pm ? pm.id : null;

    if (!paymentMethodId) {
      return NextResponse.json(
        {
          error:
            "No payment method returned yet. If you used bank debit, wait for verification and try again.",
        },
        { status: 400 },
      );
    }

    if (appointment.status !== "scheduled") {
      return NextResponse.json(
        {
          error: "This appointment is no longer in a state that accepts confirmation.",
        },
        { status: 400 },
      );
    }

    appointment.payment.stripePaymentMethodId =
      encryptPaymentMethodReference(paymentMethodId) ?? paymentMethodId;
    if (appointment.payment.status === "processing") {
      appointment.payment.status = "pending";
    }
    appointment.awaitingPaymentGuarantee = false;
    await appointment.save();

    let pmType: "card" | "acss_debit" | undefined;
    try {
      const pmObj =
        typeof pm === "object" && pm && "type" in pm
          ? pm
          : await stripe.paymentMethods.retrieve(paymentMethodId);
      if (pmObj.type === "card" || pmObj.type === "acss_debit") {
        pmType = pmObj.type;
      }
    } catch (e) {
      console.warn("[appointment-setup/complete] type lookup failed:", e);
    }

    await markClientPaymentGuaranteeGreen(
      session.user.id,
      user.stripeCustomerId,
      paymentMethodId,
      true,
      pmType,
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Appointment setup complete error:", error);
    return NextResponse.json(
      {
        error: "Failed to save payment method",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

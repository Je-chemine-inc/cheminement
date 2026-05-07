import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { stripe } from "@/lib/stripe";
import { encryptPaymentMethodReference } from "@/lib/field-encryption";
import { markClientPaymentGuaranteeGreen } from "@/lib/payment-guarantee";

export async function POST(req: NextRequest) {
  try {
    await connectToDatabase();

    const { token, setupIntentId } = await req.json();

    if (!token || !setupIntentId) {
      return NextResponse.json(
        { error: "token and setupIntentId are required" },
        { status: 400 },
      );
    }

    const appointment = await Appointment.findOne({
      "payment.paymentToken": token,
      "payment.paymentTokenExpiry": { $gt: new Date() },
    }).populate("clientId", "stripeCustomerId");

    if (!appointment) {
      return NextResponse.json(
        { error: "Invalid or expired payment link" },
        { status: 404 },
      );
    }

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

    const client = appointment.clientId as unknown as {
      _id: { toString: () => string };
      stripeCustomerId?: string;
    };

    const siCustomer =
      typeof setupIntent.customer === "string"
        ? setupIntent.customer
        : setupIntent.customer?.id;

    if (!client.stripeCustomerId || siCustomer !== client.stripeCustomerId) {
      return NextResponse.json(
        { error: "Invalid setup intent for this payment link" },
        { status: 400 },
      );
    }

    if (setupIntent.metadata?.appointmentId !== String(appointment._id)) {
      return NextResponse.json(
        { error: "Setup intent does not match this appointment" },
        { status: 400 },
      );
    }

    if (setupIntent.metadata?.paymentToken !== token) {
      return NextResponse.json(
        { error: "Setup intent does not match this link" },
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
      console.warn("[guest-appointment-setup/complete] type lookup failed:", e);
    }

    await markClientPaymentGuaranteeGreen(
      client._id.toString(),
      client.stripeCustomerId,
      paymentMethodId,
      true,
      pmType,
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Guest appointment setup complete error:", error);
    return NextResponse.json(
      {
        error: "Failed to save payment method",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

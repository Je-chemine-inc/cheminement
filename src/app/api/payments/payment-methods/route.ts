import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import User from "@/models/User";
import connectToDatabase from "@/lib/mongodb";
import {
  markClientPaymentGuaranteeGreen,
  syncPaymentGuaranteeStatusWithStripe,
} from "@/lib/payment-guarantee";

// GET - List payment methods for a customer
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const user = await User.findById(session.user.id);

    if (!user || !user.email) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Find Stripe customer by email
    const customers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });

    if (customers.data.length === 0) {
      return NextResponse.json({ paymentMethods: [] });
    }

    const customer = customers.data[0];

    // Get card payment methods for this customer
    const cardPaymentMethods = await stripe.paymentMethods.list({
      customer: customer.id,
      type: "card",
    });

    // Get ACSS debit payment methods for this customer
    const acssDebitPaymentMethods = await stripe.paymentMethods.list({
      customer: customer.id,
      type: "acss_debit",
    });

    // Combine all payment methods
    const allPaymentMethods = [
      ...cardPaymentMethods.data,
      ...acssDebitPaymentMethods.data,
    ];

    return NextResponse.json({
      paymentMethods: allPaymentMethods.map((pm) => ({
        id: pm.id,
        type: pm.type,
        card: pm.card
          ? {
              brand: pm.card.brand,
              last4: pm.card.last4,
              expMonth: pm.card.exp_month,
              expYear: pm.card.exp_year,
            }
          : null,
        acss_debit: pm.acss_debit
          ? {
              bank_name: pm.acss_debit.bank_name,
              last4: pm.acss_debit.last4,
              institution_number: pm.acss_debit.institution_number,
              transit_number: pm.acss_debit.transit_number,
            }
          : null,
        billing_details: pm.billing_details,
      })),
    });
  } catch (error: unknown) {
    console.error(
      "Get payment methods error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to retrieve payment methods",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

// POST - Add a new payment method
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { paymentMethodId } = await req.json();

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: "Payment method ID is required" },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const user = await User.findById(session.user.id);

    if (!user || !user.email) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Find or create Stripe customer
    let customer;
    const existingCustomers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        metadata: {
          userId: session.user.id,
          role: user.role,
        },
      });
    }

    // Attach payment method to customer
    const attached = await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customer.id,
    });

    // Set as default payment method if this is the first one
    const cardPaymentMethods = await stripe.paymentMethods.list({
      customer: customer.id,
      type: "card",
    });
    const acssPaymentMethods = await stripe.paymentMethods.list({
      customer: customer.id,
      type: "acss_debit",
    });
    const totalPaymentMethods =
      cardPaymentMethods.data.length + acssPaymentMethods.data.length;

    const pmType: "card" | "acss_debit" | undefined =
      attached.type === "card" || attached.type === "acss_debit"
        ? attached.type
        : undefined;

    await markClientPaymentGuaranteeGreen(
      session.user.id,
      customer.id,
      paymentMethodId,
      totalPaymentMethods === 1,
      pmType,
    );

    return NextResponse.json({
      success: true,
      message: "Payment method added successfully",
    });
  } catch (error: unknown) {
    console.error(
      "Add payment method error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to add payment method",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

// DELETE - Remove a payment method
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const paymentMethodId = searchParams.get("paymentMethodId");

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: "Payment method ID is required" },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const user = await User.findById(session.user.id);
    if (!user?.email) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Detach payment method
    await stripe.paymentMethods.detach(paymentMethodId);

    const customerId =
      user.stripeCustomerId ||
      (
        await stripe.customers.list({
          email: user.email.toLowerCase(),
          limit: 1,
        })
      ).data[0]?.id;

    if (customerId) {
      await syncPaymentGuaranteeStatusWithStripe(session.user.id, customerId);
    } else {
      const u = await User.findById(session.user.id);
      if (u?.paymentGuaranteeStatus !== "pending_admin") {
        await User.findByIdAndUpdate(session.user.id, {
          $set: { paymentGuaranteeStatus: "none" },
          $unset: { paymentGuaranteeSource: "" },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Payment method removed successfully",
    });
  } catch (error: unknown) {
    console.error(
      "Delete payment method error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to remove payment method",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

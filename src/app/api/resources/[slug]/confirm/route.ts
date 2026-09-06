import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import { stripe } from "@/lib/stripe";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  RESOURCE_PURCHASE_TYPE,
  findEntitlementForIntent,
  grantResourceEntitlement,
} from "@/lib/resource-entitlement";

/**
 * Called by the browser immediately after Stripe confirms a card.
 *
 * This is a CONVENIENCE, not the source of truth. The authoritative grant is
 * the `payment_intent.succeeded` webhook; this endpoint exists so a guest can
 * start reading at once instead of waiting for webhook delivery and email.
 * Both paths call the same idempotent helper, so whichever arrives first wins
 * and the other is a no-op.
 *
 * Authorization is the PaymentIntent id, which only the buyer's browser holds
 * (confirming the payment required its client_secret). It is verified against
 * Stripe — status must be `succeeded` — and its metadata must name THIS slug,
 * so one purchase cannot be replayed to unlock a different resource. This
 * mirrors how the appointment setup-intent completion routes verify metadata
 * before acting.
 */

interface Body {
  paymentIntentId?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    const limit = rateLimit(`resource-confirm:${getClientIp(req)}`, 20, 60_000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const paymentIntentId = body.paymentIntentId;
    if (typeof paymentIntentId !== "string" || !paymentIntentId.startsWith("pi_")) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    await connectToDatabase();

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Both checks matter: the type stops an appointment payment being replayed
    // here, and the slug stops a genuine resource purchase unlocking a
    // different, more expensive resource.
    if (
      pi.metadata?.type !== RESOURCE_PURCHASE_TYPE ||
      pi.metadata?.resourceSlug !== slug
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (pi.status !== "succeeded") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 409 });
    }

    await grantResourceEntitlement(pi);

    const ent = await findEntitlementForIntent(pi);
    if (!ent || ent.status !== "paid") {
      return NextResponse.json({ error: "Access not granted" }, { status: 409 });
    }

    // The token is only useful to a guest — a member's access follows their
    // session, so there is no reason to hand them a bearer credential.
    return NextResponse.json({
      granted: true,
      accessToken: ent.userId ? undefined : ent.accessToken,
    });
  } catch (error) {
    console.error(
      "[resource] confirm error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Failed to confirm" }, { status: 500 });
  }
}

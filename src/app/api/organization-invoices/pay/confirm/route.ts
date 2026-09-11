import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { confirmOrganizationPaymentStarted } from "@/lib/organization-invoice-card";

/**
 * POST /api/organization-invoices/pay/confirm `{ token, paymentIntentId }` —
 * the pay page says Stripe accepted the payment. Nothing here is taken on
 * trust: the intent must be the invoice's own and its status is asked of
 * Stripe. A bank debit Stripe reports `processing` is marked « débit en
 * cours » — the same as the `payment_intent.processing` webhook does.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`org-pay-confirm:${getClientIp(req)}`, 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const body = (await req.json().catch(() => null)) as { token?: unknown; paymentIntentId?: unknown } | null;
    const result = await confirmOrganizationPaymentStarted(body?.token, body?.paymentIntentId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ status: result.status, verification: result.verification ?? null });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error("[org-pay] confirm, Stripe:", error.message, error.code);
      return NextResponse.json({ error: "Could not check the payment" }, { status: 502 });
    }
    console.error("[org-pay] confirm failed:", error);
    return NextResponse.json({ error: "Could not check the payment" }, { status: 500 });
  }
}

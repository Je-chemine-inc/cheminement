import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import connectToDatabase from "@/lib/mongodb";
import Organization from "@/models/Organization";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isPayTokenShaped, publicInvoiceView } from "@/lib/organization-invoice-pay-link";
import { startOrganizationCardPayment } from "@/lib/organization-invoice-card";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";

/**
 * The organization's pay link (spec 002, phase 5). No login: the token in the
 * link is the credential, so the answer is kept to what a billing clerk needs —
 * organization, invoice number, amounts, due date. The invoice's lines (patient
 * names) are never read here.
 */

const NOT_FOUND = { error: "Invalid or expired payment link", code: "NOT_FOUND" };

export async function GET(req: NextRequest) {
  const limit = rateLimit(`org-pay:${getClientIp(req)}`, 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!isPayTokenShaped(token)) return NextResponse.json(NOT_FOUND, { status: 404 });
    await connectToDatabase();
    const inv = await OrganizationInvoice.findOne({ payToken: token })
      .select("organizationId number status totalCents paidCents balanceCents dueAt")
      .lean();
    if (!inv) return NextResponse.json(NOT_FOUND, { status: 404 });
    const org = await Organization.findById(inv.organizationId).select("name language").lean();
    const interacEmail = await getInteracDepositEmail().catch(() => "");
    return NextResponse.json({
      ...publicInvoiceView(inv, org),
      interacEmail: interacEmail || null,
    });
  } catch (error) {
    console.error("[org-pay] load failed:", error);
    return NextResponse.json({ error: "Failed to load the invoice" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(`org-pay-intent:${getClientIp(req)}`, 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    const result = await startOrganizationCardPayment(body?.token);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({
      clientSecret: result.clientSecret,
      amountCents: result.amountCents,
      currency: "CAD",
    });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error("[org-pay] Stripe:", error.message, error.code);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.error("[org-pay] intent failed:", error);
    return NextResponse.json({ error: "Failed to start the payment" }, { status: 500 });
  }
}

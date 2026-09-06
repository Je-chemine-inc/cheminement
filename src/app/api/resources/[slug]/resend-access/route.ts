import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import ContentEntry from "@/models/ContentEntry";
import ResourceEntitlement from "@/models/ResourceEntitlement";
import { sendResourcePurchaseComplete } from "@/lib/notifications";

/**
 * "I lost the email with my access link."
 *
 * ALWAYS answers 200 with the same neutral message, whether or not a purchase
 * exists. Anything else turns this into an oracle for "did this person buy
 * this resource?" — which, on a mental-health platform, is exactly the kind of
 * thing that must not be enumerable.
 *
 * Rate-limited hard for the same reason, and because it sends mail.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Two buckets: one per IP, one per address, so neither a single client nor a
  // rotating-IP caller can hammer one inbox.
  const ip = getClientIp(req);
  if (!rateLimit(`resource-resend-ip:${ip}`, 3, 60 * 60_000).allowed) {
    return NextResponse.json({ ok: true });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!EMAIL_PATTERN.test(email)) {
    // Still 200: a validation error here would also leak something.
    return NextResponse.json({ ok: true });
  }
  if (!rateLimit(`resource-resend-email:${email}`, 3, 24 * 60 * 60_000).allowed) {
    return NextResponse.json({ ok: true });
  }

  try {
    await connectToDatabase();

    const ent = await ResourceEntitlement.findOne({
      slug,
      buyerEmail: email,
      status: "paid",
    });

    if (ent?.accessToken) {
      const base =
        process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
      const entry = await ContentEntry.findOne({
        kind: "resource",
        slug,
        locale: ent.locale,
      });
      await sendResourcePurchaseComplete({
        buyerEmail: ent.buyerEmail,
        buyerName: ent.buyerName,
        resourceTitle: entry?.title ?? slug,
        amountCents: ent.amountCents,
        accessUrl: `${base}/book/${slug}?token=${ent.accessToken}`,
        locale: ent.locale,
      });
    }
  } catch (error) {
    // Logged, not surfaced: the response must look identical either way.
    console.error("[resource] resend access error:", error);
  }

  return NextResponse.json({ ok: true });
}

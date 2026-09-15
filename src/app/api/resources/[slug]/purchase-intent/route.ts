import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import Stripe from "stripe";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { stripe } from "@/lib/stripe";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import ContentEntry from "@/models/ContentEntry";
import ResourceEntitlement from "@/models/ResourceEntitlement";
import User from "@/models/User";
import { isPremiumEntry } from "@/lib/content-premium";
import { RESOURCE_PURCHASE_TYPE, newAccessToken } from "@/lib/resource-entitlement";
import PlatformSettings from "@/models/PlatformSettings";
import { commissionBpsOf } from "@/lib/product-rules";
import { saleTaxBreakdown, salesTaxSettingsOf } from "@/lib/sales-taxes";

/** The tax fields of a purchase, unset together when taxes do not apply to an attempt. */
const TAX_FIELDS = ["subtotalCents", "tpsCents", "tvqCents", "tpsRatePercent", "tvqRatePercent", "tpsNumber", "tvqNumber"] as const;

/**
 * Start a purchase of a premium resource.
 *
 * ONE route for members and guests, branching on the session rather than
 * splitting into two endpoints. The price lookup, the ownership check, the
 * in-flight reuse and the idempotency key are identical for both, and it was
 * exactly that split which left /api/payments/guest without an idempotency key
 * while /api/payments/create-intent has one.
 *
 * Card only. A PAD debit settles days later, and a digital good that arrives
 * three days after a $19 purchase is a support problem, not a feature. Do not
 * add acss_debit here "for parity" with the appointment flow.
 *
 * The amount is read from the database and nowhere else. Nothing in the request
 * body influences what is charged.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Body {
  email?: string;
  name?: string;
  locale?: string;
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_PATTERN.test(value.trim());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    const limit = rateLimit(`resource-intent:${getClientIp(req)}`, 10, 60_000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    await connectToDatabase();

    const body = (await req.json().catch(() => ({}))) as Body;
    const locale = body.locale === "en" ? "en" : "fr";

    // Load BOTH locale rows: the price is mirrored, and a disagreement means a
    // half-applied admin edit. Charging either value would be a guess.
    const docs = await ContentEntry.find({ kind: "resource", slug });
    const frDoc = docs.find((d) => d.locale === "fr");
    const enDoc = docs.find((d) => d.locale === "en");
    if (!frDoc || !enDoc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (frDoc.status !== "published" || enDoc.status !== "published") {
      // A draft must not be purchasable, and must not confirm it exists.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!isPremiumEntry(frDoc)) {
      return NextResponse.json(
        { error: "This resource is free" },
        { status: 400 },
      );
    }
    if (frDoc.priceCents !== enDoc.priceCents) {
      console.error("[resource] price mismatch between locales", {
        slug,
        fr: frDoc.priceCents,
        en: enDoc.priceCents,
      });
      return NextResponse.json({ error: "PRICE_MISMATCH" }, { status: 500 });
    }

    // A professional's product (spec 003 phase 5): on sale only while approved
    // and while its professional's account is active.
    if (frDoc.ownerProfessionalId) {
      const ownerActive = await User.exists({
        _id: frDoc.ownerProfessionalId,
        role: "professional",
        status: "active",
      });
      if (!ownerActive || frDoc.moderation?.status !== "approved") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    // The displayed price, then TPS and TVQ on top when an admin has turned
    // them on — for the team's resources and professionals' products alike.
    // The buyer is charged the total; the purchase keeps the amounts, rates
    // and numbers it was charged with, so a later settings change cannot alter it.
    const settings = await PlatformSettings.findOne()
      .select("productCommissionPercentage salesTaxes")
      .lean<{ productCommissionPercentage?: number; salesTaxes?: unknown } | null>();
    const priceCents = frDoc.priceCents;
    const taxes = saleTaxBreakdown(priceCents, salesTaxSettingsOf(settings?.salesTaxes));
    const amountCents = taxes?.totalCents ?? priceCents;

    // The commission is snapshotted the same way.
    const productSnapshot: {
      ownerProfessionalId: unknown;
      commissionBps: number;
      productType?: string;
    } | null = frDoc.ownerProfessionalId
      ? {
          ownerProfessionalId: frDoc.ownerProfessionalId,
          commissionBps: commissionBpsOf(settings?.productCommissionPercentage),
          productType: frDoc.productType,
        }
      : null;
    const taxSnapshot = taxes
      ? {
          taxTreatment: "added" as const,
          subtotalCents: taxes.subtotalCents,
          tpsCents: taxes.tpsCents,
          tvqCents: taxes.tvqCents,
          tpsRatePercent: taxes.tpsRatePercent,
          tvqRatePercent: taxes.tvqRatePercent,
          tpsNumber: taxes.tpsNumber,
          tvqNumber: taxes.tvqNumber,
        }
      : productSnapshot
        ? { taxTreatment: "inclusive_untracked" as const }
        : null;
    // A pending row reused from an attempt made under other settings must not
    // keep tax amounts this attempt does not charge.
    const staleTaxFields = taxes ? [] : [...TAX_FIELDS, ...(taxSnapshot ? [] : ["taxTreatment"])];
    const taxBreakdown = {
      subtotalCents: priceCents,
      tpsCents: taxes?.tpsCents ?? 0,
      tvqCents: taxes?.tvqCents ?? 0,
      taxes: taxes ? { tpsRatePercent: taxes.tpsRatePercent, tvqRatePercent: taxes.tvqRatePercent } : null,
    };

    // --- who is buying -------------------------------------------------------
    const session = await getServerSession(authOptions);
    let userId: string | undefined;
    let buyerEmail: string;
    let buyerName: string | undefined;

    if (session?.user?.id) {
      const user = await User.findById(session.user.id);
      if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = String(user._id);
      buyerEmail = user.email.trim().toLowerCase();
      buyerName = [user.firstName, user.lastName].filter(Boolean).join(" ");
    } else {
      // Guests are NOT given an account here. An unauthenticated endpoint that
      // mints users from unverified emails is a spam vector, and the platform
      // already carries a duplicate-account problem.
      if (!isValidEmail(body.email)) {
        return NextResponse.json(
          { error: "A valid email is required" },
          { status: 400 },
        );
      }
      buyerEmail = body.email.trim().toLowerCase();
      buyerName = typeof body.name === "string" ? body.name.trim() : undefined;
    }

    // --- already owned? ------------------------------------------------------
    const ownedQuery = userId
      ? { slug, status: "paid", $or: [{ userId }, { buyerEmail }] }
      : { slug, status: "paid", buyerEmail };
    if (await ResourceEntitlement.exists(ownedQuery)) {
      // Never a second charge for the same good. Guests are told a resend is
      // available rather than having one fired automatically — that would turn
      // this endpoint into an email cannon.
      return NextResponse.json(
        { error: "ALREADY_OWNED", alreadyOwned: true, resendAvailable: !userId },
        { status: 409 },
      );
    }

    // --- Stripe customer -----------------------------------------------------
    const existingCustomers = await stripe.customers.list({
      email: buyerEmail,
      limit: 1,
    });
    const customerId =
      existingCustomers.data[0]?.id ??
      (
        await stripe.customers.create({
          email: buyerEmail,
          name: buyerName || undefined,
          metadata: userId ? { userId, role: "client" } : { type: "guest" },
        })
      ).id;

    // --- the entitlement row, written BEFORE the intent ----------------------
    // Order matters: if the PaymentIntent succeeds but our write had failed,
    // the webhook would have no row and no metadata to find one by.
    const pending = await ResourceEntitlement.findOneAndUpdate(
      { slug, buyerEmail, status: { $in: ["pending", "failed"] } },
      {
        $setOnInsert: {
          kind: "resource",
          slug,
          buyerEmail,
          accessToken: newAccessToken(),
          accessCount: 0,
          // No accessTokenExpiry: a purchased good does not expire.
        },
        $set: {
          // `userId` is only ever set, never nulled — a null would collide with
          // every other guest row on the partial unique index.
          ...(userId ? { userId } : {}),
          ...(buyerName ? { buyerName } : {}),
          locale,
          amountCents,
          currency: "cad",
          status: "pending",
          stripeCustomerId: customerId,
          ...(productSnapshot ?? {}),
          ...(taxSnapshot ?? {}),
        },
        ...(staleTaxFields.length
          ? { $unset: Object.fromEntries(staleTaxFields.map((field) => [field, ""])) }
          : {}),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // --- reuse an in-flight intent instead of creating a second one ----------
    const existingPiId = pending.stripePaymentIntentId;
    if (existingPiId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(existingPiId);
        const settledOrDead =
          existing.status === "succeeded" || existing.status === "canceled";
        if (!settledOrDead && existing.amount === amountCents) {
          return NextResponse.json({
            clientSecret: existing.client_secret,
            paymentIntentId: existing.id,
            amountCents,
            ...taxBreakdown,
            currency: "CAD",
            entitlementId: String(pending._id),
            reused: true,
          });
        }
        if (!settledOrDead) {
          // The price changed under an abandoned attempt. Cancel it rather than
          // orphaning a live intent against a row we are about to re-point.
          await stripe.paymentIntents.cancel(existingPiId).catch(() => {});
        }
      } catch (err) {
        console.warn("[resource] existing PI retrieve failed:", err);
      }
    }

    // Hashed so no email lands in a Stripe idempotency key or its logs.
    const buyerKey =
      userId ?? crypto.createHash("sha256").update(buyerEmail).digest("hex").slice(0, 32);

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "cad",
        customer: customerId,
        payment_method_types: ["card"],
        description: `Je chemine — ${frDoc.title}`,
        metadata: {
          // The discriminator the shared webhook branches on. Must not collide
          // with the existing "guest_payment".
          type: RESOURCE_PURCHASE_TYPE,
          entitlementId: String(pending._id),
          resourceSlug: slug,
          buyerUserId: userId ?? "",
          buyerEmail,
          locale,
          ...(productSnapshot
            ? {
                ownerProfessionalId: String(productSnapshot.ownerProfessionalId),
                commissionBps: String(productSnapshot.commissionBps),
              }
            : {}),
          // The split of the amount, for reading a charge in the Stripe dashboard.
          ...(taxes
            ? {
                subtotalCents: String(taxes.subtotalCents),
                tpsCents: String(taxes.tpsCents),
                tvqCents: String(taxes.tvqCents),
              }
            : {}),
          // appointmentId is deliberately absent.
        },
      },
      // The key follows the amount charged: a change of price or of tax rates never reuses an old intent.
      { idempotencyKey: `resource_${slug}_${buyerKey}_${amountCents}` },
    );

    await ResourceEntitlement.updateOne(
      { _id: pending._id },
      { $set: { stripePaymentIntentId: paymentIntent.id } },
    );

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amountCents,
      ...taxBreakdown,
      currency: "CAD",
      entitlementId: String(pending._id),
    });
  } catch (error: unknown) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error("[resource] purchase intent (Stripe):", error.message, error.code);
      const status =
        typeof error.statusCode === "number" &&
        error.statusCode >= 400 &&
        error.statusCode < 500
          ? error.statusCode
          : 400;
      return NextResponse.json(
        { error: error.message, code: error.code, type: error.type },
        { status },
      );
    }
    console.error(
      "[resource] purchase intent error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to start the purchase" },
      { status: 500 },
    );
  }
}

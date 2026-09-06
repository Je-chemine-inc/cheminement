/**
 * Grant, revoke and merge access to premium resources.
 *
 * Every state change lives here rather than in the Stripe webhook, which is
 * already 500+ lines. The webhook branches call these and stay three lines long.
 *
 * The invariants these functions exist to hold:
 *
 *  1. A replayed Stripe event must not grant twice or email twice. The grant is
 *     ONE conditional update; `outcome === "granted"` (modifiedCount === 1) is
 *     the only signal that the buyer just gained access, and therefore the only
 *     trigger for the access email.
 *  2. Nothing here throws on a terminal condition ("row not found", "underpaid").
 *     A throw in a webhook handler releases the StripeWebhookEvent claim and
 *     makes Stripe retry a permanently-failing event forever. Throw only on
 *     genuinely transient failures — which a database error already does.
 *  3. Money is compared in INTEGER CENTS. Never a float.
 */
import crypto from "crypto";
import mongoose from "mongoose";
import ResourceEntitlement, {
  type IResourceEntitlement,
} from "@/models/ResourceEntitlement";

/** 256 bits. Matches the entropy of the existing payment/portal tokens. */
export function newAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** The slice of a Stripe PaymentIntent these helpers actually read. */
export interface PurchaseIntentLike {
  id: string;
  amount?: number;
  amount_received?: number;
  customer?: string | { id: string } | null;
  last_payment_error?: { message?: string } | null;
  metadata?: Record<string, string> | null;
}

export type GrantOutcome = "granted" | "already-paid" | "not-found" | "underpaid";

export interface GrantResult {
  outcome: GrantOutcome;
  entitlement: IResourceEntitlement | null;
}

/** The discriminator that tells the shared webhook this PI is not an appointment. */
export const RESOURCE_PURCHASE_TYPE = "resource_purchase";

export function isResourcePurchaseIntent(pi: {
  metadata?: Record<string, string> | null;
}): boolean {
  return pi.metadata?.type === RESOURCE_PURCHASE_TYPE;
}

function customerIdOf(customer: PurchaseIntentLike["customer"]): string | undefined {
  if (!customer) return undefined;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * Resolve the row this PaymentIntent belongs to.
 *
 * The metadata entitlementId is the fast path; the PI id is the fallback for
 * the window where the intent was created but our write-back had not landed.
 */
export async function findEntitlementForIntent(
  pi: PurchaseIntentLike,
): Promise<IResourceEntitlement | null> {
  const entId = pi.metadata?.entitlementId;
  if (entId && mongoose.Types.ObjectId.isValid(entId)) {
    const byId = await ResourceEntitlement.findById(entId);
    if (byId) return byId;
  }
  return ResourceEntitlement.findOne({ stripePaymentIntentId: pi.id });
}

/**
 * Flip pending/failed to paid, exactly once.
 *
 * The conditional status filter is the replay guard: a second delivery of the
 * same (or a different) event for the same PI matches nothing and reports
 * "already-paid", so no second email goes out.
 */
export async function grantResourceEntitlement(
  pi: PurchaseIntentLike,
): Promise<GrantResult> {
  const ent = await findEntitlementForIntent(pi);
  if (!ent) {
    // Terminal: no row to grant against. Log, do not throw — see invariant 2.
    console.error("[resource] no entitlement for payment intent", pi.id);
    return { outcome: "not-found", entitlement: null };
  }

  const paidCents = pi.amount_received ?? pi.amount ?? 0;
  if (paidCents < ent.amountCents) {
    // Price tampering, or a price edit mid-flight. Never grant on a short pay.
    await ResourceEntitlement.updateOne(
      { _id: ent._id, status: "pending" },
      { $set: { status: "failed", failureReason: "AMOUNT_UNDERPAID" } },
    );
    console.error("[resource] underpaid payment intent", {
      paymentIntentId: pi.id,
      entitlementId: String(ent._id),
      paidCents,
      dueCents: ent.amountCents,
    });
    return { outcome: "underpaid", entitlement: ent };
  }

  const customerId = customerIdOf(pi.customer);
  const res = await ResourceEntitlement.updateOne(
    { _id: ent._id, status: { $in: ["pending", "failed"] } },
    {
      $set: {
        status: "paid",
        paidAt: new Date(),
        // Stripe is authoritative for what was actually charged.
        amountCents: paidCents,
        stripePaymentIntentId: pi.id,
        ...(customerId ? { stripeCustomerId: customerId } : {}),
      },
      $unset: { failureReason: 1 },
    },
  );

  if (res.modifiedCount !== 1) {
    return { outcome: "already-paid", entitlement: ent };
  }

  const fresh = await ResourceEntitlement.findById(ent._id);
  return { outcome: "granted", entitlement: fresh ?? ent };
}

/** A card decline. Leaves the row re-payable: the buyer can retry the same resource. */
export async function markResourcePurchaseFailed(
  pi: PurchaseIntentLike,
): Promise<IResourceEntitlement | null> {
  const ent = await findEntitlementForIntent(pi);
  if (!ent) return null;
  await ResourceEntitlement.updateOne(
    { _id: ent._id, status: "pending" },
    {
      $set: {
        status: "failed",
        failureReason: pi.last_payment_error?.message ?? "PAYMENT_FAILED",
      },
    },
  );
  return ent;
}

export async function markResourcePurchaseCancelled(
  pi: PurchaseIntentLike,
): Promise<IResourceEntitlement | null> {
  const ent = await findEntitlementForIntent(pi);
  if (!ent) return null;
  // Only a still-pending intent is cancellable; never walk back a paid row.
  await ResourceEntitlement.updateOne(
    { _id: ent._id, status: "pending" },
    { $set: { status: "cancelled" } },
  );
  return ent;
}

export type RevokeOutcome = "revoked" | "partial-kept" | "already-refunded";

/**
 * Refund revokes access.
 *
 * FULL refund: status becomes "refunded" and the access token is destroyed, so
 * the emailed guest link stops working immediately.
 *
 * PARTIAL refund: access is KEPT. The buyer paid for a fixed-price digital good
 * and still holds most of its value; yanking it on a goodwill partial refund
 * would be the wrong call. Recorded, not enforced. Do not "fix" this into a
 * revoke without deciding that policy question first.
 */
export async function revokeResourceEntitlement(
  ent: IResourceEntitlement,
  charge: { amount?: number; amount_refunded?: number },
): Promise<RevokeOutcome> {
  const total = charge.amount ?? ent.amountCents;
  const refunded = charge.amount_refunded ?? 0;

  if (refunded < total) {
    await ResourceEntitlement.updateOne(
      { _id: ent._id },
      { $set: { refundedAmountCents: refunded } },
    );
    console.warn("[resource] partial refund, access kept", {
      entitlementId: String(ent._id),
      refunded,
      total,
    });
    return "partial-kept";
  }

  const res = await ResourceEntitlement.updateOne(
    { _id: ent._id, status: { $ne: "refunded" } },
    {
      $set: {
        status: "refunded",
        refundedAt: new Date(),
        refundedAmountCents: refunded,
      },
      // Kills the emailed guest link. Session access dies with the status change.
      $unset: { accessToken: 1 },
    },
  );
  return res.modifiedCount === 1 ? "revoked" : "already-refunded";
}

/**
 * A refund that Stripe later failed or cancelled — the money never left, so
 * access comes back.
 *
 * Mints a NEW token rather than restoring the old one: the old one was revoked
 * and may have circulated while the refund was in flight. That breaks the
 * buyer's bookmark, which is why the caller must re-send the access email.
 */
export async function restoreResourceEntitlement(
  ent: IResourceEntitlement,
): Promise<{ restored: boolean; accessToken: string | null }> {
  const accessToken = newAccessToken();
  const res = await ResourceEntitlement.updateOne(
    { _id: ent._id, status: "refunded" },
    {
      $set: { status: "paid", accessToken },
      $unset: { refundedAt: 1, refundedAmountCents: 1 },
    },
  );
  return res.modifiedCount === 1
    ? { restored: true, accessToken }
    : { restored: false, accessToken: null };
}

/** A chargeback: Stripe is holding the funds, so access stops until it resolves. */
export async function disputeResourceEntitlement(
  ent: IResourceEntitlement,
): Promise<void> {
  await ResourceEntitlement.updateOne(
    { _id: ent._id },
    { $set: { disputed: true }, $unset: { accessToken: 1 } },
  );
}

/**
 * Carry a merged account's purchases over to the surviving user.
 *
 * This CANNOT be an updateMany. If both accounts already own the same slug, the
 * partial unique index throws E11000 — and account-merge runs without a
 * transaction, so the throw would abort a merge that has already re-pointed
 * half a dozen collections. Rows move one at a time and a conflict is a skip,
 * not a failure.
 *
 * The buyerEmail clause is what makes a GUEST purchase follow someone into the
 * account they later create: those rows have no userId at all.
 */
export async function mergeResourceEntitlements(opts: {
  loserId: mongoose.Types.ObjectId;
  survivorId: mongoose.Types.ObjectId;
  loserEmail?: string | null;
}): Promise<number> {
  const { loserId, survivorId, loserEmail } = opts;

  const or: Record<string, unknown>[] = [{ userId: loserId }];
  if (loserEmail) {
    or.push({
      userId: { $exists: false },
      buyerEmail: loserEmail.trim().toLowerCase(),
    });
  }

  const rows = await ResourceEntitlement.find({ $or: or });
  let moved = 0;

  for (const row of rows) {
    if (row.status === "paid") {
      const clash = await ResourceEntitlement.exists({
        slug: row.slug,
        userId: survivorId,
        status: "paid",
      });
      // The survivor already has access. Leave the row where it is: they lose
      // nothing, and a guest row stays reachable by its token.
      if (clash) continue;
    }
    try {
      const res = await ResourceEntitlement.updateOne(
        { _id: row._id },
        { $set: { userId: survivorId } },
      );
      if (res.modifiedCount === 1) moved += 1;
    } catch (err: unknown) {
      // A race could still land us on the index. Skipping is correct here for
      // the same reason as above — never abort the surrounding merge.
      if ((err as { code?: number })?.code === 11000) continue;
      throw err;
    }
  }

  return moved;
}

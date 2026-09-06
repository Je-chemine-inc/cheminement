/**
 * Premium-resource entitlements: grant, revoke, restore, merge.
 *
 * These are the money paths. The cases that matter most are the ones that must
 * NOT happen: granting twice on a replayed Stripe event, granting on a short
 * payment, and aborting an account merge because two accounts bought the same
 * thing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

const ENT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const SURVIVOR = new mongoose.Types.ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb");
const LOSER = new mongoose.Types.ObjectId("cccccccccccccccccccccccc");

const h = vi.hoisted(() => ({
  ent: {
    findById: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    updateOne: vi.fn(),
    exists: vi.fn(),
  },
}));

vi.mock("@/models/ResourceEntitlement", () => ({ default: h.ent }));

import {
  disputeResourceEntitlement,
  grantResourceEntitlement,
  isResourcePurchaseIntent,
  markResourcePurchaseCancelled,
  markResourcePurchaseFailed,
  mergeResourceEntitlements,
  newAccessToken,
  restoreResourceEntitlement,
  revokeResourceEntitlement,
} from "@/lib/resource-entitlement";

type Row = Record<string, unknown> & { _id: string };

const row = (over: Partial<Row> = {}): Row => ({
  _id: ENT_ID,
  slug: "gerer-son-stress",
  status: "pending",
  amountCents: 1900,
  buyerEmail: "acheteur@example.com",
  ...over,
});

const intent = (over: Record<string, unknown> = {}) => ({
  id: "pi_123",
  amount: 1900,
  amount_received: 1900,
  metadata: { type: "resource_purchase", entitlementId: ENT_ID },
  ...over,
});

/** The $set payload of the Nth updateOne call. */
const setOf = (call = 0) =>
  (h.ent.updateOne.mock.calls[call]?.[1] as { $set?: Record<string, unknown> })
    ?.$set ?? {};
const unsetOf = (call = 0) =>
  (h.ent.updateOne.mock.calls[call]?.[1] as { $unset?: Record<string, unknown> })
    ?.$unset ?? {};
const filterOf = (call = 0) =>
  (h.ent.updateOne.mock.calls[call]?.[0] as Record<string, unknown>) ?? {};

beforeEach(() => {
  vi.clearAllMocks();
  h.ent.findById.mockResolvedValue(row());
  h.ent.findOne.mockResolvedValue(null);
  h.ent.find.mockResolvedValue([]);
  h.ent.exists.mockResolvedValue(null);
  h.ent.updateOne.mockResolvedValue({ modifiedCount: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("isResourcePurchaseIntent", () => {
  it("recognises only the resource discriminator", () => {
    expect(isResourcePurchaseIntent({ metadata: { type: "resource_purchase" } })).toBe(true);
    // Must not collide with the existing guest-appointment discriminator.
    expect(isResourcePurchaseIntent({ metadata: { type: "guest_payment" } })).toBe(false);
    expect(isResourcePurchaseIntent({ metadata: {} })).toBe(false);
    expect(isResourcePurchaseIntent({})).toBe(false);
  });
});

describe("newAccessToken", () => {
  it("mints 256 bits of hex", () => {
    const t = newAccessToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    expect(newAccessToken()).not.toBe(newAccessToken());
  });
});

describe("grantResourceEntitlement", () => {
  it("flips pending to paid and reports granted", async () => {
    const res = await grantResourceEntitlement(intent());

    expect(res.outcome).toBe("granted");
    expect(setOf().status).toBe("paid");
    expect(setOf().stripePaymentIntentId).toBe("pi_123");
    expect(setOf().paidAt).toBeInstanceOf(Date);
  });

  it("only grants from a non-paid state", async () => {
    // This filter IS the replay guard — assert it explicitly.
    await grantResourceEntitlement(intent());
    expect(filterOf().status).toEqual({ $in: ["pending", "failed"] });
  });

  it("reports already-paid when the row did not move", async () => {
    // A replayed event, or a second event for the same PI.
    h.ent.updateOne.mockResolvedValue({ modifiedCount: 0 });

    const res = await grantResourceEntitlement(intent());

    expect(res.outcome).toBe("already-paid");
  });

  it("records what Stripe actually charged, not what we asked for", async () => {
    await grantResourceEntitlement(intent({ amount_received: 2500 }));
    expect(setOf().amountCents).toBe(2500);
  });

  it("grants when more than the price was received", async () => {
    const res = await grantResourceEntitlement(intent({ amount_received: 2500 }));
    expect(res.outcome).toBe("granted");
  });

  it("refuses to grant on a short payment, and marks it failed", async () => {
    const res = await grantResourceEntitlement(intent({ amount_received: 1 }));

    expect(res.outcome).toBe("underpaid");
    expect(setOf().status).toBe("failed");
    expect(setOf().failureReason).toBe("AMOUNT_UNDERPAID");
    // Critically: nothing was ever set to "paid".
    const everPaid = h.ent.updateOne.mock.calls.some(
      (c) => (c[1] as { $set?: { status?: string } })?.$set?.status === "paid",
    );
    expect(everPaid).toBe(false);
  });

  it("does not throw when no entitlement matches", async () => {
    // A throw here would release the webhook claim and make Stripe retry forever.
    h.ent.findById.mockResolvedValue(null);
    h.ent.findOne.mockResolvedValue(null);

    const res = await grantResourceEntitlement(intent());

    expect(res.outcome).toBe("not-found");
    expect(h.ent.updateOne).not.toHaveBeenCalled();
  });

  it("falls back to the payment intent id when metadata is missing", async () => {
    h.ent.findById.mockResolvedValue(null);
    h.ent.findOne.mockResolvedValue(row());

    const res = await grantResourceEntitlement(intent({ metadata: {} }));

    expect(h.ent.findOne).toHaveBeenCalledWith({ stripePaymentIntentId: "pi_123" });
    expect(res.outcome).toBe("granted");
  });

  it("stores the Stripe customer when the intent carries one", async () => {
    await grantResourceEntitlement(intent({ customer: "cus_123" }));
    expect(setOf().stripeCustomerId).toBe("cus_123");
  });

  it("accepts an expanded customer object", async () => {
    await grantResourceEntitlement(intent({ customer: { id: "cus_456" } }));
    expect(setOf().stripeCustomerId).toBe("cus_456");
  });
});

describe("markResourcePurchaseFailed / Cancelled", () => {
  it("records the decline reason without touching a paid row", async () => {
    await markResourcePurchaseFailed(
      intent({ last_payment_error: { message: "Your card was declined." } }),
    );
    expect(filterOf().status).toBe("pending");
    expect(setOf().status).toBe("failed");
    expect(setOf().failureReason).toBe("Your card was declined.");
  });

  it("cancels only a pending intent", async () => {
    await markResourcePurchaseCancelled(intent());
    expect(filterOf().status).toBe("pending");
    expect(setOf().status).toBe("cancelled");
  });
});

describe("revokeResourceEntitlement", () => {
  it("revokes access and kills the emailed link on a full refund", async () => {
    const out = await revokeResourceEntitlement(row({ status: "paid" }) as never, {
      amount: 1900,
      amount_refunded: 1900,
    });

    expect(out).toBe("revoked");
    expect(setOf().status).toBe("refunded");
    expect(setOf().refundedAt).toBeInstanceOf(Date);
    // The guest's bearer token must stop working immediately.
    expect(unsetOf().accessToken).toBe(1);
  });

  it("keeps access on a partial refund", async () => {
    const out = await revokeResourceEntitlement(row({ status: "paid" }) as never, {
      amount: 1900,
      amount_refunded: 500,
    });

    expect(out).toBe("partial-kept");
    expect(setOf().refundedAmountCents).toBe(500);
    expect(setOf().status).toBeUndefined();
    expect(unsetOf().accessToken).toBeUndefined();
  });

  it("is idempotent across a replayed refund", async () => {
    h.ent.updateOne.mockResolvedValue({ modifiedCount: 0 });

    const out = await revokeResourceEntitlement(row({ status: "refunded" }) as never, {
      amount: 1900,
      amount_refunded: 1900,
    });

    expect(out).toBe("already-refunded");
  });
});

describe("restoreResourceEntitlement", () => {
  it("re-grants with a NEW token after a failed refund", async () => {
    const first = await restoreResourceEntitlement(row({ status: "refunded" }) as never);
    const second = await restoreResourceEntitlement(row({ status: "refunded" }) as never);

    expect(first.restored).toBe(true);
    expect(first.accessToken).toMatch(/^[0-9a-f]{64}$/);
    // A fresh token, because the old one circulated while the refund was pending.
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(setOf().status).toBe("paid");
  });

  it("only restores a refunded row", async () => {
    await restoreResourceEntitlement(row({ status: "refunded" }) as never);
    expect(filterOf().status).toBe("refunded");
  });

  it("reports no restore when nothing moved", async () => {
    h.ent.updateOne.mockResolvedValue({ modifiedCount: 0 });
    const out = await restoreResourceEntitlement(row() as never);
    expect(out.restored).toBe(false);
    expect(out.accessToken).toBeNull();
  });
});

describe("disputeResourceEntitlement", () => {
  it("flags the dispute and pulls the token", async () => {
    await disputeResourceEntitlement(row({ status: "paid" }) as never);
    expect(setOf().disputed).toBe(true);
    expect(unsetOf().accessToken).toBe(1);
  });
});

describe("mergeResourceEntitlements", () => {
  it("re-points the loser's own purchases", async () => {
    h.ent.find.mockResolvedValue([row({ status: "paid", userId: LOSER })]);

    const moved = await mergeResourceEntitlements({
      loserId: LOSER,
      survivorId: SURVIVOR,
      loserEmail: "loser@example.com",
    });

    expect(moved).toBe(1);
    expect(setOf().userId).toBe(SURVIVOR);
  });

  it("claims a GUEST purchase by email", async () => {
    // The whole point: someone buys as a guest, signs up later, keeps the good.
    await mergeResourceEntitlements({
      loserId: LOSER,
      survivorId: SURVIVOR,
      loserEmail: "Guest@Example.COM",
    });

    const query = h.ent.find.mock.calls[0][0] as { $or: Record<string, unknown>[] };
    expect(query.$or).toContainEqual({
      userId: { $exists: false },
      buyerEmail: "guest@example.com",
    });
  });

  it("skips instead of throwing when the survivor already owns the resource", async () => {
    // E11000 here would abort a merge that already re-pointed six collections.
    h.ent.find.mockResolvedValue([row({ status: "paid", userId: LOSER })]);
    h.ent.exists.mockResolvedValue({ _id: "other" });

    const moved = await mergeResourceEntitlements({
      loserId: LOSER,
      survivorId: SURVIVOR,
      loserEmail: null,
    });

    expect(moved).toBe(0);
    expect(h.ent.updateOne).not.toHaveBeenCalled();
  });

  it("swallows a racing duplicate-key error rather than aborting the merge", async () => {
    h.ent.find.mockResolvedValue([row({ status: "paid", userId: LOSER })]);
    h.ent.updateOne.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));

    await expect(
      mergeResourceEntitlements({ loserId: LOSER, survivorId: SURVIVOR }),
    ).resolves.toBe(0);
  });

  it("still surfaces a real database failure", async () => {
    h.ent.find.mockResolvedValue([row({ status: "paid", userId: LOSER })]);
    h.ent.updateOne.mockRejectedValue(new Error("connection lost"));

    await expect(
      mergeResourceEntitlements({ loserId: LOSER, survivorId: SURVIVOR }),
    ).rejects.toThrow("connection lost");
  });

  it("moves a non-paid row without a clash check", async () => {
    h.ent.find.mockResolvedValue([row({ status: "pending", userId: LOSER })]);

    const moved = await mergeResourceEntitlements({
      loserId: LOSER,
      survivorId: SURVIVOR,
    });

    expect(moved).toBe(1);
    expect(h.ent.exists).not.toHaveBeenCalled();
  });

  it("never writes a null userId", async () => {
    // $exists:true matches null, so one null row would collide against every
    // other guest purchase and break buying platform-wide.
    h.ent.find.mockResolvedValue([row({ status: "paid", userId: LOSER })]);

    await mergeResourceEntitlements({ loserId: LOSER, survivorId: SURVIVOR });

    for (const call of h.ent.updateOne.mock.calls) {
      const set = (call[1] as { $set?: Record<string, unknown> })?.$set ?? {};
      expect(set.userId).not.toBeNull();
    }
  });
});

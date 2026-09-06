/**
 * The Stripe webhook — first tests on this file.
 *
 * AGENTS.md flags it as a legacy zone where "regressions move/lose money", and
 * adding premium-resource branches means editing six handlers that until now
 * only ever dealt with appointments. Two things are pinned here:
 *
 *   1. the new resource path grants access exactly once, and refund/dispute
 *      revoke it;
 *   2. the EXISTING appointment path is untouched — the regression pins below
 *      exist because a resource branch placed after the appointmentId bail
 *      would charge a buyer and deliver nothing, and a branch placed too
 *      greedily would break appointment payments instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PI_ID = "pi_resource_1";
const EVENT_ID = "evt_1";

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  webhookEventCreate: vi.fn(),
  webhookEventDeleteOne: vi.fn(),
  apptFindById: vi.fn(),
  apptFindOne: vi.fn(),
  entFindOne: vi.fn(),
  grant: vi.fn(),
  markFailed: vi.fn(),
  markCancelled: vi.fn(),
  revoke: vi.fn(),
  restore: vi.fn(),
  dispute: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: h.constructEvent } },
}));
vi.mock("@/models/StripeWebhookEvent", () => ({
  default: {
    create: h.webhookEventCreate,
    deleteOne: h.webhookEventDeleteOne,
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: { findById: h.apptFindById, findOne: h.apptFindOne },
}));
vi.mock("@/models/User", () => ({ default: { findById: vi.fn(), findOne: vi.fn() } }));
vi.mock("@/models/ResourceEntitlement", () => ({
  default: { findOne: h.entFindOne },
}));
vi.mock("@/lib/resource-entitlement", () => ({
  isResourcePurchaseIntent: (pi: { metadata?: Record<string, string> }) =>
    pi.metadata?.type === "resource_purchase",
  grantResourceEntitlement: h.grant,
  markResourcePurchaseFailed: h.markFailed,
  markResourcePurchaseCancelled: h.markCancelled,
  revokeResourceEntitlement: h.revoke,
  restoreResourceEntitlement: h.restore,
  disputeResourceEntitlement: h.dispute,
}));
vi.mock("@/lib/notifications", () => ({
  sendGuestPaymentComplete: vi.fn(),
  sendPaymentFailedNotification: vi.fn(),
  sendRefundConfirmation: vi.fn(),
}));
vi.mock("@/lib/guardian-utils", () => ({ resolveAppointmentRecipient: vi.fn() }));
vi.mock("@/lib/payment-settlement", () => ({
  voidReceiptForRefund: vi.fn(),
  restoreReceiptForReversedRefund: vi.fn(),
}));
vi.mock("@/lib/session-post-closure", () => ({ issueFiscalReceipt: vi.fn() }));
vi.mock("@/lib/payment-guarantee", () => ({ markClientPaymentGuaranteeGreen: vi.fn() }));
vi.mock("@/lib/field-encryption", () => ({
  encryptPaymentMethodReference: (v: string) => v,
}));

import { POST } from "./route";

const req = (signature: string | null = "sig") =>
  ({
    text: async () => "{}",
    headers: { get: (k: string) => (k === "stripe-signature" ? signature : null) },
  }) as never;

const event = (type: string, object: unknown, id = EVENT_ID) => ({
  id,
  type,
  data: { object },
});

const resourcePi = (over: Record<string, unknown> = {}) => ({
  id: PI_ID,
  amount: 1900,
  amount_received: 1900,
  metadata: { type: "resource_purchase", entitlementId: "ent1", resourceSlug: "s" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  h.webhookEventCreate.mockResolvedValue({});
  h.webhookEventDeleteOne.mockResolvedValue({});
  h.apptFindById.mockResolvedValue(null);
  h.apptFindOne.mockResolvedValue(null);
  h.entFindOne.mockResolvedValue(null);
  h.grant.mockResolvedValue({ outcome: "granted", entitlement: { _id: "ent1" } });
  h.revoke.mockResolvedValue("revoked");
  h.restore.mockResolvedValue({ restored: true, accessToken: "tok" });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("signature and idempotency", () => {
  it("rejects a request with no signature header", async () => {
    const res = await POST(req(null));

    expect(res.status).toBe(400);
    expect(h.webhookEventCreate).not.toHaveBeenCalled();
  });

  it("rejects a bad signature without claiming the event", async () => {
    h.constructEvent.mockImplementation(() => {
      throw new Error("no signatures found");
    });

    const res = await POST(req());

    expect(res.status).toBe(400);
    expect(h.webhookEventCreate).not.toHaveBeenCalled();
    expect(h.grant).not.toHaveBeenCalled();
  });

  it("treats a redelivered event id as a no-op", async () => {
    h.constructEvent.mockReturnValue(event("payment_intent.succeeded", resourcePi()));
    h.webhookEventCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));

    const res = await POST(req());

    expect((res.body as { duplicate: boolean }).duplicate).toBe(true);
    expect(h.grant).not.toHaveBeenCalled();
  });

  it("releases the claim and 500s when a handler throws, so Stripe retries", async () => {
    h.constructEvent.mockReturnValue(event("payment_intent.succeeded", resourcePi()));
    h.grant.mockRejectedValue(new Error("mongo down"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(h.webhookEventDeleteOne).toHaveBeenCalledWith({ eventId: EVENT_ID });
  });
});

describe("resource purchase succeeded", () => {
  it("grants access and never looks for an appointment", async () => {
    h.constructEvent.mockReturnValue(event("payment_intent.succeeded", resourcePi()));

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(h.grant).toHaveBeenCalledTimes(1);
    // Proves the branch sits BEFORE the appointmentId bail and returns.
    expect(h.apptFindById).not.toHaveBeenCalled();
  });

  it("is a no-op the second time the same purchase is delivered", async () => {
    // Two DIFFERENT event ids for one PaymentIntent: the StripeWebhookEvent
    // claim does not dedupe these, so the grant itself must.
    h.constructEvent.mockReturnValue(
      event("payment_intent.succeeded", resourcePi(), "evt_a"),
    );
    await POST(req());

    h.grant.mockResolvedValue({ outcome: "already-paid", entitlement: { _id: "ent1" } });
    h.constructEvent.mockReturnValue(
      event("payment_intent.succeeded", resourcePi(), "evt_b"),
    );
    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(h.grant).toHaveBeenCalledTimes(2);
  });

  it("does not throw when the payment was short", async () => {
    // Throwing would release the claim and make Stripe retry a permanently
    // failing event forever.
    h.constructEvent.mockReturnValue(event("payment_intent.succeeded", resourcePi()));
    h.grant.mockResolvedValue({ outcome: "underpaid", entitlement: null });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(h.webhookEventDeleteOne).not.toHaveBeenCalled();
  });
});

describe("resource purchase failed and cancelled", () => {
  it("marks a decline without touching appointments", async () => {
    h.constructEvent.mockReturnValue(
      event("payment_intent.payment_failed", resourcePi()),
    );

    await POST(req());

    expect(h.markFailed).toHaveBeenCalledTimes(1);
    expect(h.apptFindById).not.toHaveBeenCalled();
  });

  it("marks a cancellation without touching appointments", async () => {
    h.constructEvent.mockReturnValue(event("payment_intent.canceled", resourcePi()));

    await POST(req());

    expect(h.markCancelled).toHaveBeenCalledTimes(1);
    expect(h.apptFindById).not.toHaveBeenCalled();
  });
});

describe("refunds and disputes", () => {
  const charge = (over: Record<string, unknown> = {}) => ({
    id: "ch_1",
    payment_intent: PI_ID,
    amount: 1900,
    amount_refunded: 1900,
    ...over,
  });

  it("revokes access on a refund and never looks for an appointment", async () => {
    h.entFindOne.mockResolvedValue({ _id: "ent1", amountCents: 1900 });
    h.constructEvent.mockReturnValue(event("charge.refunded", charge()));

    await POST(req());

    expect(h.revoke).toHaveBeenCalledTimes(1);
    expect(h.apptFindOne).not.toHaveBeenCalled();
  });

  it("looks the entitlement up by payment intent", async () => {
    h.entFindOne.mockResolvedValue({ _id: "ent1" });
    h.constructEvent.mockReturnValue(event("charge.refunded", charge()));

    await POST(req());

    expect(h.entFindOne).toHaveBeenCalledWith({ stripePaymentIntentId: PI_ID });
  });

  it("passes a partial refund through to the helper, which keeps access", async () => {
    h.entFindOne.mockResolvedValue({ _id: "ent1", amountCents: 1900 });
    h.revoke.mockResolvedValue("partial-kept");
    h.constructEvent.mockReturnValue(
      event("charge.refunded", charge({ amount_refunded: 500 })),
    );

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(h.revoke).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      amount_refunded: 500,
    }));
  });

  it("stops access on a dispute", async () => {
    h.entFindOne.mockResolvedValue({ _id: "ent1" });
    h.constructEvent.mockReturnValue(
      event("charge.dispute.created", { id: "dp_1", payment_intent: PI_ID }),
    );

    await POST(req());

    expect(h.dispute).toHaveBeenCalledTimes(1);
    expect(h.apptFindOne).not.toHaveBeenCalled();
  });

  it("restores access when a refund itself fails", async () => {
    h.entFindOne.mockResolvedValue({ _id: "ent1" });
    h.constructEvent.mockReturnValue(
      event("charge.refund.updated", {
        id: "re_1",
        status: "failed",
        payment_intent: PI_ID,
      }),
    );

    await POST(req());

    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.apptFindOne).not.toHaveBeenCalled();
  });

  it("ignores a refund update that is still in flight", async () => {
    h.constructEvent.mockReturnValue(
      event("charge.refund.updated", {
        id: "re_1",
        status: "pending",
        payment_intent: PI_ID,
      }),
    );

    await POST(req());

    expect(h.restore).not.toHaveBeenCalled();
    expect(h.entFindOne).not.toHaveBeenCalled();
  });
});

describe("the appointment path is unchanged", () => {
  const apptPi = () => ({
    id: "pi_appt",
    amount: 12000,
    metadata: { appointmentId: "appt1" },
  });

  it("still resolves an appointment payment", async () => {
    h.constructEvent.mockReturnValue(event("payment_intent.succeeded", apptPi()));

    await POST(req());

    expect(h.apptFindById).toHaveBeenCalledWith("appt1");
    expect(h.grant).not.toHaveBeenCalled();
  });

  it("still bails on a payment intent with neither marker", async () => {
    h.constructEvent.mockReturnValue(
      event("payment_intent.succeeded", { id: "pi_x", metadata: {} }),
    );

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(h.grant).not.toHaveBeenCalled();
    expect(h.apptFindById).not.toHaveBeenCalled();
  });

  it("does not mistake a guest appointment payment for a resource purchase", async () => {
    // The two discriminators share the `type` key and must not collide.
    h.constructEvent.mockReturnValue(
      event("payment_intent.succeeded", {
        id: "pi_guest",
        metadata: { type: "guest_payment", appointmentId: "appt2" },
      }),
    );

    await POST(req());

    expect(h.grant).not.toHaveBeenCalled();
    expect(h.apptFindById).toHaveBeenCalledWith("appt2");
  });

  it("still falls through to the appointment on a refund with no entitlement", async () => {
    h.entFindOne.mockResolvedValue(null);
    h.constructEvent.mockReturnValue(
      event("charge.refunded", {
        id: "ch_2",
        payment_intent: "pi_appt",
        amount: 12000,
        amount_refunded: 12000,
      }),
    );

    await POST(req());

    expect(h.revoke).not.toHaveBeenCalled();
    expect(h.apptFindOne).toHaveBeenCalledWith({
      "payment.stripePaymentIntentId": "pi_appt",
    });
  });
});

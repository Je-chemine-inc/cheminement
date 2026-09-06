/**
 * Starting a premium-resource purchase.
 *
 * The cases that matter are the ones where money could go wrong: charging an
 * attacker-supplied price, charging twice for one good, charging for something
 * that is free or not published, and charging without the metadata the webhook
 * needs to grant access afterwards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SLUG = "gerer-son-stress";
const USER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const ENT_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  rateLimit: vi.fn(),
  entryFind: vi.fn(),
  entExists: vi.fn(),
  entFindOneAndUpdate: vi.fn(),
  entUpdateOne: vi.fn(),
  userFindById: vi.fn(),
  customersList: vi.fn(),
  customersCreate: vi.fn(),
  piCreate: vi.fn(),
  piRetrieve: vi.fn(),
  piCancel: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: h.rateLimit,
  getClientIp: () => "1.2.3.4",
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    customers: { list: h.customersList, create: h.customersCreate },
    paymentIntents: {
      create: h.piCreate,
      retrieve: h.piRetrieve,
      cancel: h.piCancel,
    },
  },
}));
vi.mock("@/models/ContentEntry", () => ({ default: { find: h.entryFind } }));
vi.mock("@/models/ResourceEntitlement", () => ({
  default: {
    exists: h.entExists,
    findOneAndUpdate: h.entFindOneAndUpdate,
    updateOne: h.entUpdateOne,
  },
}));
vi.mock("@/models/User", () => ({ default: { findById: h.userFindById } }));
vi.mock("@/lib/resource-entitlement", () => ({
  RESOURCE_PURCHASE_TYPE: "resource_purchase",
  newAccessToken: () => "f".repeat(64),
}));

import { POST } from "./route";

const doc = (locale: string, over: Record<string, unknown> = {}) => ({
  locale,
  kind: "resource",
  slug: SLUG,
  title: locale === "fr" ? "Gérer son stress" : "Managing stress",
  status: "published",
  isPremium: true,
  priceCents: 1900,
  ...over,
});

const req = (body: unknown = {}) =>
  ({ json: async () => body, headers: { get: () => null } }) as never;
const ctx = (slug = SLUG) => ({ params: Promise.resolve({ slug }) }) as never;

/** The options object (2nd arg) of the Nth paymentIntents.create call. */
const createOpts = (n = 0) => h.piCreate.mock.calls[n]?.[1] as { idempotencyKey: string };
const createArgs = (n = 0) =>
  h.piCreate.mock.calls[n]?.[0] as {
    amount: number;
    currency: string;
    payment_method_types: string[];
    metadata: Record<string, string>;
  };

beforeEach(() => {
  vi.clearAllMocks();
  h.rateLimit.mockReturnValue({ allowed: true, remaining: 9, resetAt: 0 });
  h.getServerSession.mockResolvedValue(null);
  h.entryFind.mockResolvedValue([doc("fr"), doc("en")]);
  h.entExists.mockResolvedValue(null);
  h.entFindOneAndUpdate.mockResolvedValue({ _id: ENT_ID });
  h.entUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  h.userFindById.mockResolvedValue({
    _id: USER_ID,
    email: "membre@example.com",
    firstName: "Alex",
    lastName: "Tremblay",
  });
  h.customersList.mockResolvedValue({ data: [{ id: "cus_existing" }] });
  h.customersCreate.mockResolvedValue({ id: "cus_new" });
  h.piCreate.mockResolvedValue({ id: "pi_new", client_secret: "cs_new" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("price integrity", () => {
  it("charges the database price, whatever the body claims", async () => {
    // The single most important assertion in this file.
    await POST(
      req({ email: "guest@example.com", amount: 1, priceCents: 1, amountCents: 1 }),
      ctx(),
    );

    expect(createArgs().amount).toBe(1900);
  });

  it("refuses when the two locale rows disagree on price", async () => {
    // A half-applied admin edit. Charging either value would be a guess.
    h.entryFind.mockResolvedValue([doc("fr"), doc("en", { priceCents: 900 })]);

    const res = await POST(req({ email: "guest@example.com" }), ctx());

    expect(res.status).toBe(500);
    expect((res.body as unknown as { error: string }).error).toBe("PRICE_MISMATCH");
    expect(h.piCreate).not.toHaveBeenCalled();
  });

  it("never creates an intent for a free resource", async () => {
    h.entryFind.mockResolvedValue([
      doc("fr", { isPremium: false, priceCents: 0 }),
      doc("en", { isPremium: false, priceCents: 0 }),
    ]);

    const res = await POST(req({ email: "guest@example.com" }), ctx());

    expect(res.status).toBe(400);
    expect(h.piCreate).not.toHaveBeenCalled();
  });

  it("never creates an intent for a flagged resource with no price", async () => {
    h.entryFind.mockResolvedValue([
      doc("fr", { priceCents: 0 }),
      doc("en", { priceCents: 0 }),
    ]);

    const res = await POST(req({ email: "guest@example.com" }), ctx());

    expect(res.status).toBe(400);
    expect(h.piCreate).not.toHaveBeenCalled();
  });
});

describe("what is purchasable", () => {
  it("404s an unpublished resource without confirming it exists", async () => {
    h.entryFind.mockResolvedValue([doc("fr", { status: "draft" }), doc("en")]);

    const res = await POST(req({ email: "guest@example.com" }), ctx());

    expect(res.status).toBe(404);
    expect(h.piCreate).not.toHaveBeenCalled();
  });

  it("404s an unknown slug", async () => {
    h.entryFind.mockResolvedValue([]);
    expect((await POST(req({ email: "g@example.com" }), ctx("nope"))).status).toBe(404);
  });

  it("404s a half-created entry missing one locale", async () => {
    h.entryFind.mockResolvedValue([doc("fr")]);
    expect((await POST(req({ email: "g@example.com" }), ctx())).status).toBe(404);
  });
});

describe("already owned", () => {
  it("refuses a second charge for a signed-in member", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: USER_ID } });
    h.entExists.mockResolvedValue({ _id: "existing" });

    const res = await POST(req({}), ctx());

    expect(res.status).toBe(409);
    expect((res.body as unknown as { error: string }).error).toBe("ALREADY_OWNED");
    expect(h.piCreate).not.toHaveBeenCalled();
  });

  it("refuses a second charge for a guest email that already bought", async () => {
    h.entExists.mockResolvedValue({ _id: "existing" });

    const res = await POST(req({ email: "guest@example.com" }), ctx());

    expect(res.status).toBe(409);
    expect(h.piCreate).not.toHaveBeenCalled();
  });

  it("offers a resend to a guest rather than firing one automatically", async () => {
    // Auto-sending here would make this endpoint an email cannon.
    h.entExists.mockResolvedValue({ _id: "existing" });

    const res = await POST(req({ email: "guest@example.com" }), ctx());

    expect((res.body as unknown as { resendAvailable: boolean }).resendAvailable).toBe(true);
  });

  it("matches a member by their id or the email they bought as", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: USER_ID } });
    await POST(req({}), ctx());

    const query = h.entExists.mock.calls[0][0] as { $or: Record<string, unknown>[] };
    expect(query.$or).toContainEqual({ userId: USER_ID });
    expect(query.$or).toContainEqual({ buyerEmail: "membre@example.com" });
  });
});

describe("guest identification", () => {
  it("requires an email", async () => {
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(400);
    expect(h.piCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    for (const bad of ["nope", "a@b", "@example.com", "  "]) {
      h.piCreate.mockClear();
      expect((await POST(req({ email: bad }), ctx())).status).toBe(400);
      expect(h.piCreate).not.toHaveBeenCalled();
    }
  });

  it("lowercases the email it stores and charges against", async () => {
    await POST(req({ email: "  Guest@Example.COM " }), ctx());
    expect(createArgs().metadata.buyerEmail).toBe("guest@example.com");
  });

  it("does not create a user account for a guest", async () => {
    // An unauthenticated endpoint minting accounts from unverified emails is a
    // spam vector, and this platform already has a duplicate-account problem.
    await POST(req({ email: "guest@example.com" }), ctx());
    expect(h.userFindById).not.toHaveBeenCalled();
  });

  it("ignores a body email when the caller is signed in", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: USER_ID } });
    await POST(req({ email: "attacker@example.com" }), ctx());
    expect(createArgs().metadata.buyerEmail).toBe("membre@example.com");
  });
});

describe("not charging twice", () => {
  it("reuses an in-flight intent instead of creating a second one", async () => {
    h.entFindOneAndUpdate.mockResolvedValue({
      _id: ENT_ID,
      stripePaymentIntentId: "pi_inflight",
    });
    h.piRetrieve.mockResolvedValue({
      id: "pi_inflight",
      client_secret: "cs_inflight",
      status: "requires_payment_method",
      amount: 1900,
    });

    const res = await POST(req({ email: "guest@example.com" }), ctx());

    expect(h.piCreate).not.toHaveBeenCalled();
    expect((res.body as unknown as { reused: boolean }).reused).toBe(true);
    expect((res.body as unknown as { clientSecret: string }).clientSecret).toBe(
      "cs_inflight",
    );
  });

  it("cancels a stale intent when the price has changed", async () => {
    h.entFindOneAndUpdate.mockResolvedValue({
      _id: ENT_ID,
      stripePaymentIntentId: "pi_stale",
    });
    h.piRetrieve.mockResolvedValue({
      id: "pi_stale",
      status: "requires_payment_method",
      amount: 900,
    });

    await POST(req({ email: "guest@example.com" }), ctx());

    expect(h.piCancel).toHaveBeenCalledWith("pi_stale");
    expect(h.piCreate).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a settled intent", async () => {
    h.entFindOneAndUpdate.mockResolvedValue({
      _id: ENT_ID,
      stripePaymentIntentId: "pi_done",
    });
    h.piRetrieve.mockResolvedValue({ id: "pi_done", status: "succeeded", amount: 1900 });

    await POST(req({ email: "guest@example.com" }), ctx());

    expect(h.piCancel).not.toHaveBeenCalled();
    expect(h.piCreate).toHaveBeenCalledTimes(1);
  });

  it("sends a stable idempotency key for the same buyer and price", async () => {
    await POST(req({ email: "guest@example.com" }), ctx());
    await POST(req({ email: "guest@example.com" }), ctx());

    expect(createOpts(0).idempotencyKey).toBe(createOpts(1).idempotencyKey);
  });

  it("keeps the raw email out of the idempotency key", async () => {
    await POST(req({ email: "guest@example.com" }), ctx());
    expect(createOpts().idempotencyKey).not.toContain("guest@example.com");
    expect(createOpts().idempotencyKey).toContain(SLUG);
  });

  it("uses a different key for a different price", async () => {
    await POST(req({ email: "guest@example.com" }), ctx());
    h.entryFind.mockResolvedValue([
      doc("fr", { priceCents: 4500 }),
      doc("en", { priceCents: 4500 }),
    ]);
    await POST(req({ email: "guest@example.com" }), ctx());

    expect(createOpts(0).idempotencyKey).not.toBe(createOpts(1).idempotencyKey);
  });
});

describe("the intent handed to Stripe", () => {
  it("carries the discriminator and no appointmentId", async () => {
    await POST(req({ email: "guest@example.com" }), ctx());

    const md = createArgs().metadata;
    expect(md.type).toBe("resource_purchase");
    expect(md.entitlementId).toBe(ENT_ID);
    expect(md.resourceSlug).toBe(SLUG);
    // The shared webhook keys off appointmentId; a resource purchase must not
    // look like an appointment payment.
    expect(md.appointmentId).toBeUndefined();
  });

  it("is card-only", async () => {
    // A PAD debit settling days later would strand a digital-good buyer.
    await POST(req({ email: "guest@example.com" }), ctx());
    expect(createArgs().payment_method_types).toEqual(["card"]);
  });

  it("is priced in CAD cents", async () => {
    await POST(req({ email: "guest@example.com" }), ctx());
    expect(createArgs().currency).toBe("cad");
    expect(createArgs().amount).toBe(1900);
  });

  it("records the intent id back onto the entitlement", async () => {
    // Without this the webhook can only resolve via metadata.
    await POST(req({ email: "guest@example.com" }), ctx());

    expect(h.entUpdateOne).toHaveBeenCalledWith(
      { _id: ENT_ID },
      { $set: { stripePaymentIntentId: "pi_new" } },
    );
  });

  it("never writes a null userId for a guest", async () => {
    // $exists:true matches null, which would collide every guest purchase.
    await POST(req({ email: "guest@example.com" }), ctx());

    const update = h.entFindOneAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
      $setOnInsert: Record<string, unknown>;
    };
    expect("userId" in update.$set).toBe(false);
    expect("userId" in update.$setOnInsert).toBe(false);
  });

  it("creates the entitlement row before the intent", async () => {
    // If the order flipped and our write failed, the webhook would have no row.
    await POST(req({ email: "guest@example.com" }), ctx());

    expect(h.entFindOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      h.piCreate.mock.invocationCallOrder[0],
    );
  });
});

describe("rate limiting", () => {
  it("refuses once the limit is hit, before touching Stripe", async () => {
    h.rateLimit.mockReturnValue({ allowed: false, remaining: 0, resetAt: 0 });

    const res = await POST(req({ email: "guest@example.com" }), ctx());

    expect(res.status).toBe(429);
    expect(h.piCreate).not.toHaveBeenCalled();
    expect(h.entryFind).not.toHaveBeenCalled();
  });
});

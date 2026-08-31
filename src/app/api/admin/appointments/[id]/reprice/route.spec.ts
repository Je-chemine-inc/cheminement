/**
 * Admin re-price of a single appointment. Pins the auth gate and the immutability
 * of settled money: a paid/refunded appointment, or one with an issued fiscal
 * receipt, must never be rewritten.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APT = "bbbbbbbbbbbbbbbbbbbbbbbb";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findById: vi.fn(),
  findOneAndUpdate: vi.fn(),
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
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: (...a: unknown[]) => h.findById(...a),
    findOneAndUpdate: (...a: unknown[]) => h.findOneAndUpdate(...a),
  },
}));

import { PATCH } from "@/app/api/admin/appointments/[id]/reprice/route";

type Res = Promise<{ status: number; body: unknown }>;

const call = (body: unknown, id = APT): Res =>
  PATCH({ json: async () => body } as never, {
    params: Promise.resolve({ id }),
  } as never) as unknown as Res;

const valid = { clientPrice: 175, professionalPayout: 150 };

beforeEach(() => {
  vi.clearAllMocks();
  h.getServerSession.mockResolvedValue({ user: { id: "adm", role: "admin" } });
  h.findById.mockResolvedValue({
    _id: APT,
    payment: { status: "pending", price: 160 },
  });
  h.findOneAndUpdate.mockResolvedValue({
    payment: {
      price: 175,
      platformFee: 25,
      professionalPayout: 150,
      status: "pending",
    },
  });
});

describe("auth gate", () => {
  it.each([
    ["professional", { user: { id: "p", role: "professional" } }],
    ["client", { user: { id: "c", role: "client" } }],
    ["anonymous", null],
  ])("rejects %s", async (_l, session) => {
    h.getServerSession.mockResolvedValue(session);

    const res = await call(valid);

    expect(res.status).toBe(401);
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a malformed id", async () => {
    expect((await call(valid, "nope")).status).toBe(400);
  });

  it("404s an unknown appointment", async () => {
    h.findById.mockResolvedValue(null);
    expect((await call(valid)).status).toBe(404);
  });
});

describe("settled money is immutable", () => {
  it.each(["paid", "processing", "refunded", "partially_refunded"])(
    "refuses a %s appointment with 409",
    async (status) => {
      h.findById.mockResolvedValue({ _id: APT, payment: { status } });

      const res = await call(valid);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: "PAYMENT_LOCKED" });
      expect(h.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it("refuses once a fiscal receipt is issued", async () => {
    h.findById.mockResolvedValue({
      _id: APT,
      payment: { status: "pending" },
      fiscalReceiptIssuedAt: new Date(),
    });

    const res = await call(valid);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "RECEIPT_ISSUED" });
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("refuses a payout above the client price", async () => {
    const res = await call({ clientPrice: 150, professionalPayout: 175 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "PAYOUT_EXCEEDS_PRICE" });
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([0, -1, null, "abc"])("refuses client price %s", async (bad) => {
    const res = await call({ clientPrice: bad, professionalPayout: 10 });
    expect(res.status).toBe(400);
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refuses a negative payout", async () => {
    const res = await call({ clientPrice: 175, professionalPayout: -5 });
    expect(res.status).toBe(400);
  });
});

describe("writing", () => {
  it("writes the derived split and realigns listPrice", async () => {
    const res = await call(valid);

    expect(res.status).toBe(200);
    const [, update] = h.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, number> },
    ];
    expect(update.$set).toEqual({
      "payment.price": 175,
      "payment.platformFee": 25,
      "payment.professionalPayout": 150,
      "payment.listPrice": 175,
    });
  });

  it("touches nothing outside payment", async () => {
    await call(valid);
    const [, update] = h.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, number> },
    ];
    for (const key of Object.keys(update.$set)) {
      expect(key.startsWith("payment.")).toBe(true);
    }
  });

  it("accepts a zero spread", async () => {
    const res = await call({ clientPrice: 175, professionalPayout: 175 });
    expect(res.status).toBe(200);
  });
});

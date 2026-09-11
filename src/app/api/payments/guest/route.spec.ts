import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST/GET /api/payments/guest — the no-login /pay link.
 *
 * Two regressions pinned here:
 *  1. Late-cancellation and no-show fees could not be paid through the link that
 *     closure emails for them (status "cancelled" / "no-show" was refused).
 *  2. Creating a payment intent marked the session `processing` before anyone
 *     paid, so an abandoned form silenced every reminder for good.
 */

const h = vi.hoisted(() => ({
  appointment: null as Record<string, unknown> | null,
  created: [] as Array<Record<string, unknown>>,
  retrieve: vi.fn(),
  updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/stripe", () => ({
  toCents: (d: number) => Math.round(d * 100),
  stripe: {
    customers: { list: vi.fn(async () => ({ data: [] })), create: vi.fn() },
    paymentIntents: {
      retrieve: h.retrieve,
      create: vi.fn(async (cfg: Record<string, unknown>) => {
        h.created.push(cfg);
        return { id: `pi_new_${h.created.length}`, client_secret: "secret_new" };
      }),
    },
  },
}));
vi.mock("@/models/User", () => ({
  default: { findByIdAndUpdate: vi.fn(async () => null) },
}));

function query(value: unknown) {
  const q: Record<string, unknown> = {};
  q.populate = () => q;
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(value).then(res, rej);
  return q;
}
vi.mock("@/models/Appointment", () => ({
  default: {
    findOne: vi.fn(() => query(h.appointment)),
    updateOne: h.updateOne,
  },
}));

import { GET, POST } from "@/app/api/payments/guest/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;
const pay = (method = "card"): Res =>
  POST({ json: async () => ({ token: "tok", paymentMethod: method }) } as never) as unknown as Res;
const view = (): Res =>
  GET({ url: "https://www.jechemine.ca/api/payments/guest?token=tok" } as never) as unknown as Res;

function appointmentWith(over: Record<string, unknown> = {}) {
  const payment = {
    status: "pending",
    price: 120,
    platformFee: 12,
    professionalPayout: 108,
    ...(over.payment as Record<string, unknown> | undefined),
  };
  return {
    _id: "apt-1",
    status: "completed",
    date: new Date("2026-09-09T12:00:00Z"),
    time: "10:00",
    clientId: {
      _id: { toString: () => "client-1" },
      firstName: "Élorie",
      lastName: "B",
      email: "elorie@example.com",
      stripeCustomerId: "cus_1",
    },
    professionalId: { _id: { toString: () => "pro-1" }, firstName: "P", lastName: "R" },
    save: vi.fn(async () => undefined),
    ...over,
    payment,
  };
}

beforeEach(() => {
  h.created.length = 0;
  h.retrieve.mockReset();
  h.updateOne.mockClear();
  h.appointment = appointmentWith();
});

describe("paying a late-cancellation or no-show fee", () => {
  it("accepts a closed no-show fee (it used to answer 'not available')", async () => {
    h.appointment = appointmentWith({
      status: "no-show",
      sessionCompletedAt: new Date(),
      sessionOutcome: "no_show",
    });
    const res = await pay();
    expect(res.status).toBe(200);
    expect(h.created).toHaveLength(1);
  });

  it("accepts a closed late-cancellation fee", async () => {
    h.appointment = appointmentWith({
      status: "cancelled",
      sessionCompletedAt: new Date(),
      sessionOutcome: "cancelled_late",
    });
    expect((await pay()).status).toBe(200);
  });

  it("shows the fee instead of 'cancelled' when the link is opened", async () => {
    h.appointment = appointmentWith({
      status: "cancelled",
      sessionCompletedAt: new Date(),
      sessionOutcome: "cancelled_late",
    });
    expect((await view()).status).toBe(200);
  });

  it("still refuses an appointment cancelled without a fee", async () => {
    h.appointment = appointmentWith({ status: "cancelled" });
    expect((await pay()).status).toBe(400);
    expect((await view()).status).toBe(400);
    expect(h.created).toHaveLength(0);
  });
});

describe("an abandoned payment form no longer silences reminders", () => {
  it("does not mark the session processing when the intent is merely created", async () => {
    const res = await pay();
    expect(res.status).toBe(200);
    const apt = h.appointment as { payment: Record<string, unknown> };
    expect(apt.payment.status).toBe("pending");
    expect(apt.payment.stripePaymentIntentId).toBe("pi_new_1");
  });

  it("hands back the intent already waiting instead of stacking a new one", async () => {
    h.appointment = appointmentWith({
      payment: { stripePaymentIntentId: "pi_waiting" },
    });
    h.retrieve.mockResolvedValue({
      id: "pi_waiting",
      status: "requires_payment_method",
      amount: 12000,
      payment_method_types: ["card"],
      client_secret: "secret_waiting",
    });
    const res = await pay();
    expect(res.body.paymentIntentId).toBe("pi_waiting");
    expect(res.body.clientSecret).toBe("secret_waiting");
    expect(h.created).toHaveLength(0);
  });

  it("creates a fresh intent when the waiting one is for another amount", async () => {
    h.appointment = appointmentWith({
      payment: { stripePaymentIntentId: "pi_old" },
    });
    h.retrieve.mockResolvedValue({
      id: "pi_old",
      status: "requires_payment_method",
      amount: 9000,
      payment_method_types: ["card"],
    });
    await pay();
    expect(h.created).toHaveLength(1);
  });

  it("heals a row stuck at processing when Stripe shows nothing in flight", async () => {
    h.appointment = appointmentWith({
      payment: { status: "processing", stripePaymentIntentId: "pi_abandoned" },
    });
    h.retrieve.mockResolvedValue({
      id: "pi_abandoned",
      status: "requires_payment_method",
      amount: 12000,
      payment_method_types: ["card"],
      client_secret: "secret_abandoned",
    });
    const res = await pay();
    expect(res.status).toBe(200);
    // Reset is conditional on the row still being processing with that intent.
    expect(h.updateOne).toHaveBeenCalledWith(
      {
        _id: "apt-1",
        "payment.status": "processing",
        "payment.stripePaymentIntentId": "pi_abandoned",
      },
      { $set: { "payment.status": "pending" } },
    );
  });

  it("refuses a second payment while a bank debit is really clearing (409)", async () => {
    h.appointment = appointmentWith({
      payment: { status: "processing", stripePaymentIntentId: "pi_debit" },
    });
    h.retrieve.mockResolvedValue({ id: "pi_debit", status: "processing" });
    const res = await pay("direct_debit");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PAYMENT_IN_PROGRESS");
    expect(h.updateOne).not.toHaveBeenCalled();
    expect(h.created).toHaveLength(0);
  });

  it("does not reset anything when Stripe cannot be reached", async () => {
    h.appointment = appointmentWith({
      payment: { status: "processing", stripePaymentIntentId: "pi_x" },
    });
    h.retrieve.mockRejectedValue(new Error("network down"));
    const res = await pay();
    expect(res.status).toBe(500);
    expect(h.updateOne).not.toHaveBeenCalled();
  });
});

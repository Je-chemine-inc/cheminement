import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/payments/guest/confirm — the only place a guest payment becomes
 * `processing`, and only once Stripe itself reports it in flight.
 */

const h = vi.hoisted(() => ({
  appointment: null as Record<string, unknown> | null,
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
vi.mock("@/lib/stripe", () => ({ stripe: { paymentIntents: { retrieve: h.retrieve } } }));
vi.mock("@/models/Appointment", () => ({
  default: {
    findOne: vi.fn(() => ({ select: async () => h.appointment })),
    updateOne: h.updateOne,
  },
}));

import { POST } from "@/app/api/payments/guest/confirm/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;
const confirm = (body: unknown): Res =>
  POST({ json: async () => body } as never) as unknown as Res;

beforeEach(() => {
  h.retrieve.mockReset();
  h.updateOne.mockClear();
  h.appointment = {
    _id: "apt-1",
    payment: { stripePaymentIntentId: "pi_1", status: "pending" },
  };
});

describe("POST /api/payments/guest/confirm", () => {
  it("marks a bank debit processing once Stripe says it is in flight", async () => {
    h.retrieve.mockResolvedValue({
      id: "pi_1",
      status: "processing",
      metadata: { appointmentId: "apt-1" },
    });
    const res = await confirm({ token: "tok", paymentIntentId: "pi_1" });
    expect(res.status).toBe(200);
    expect(h.updateOne).toHaveBeenCalledWith(
      {
        _id: "apt-1",
        "payment.stripePaymentIntentId": "pi_1",
        "payment.status": { $in: ["pending", "failed", "overdue"] },
      },
      { $set: { "payment.status": "processing" } },
    );
  });

  it("leaves a succeeded card payment to the webhook", async () => {
    h.retrieve.mockResolvedValue({
      id: "pi_1",
      status: "succeeded",
      metadata: { appointmentId: "apt-1" },
    });
    const res = await confirm({ token: "tok", paymentIntentId: "pi_1" });
    expect(res.body.status).toBe("succeeded");
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("changes nothing for a payment still waiting on the payer", async () => {
    h.retrieve.mockResolvedValue({
      id: "pi_1",
      status: "requires_payment_method",
      metadata: { appointmentId: "apt-1" },
    });
    await confirm({ token: "tok", paymentIntentId: "pi_1" });
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("refuses an intent that is not the one stored on the appointment", async () => {
    const res = await confirm({ token: "tok", paymentIntentId: "pi_someone_else" });
    expect(res.status).toBe(409);
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it("refuses when Stripe's metadata points at another appointment", async () => {
    h.retrieve.mockResolvedValue({
      id: "pi_1",
      status: "processing",
      metadata: { appointmentId: "apt-other" },
    });
    const res = await confirm({ token: "tok", paymentIntentId: "pi_1" });
    expect(res.status).toBe(409);
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("404s on an unknown or expired link", async () => {
    h.appointment = null;
    const res = await confirm({ token: "bad", paymentIntentId: "pi_1" });
    expect(res.status).toBe(404);
  });

  it("400s without both fields", async () => {
    expect((await confirm({ token: "tok" })).status).toBe(400);
    expect((await confirm(null)).status).toBe(400);
  });
});

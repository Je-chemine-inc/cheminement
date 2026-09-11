import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec 002 phase 9 — the pay page says Stripe accepted a payment. The route
 * hands the token and the intent id to the service, which checks both with
 * the database and Stripe; nothing else from the request is used.
 */

const TOKEN = "c".repeat(64);

const h = vi.hoisted(() => ({
  allowed: true,
  confirm: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "1.2.3.4",
  rateLimit: () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/organization-invoice-card", () => ({ confirmOrganizationPaymentStarted: h.confirm }));

import Stripe from "stripe";
import { POST } from "./route";

type Res = { status: number; body: Record<string, unknown> };
const post = async (body: unknown) =>
  (await POST({ json: async () => body, headers: { get: () => null } } as never)) as unknown as Res;

beforeEach(() => {
  h.allowed = true;
  h.confirm.mockReset();
});

describe("POST /api/organization-invoices/pay/confirm", () => {
  it("passes the token and the intent on, and answers with Stripe's status only", async () => {
    h.confirm.mockResolvedValue({ ok: true, status: "processing" });
    const res = await post({ token: TOKEN, paymentIntentId: "pi_123", status: "succeeded", amount: 1 });
    expect(h.confirm).toHaveBeenCalledWith(TOKEN, "pi_123");
    expect(res).toEqual({ status: 200, body: { status: "processing", verification: null } });
  });

  it("relays a microdeposit verification", async () => {
    const verification = { url: "https://payments.stripe.com/microdeposit/x", arrivalDate: null };
    h.confirm.mockResolvedValue({ ok: true, status: "requires_action", verification });
    expect((await post({ token: TOKEN, paymentIntentId: "pi_123" })).body).toEqual({
      status: "requires_action",
      verification,
    });
  });

  it("an intent that is not this invoice's is a 404", async () => {
    h.confirm.mockResolvedValue({ ok: false, status: 404, code: "NOT_FOUND", error: "Payment not found" });
    const res = await post({ token: TOKEN, paymentIntentId: "pi_other" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("a Stripe outage is a 502 that says nothing of Stripe's message", async () => {
    h.confirm.mockRejectedValue(
      new Stripe.errors.StripeAPIError({ message: "internal detail", type: "api_error" } as never),
    );
    const res = await post({ token: TOKEN, paymentIntentId: "pi_123" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("internal detail");
  });

  it("floods are cut off before anything is looked up", async () => {
    h.allowed = false;
    expect((await post({ token: TOKEN, paymentIntentId: "pi_123" })).status).toBe(429);
    expect(h.confirm).not.toHaveBeenCalled();
  });
});

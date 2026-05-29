/**
 * C2 regression (money guard): the off-session closure charge must pass a
 * per-request Stripe idempotency key so a double-click / retry / concurrent
 * closure returns the SAME PaymentIntent instead of charging the saved card
 * twice. The key is derived from appointment + amount + method.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/stripe", () => ({
  stripe: { paymentIntents: { create: h.create } },
  toCents: (n: number) => Math.round(n * 100),
}));
vi.mock("@/lib/field-encryption", () => ({
  decryptPaymentMethodReference: () => "pm_test_123",
}));

import { chargeSavedPaymentMethodAfterSession } from "@/lib/stripe-off-session-charge";

type CreateOptions = { idempotencyKey?: string };
type CreateParams = { payment_method_types?: string[] };
const optionsOf = (callIndex: number): CreateOptions =>
  (h.create.mock.calls[callIndex]?.[1] ?? {}) as CreateOptions;
const paramsOf = (callIndex: number): CreateParams =>
  (h.create.mock.calls[callIndex]?.[0] ?? {}) as CreateParams;

const baseArgs = {
  appointmentId: "appt123",
  customerId: "cus_1",
  encryptedPaymentMethodId: "enc",
  amountCad: 120,
  method: "card" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.create.mockResolvedValue({ id: "pi_1", status: "succeeded" });
});

describe("chargeSavedPaymentMethodAfterSession — idempotency (C2)", () => {
  it("passes an idempotency key derived from appointment + amount + method", async () => {
    await chargeSavedPaymentMethodAfterSession(baseArgs);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(optionsOf(0).idempotencyKey).toBe("apt-charge-appt123-12000-card");
  });

  it("reuses the SAME key on a retry of the same charge (Stripe de-dupes)", async () => {
    await chargeSavedPaymentMethodAfterSession(baseArgs);
    await chargeSavedPaymentMethodAfterSession(baseArgs);
    expect(optionsOf(0).idempotencyKey).toBe(optionsOf(1).idempotencyKey);
  });

  it("uses a DIFFERENT key for a different amount", async () => {
    await chargeSavedPaymentMethodAfterSession(baseArgs);
    await chargeSavedPaymentMethodAfterSession({ ...baseArgs, amountCad: 80 });
    expect(optionsOf(0).idempotencyKey).not.toBe(optionsOf(1).idempotencyKey);
  });

  it("keys direct_debit separately and charges via acss_debit", async () => {
    await chargeSavedPaymentMethodAfterSession({
      ...baseArgs,
      appointmentId: "appt9",
      amountCad: 50,
      method: "direct_debit",
    });
    expect(paramsOf(0).payment_method_types).toEqual(["acss_debit"]);
    expect(optionsOf(0).idempotencyKey).toBe("apt-charge-appt9-5000-direct_debit");
  });

  it("returns settled=true on a succeeded charge", async () => {
    h.create.mockResolvedValueOnce({ id: "pi_ok", status: "succeeded" });
    const res = await chargeSavedPaymentMethodAfterSession(baseArgs);
    expect(res).toEqual({ paymentIntentId: "pi_ok", settled: true });
  });

  it("M1: treats ACSS 'processing' as pending-settlement (settled=false, no throw)", async () => {
    h.create.mockResolvedValueOnce({ id: "pi_proc", status: "processing" });
    const res = await chargeSavedPaymentMethodAfterSession({
      ...baseArgs,
      method: "direct_debit",
    });
    expect(res).toEqual({ paymentIntentId: "pi_proc", settled: false });
  });

  it("still throws on a genuine failure status", async () => {
    h.create.mockResolvedValueOnce({ id: "pi_bad", status: "requires_action" });
    await expect(chargeSavedPaymentMethodAfterSession(baseArgs)).rejects.toThrow();
  });
});

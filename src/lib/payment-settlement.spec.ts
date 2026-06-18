/**
 * H2: settleInteracPayment must flip BOTH the appointment payment AND the
 * linked (pending_transfer) client receipt so an Interac-confirmed session is
 * no longer hidden from the client.
 * H3: voidReceiptForRefund must void the receipt so a refunded payment no
 * longer surfaces a valid paid receipt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const receiptUpdate = vi.fn().mockResolvedValue(null);
  const issueFiscalReceipt = vi.fn().mockResolvedValue(undefined);
  const store: { appointment: Record<string, unknown> | null } = {
    appointment: null,
  };
  return { receiptUpdate, issueFiscalReceipt, store };
});

vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/Appointment", () => ({
  default: { findById: () => Promise.resolve(h.store.appointment) },
}));
vi.mock("@/models/ClientReceipt", () => ({
  default: { findOneAndUpdate: h.receiptUpdate },
}));
// Mock the receipt-issuance side effect so the test doesn't pull in the
// server-only PDF/notifications chain; its behavior is covered separately.
vi.mock("@/lib/session-post-closure", () => ({
  issueFiscalReceipt: h.issueFiscalReceipt,
}));

import {
  settleInteracPayment,
  voidReceiptForRefund,
} from "@/lib/payment-settlement";

beforeEach(() => {
  vi.clearAllMocks();
  h.store.appointment = {
    payment: { status: "pending" },
    save: vi.fn().mockResolvedValue(undefined),
  };
});

describe("settleInteracPayment (H2)", () => {
  it("flips appointment to paid AND reveals the pending_transfer receipt", async () => {
    const res = await settleInteracPayment("a1");
    expect(res.found).toBe(true);
    expect(res.alreadyPaid).toBe(false);
    const payment = h.store.appointment!.payment as Record<string, unknown>;
    expect(payment.status).toBe("paid");
    expect(payment.method).toBe("transfer");
    expect(
      (h.store.appointment!.save as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledTimes(1);
    expect(h.receiptUpdate).toHaveBeenCalledWith(
      { appointmentId: "a1", status: "pending_transfer" },
      { $set: { status: "paid" } },
    );
    // Golden rule: the confirmed transfer issues + sends the official receipt.
    expect(h.issueFiscalReceipt).toHaveBeenCalledWith("a1");
  });

  it("is idempotent when already paid (no save) but still reveals the receipt", async () => {
    (h.store.appointment!.payment as Record<string, unknown>).status = "paid";
    const res = await settleInteracPayment("a1");
    expect(res.alreadyPaid).toBe(true);
    expect(
      (h.store.appointment!.save as ReturnType<typeof vi.fn>),
    ).not.toHaveBeenCalled();
    expect(h.receiptUpdate).toHaveBeenCalled();
  });

  it("returns found:false for a missing appointment", async () => {
    h.store.appointment = null;
    const res = await settleInteracPayment("missing");
    expect(res.found).toBe(false);
    expect(h.receiptUpdate).not.toHaveBeenCalled();
  });
});

describe("voidReceiptForRefund (H3)", () => {
  it("voids the matching client receipt", async () => {
    await voidReceiptForRefund("a1");
    expect(h.receiptUpdate).toHaveBeenCalledWith(
      { appointmentId: "a1", status: { $ne: "refunded" } },
      { $set: { status: "refunded" } },
    );
  });
});

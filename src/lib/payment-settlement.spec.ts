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
  const ledgerUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const store: { appointment: Record<string, unknown> | null } = {
    appointment: null,
  };
  return { receiptUpdate, issueFiscalReceipt, ledgerUpdate, store };
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
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: { updateOne: h.ledgerUpdate },
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

  it("never marks a covered session paid — the client owes nothing (spec 002)", async () => {
    (h.store.appointment!.payment as Record<string, unknown>).status = "covered";
    const res = await settleInteracPayment("a1");
    expect(res).toMatchObject({ found: true, alreadyPaid: false, nothingOwed: true });
    expect((h.store.appointment!.payment as Record<string, unknown>).status).toBe("covered");
    expect(h.store.appointment!.save as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(h.issueFiscalReceipt).not.toHaveBeenCalled();
    expect(h.receiptUpdate).not.toHaveBeenCalled();
  });

  it("returns found:false for a missing appointment", async () => {
    h.store.appointment = null;
    const res = await settleInteracPayment("missing");
    expect(res.found).toBe(false);
    expect(h.receiptUpdate).not.toHaveBeenCalled();
  });
});

/**
 * A session still labelled "card" (the model's default) and then paid by
 * Interac — or marked paid by an admin — kept saying card: the official
 * receipt read « Carte (Stripe) », the professional's line said "stripe", and
 * the Connect auto-payout (card/PAD only) would pay out money that never
 * reached Stripe.
 */
describe("money confirmed outside Stripe is recorded as Interac", () => {
  const payment = () => h.store.appointment!.payment as Record<string, unknown>;

  it("a card-labelled session becomes Interac, and so does its ledger line", async () => {
    h.store.appointment = {
      _id: "a1",
      payment: { status: "pending", method: "card" },
      save: vi.fn().mockResolvedValue(undefined),
    };
    await settleInteracPayment("a1");
    expect(payment().status).toBe("paid");
    expect(payment().method).toBe("transfer");
    expect(h.ledgerUpdate).toHaveBeenCalledWith(
      { appointmentId: "a1", entryKind: "credit", paymentChannel: "stripe" },
      { $set: { paymentChannel: "transfer" } },
    );
    // Relabelled BEFORE the receipt is issued, so the receipt says Interac.
    const saveOrder = (h.store.appointment!.save as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(h.issueFiscalReceipt.mock.invocationCallOrder[0]);
  });

  it("an overdue card-labelled session too", async () => {
    h.store.appointment = { _id: "a1", payment: { status: "overdue", method: "card" }, save: vi.fn() };
    await settleInteracPayment("a1");
    expect(payment().method).toBe("transfer");
  });

  it("a PAD debit already settling on Stripe keeps its label", async () => {
    h.store.appointment = { _id: "a1", payment: { status: "processing", method: "direct_debit" }, save: vi.fn() };
    await settleInteracPayment("a1");
    expect(payment().status).toBe("paid");
    expect(payment().method).toBe("direct_debit");
    expect(h.ledgerUpdate).not.toHaveBeenCalled();
  });

  it("a manual payment stays manual; an Interac session needs no change", async () => {
    h.store.appointment = { _id: "a1", payment: { status: "pending", method: "manual" }, save: vi.fn() };
    await settleInteracPayment("a1");
    expect(payment().method).toBe("manual");
    h.store.appointment = { _id: "a2", payment: { status: "pending", method: "transfer" }, save: vi.fn() };
    await settleInteracPayment("a2");
    expect(payment().method).toBe("transfer");
    expect(h.ledgerUpdate).not.toHaveBeenCalled();
  });

  it("an already-paid session is not relabelled", async () => {
    h.store.appointment = { _id: "a1", payment: { status: "paid", method: "card" }, save: vi.fn() };
    await settleInteracPayment("a1", { note: "virement vu" });
    expect(payment().method).toBe("card");
    expect(h.ledgerUpdate).not.toHaveBeenCalled();
  });

  it("a ledger write that fails does not undo the payment", async () => {
    h.store.appointment = { _id: "a1", payment: { status: "pending", method: "card" }, save: vi.fn() };
    h.ledgerUpdate.mockRejectedValueOnce(new Error("db down"));
    const res = await settleInteracPayment("a1");
    expect(res.found).toBe(true);
    expect(payment().status).toBe("paid");
    expect(h.issueFiscalReceipt).toHaveBeenCalledWith("a1");
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

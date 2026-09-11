import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import {
  computeInvoiceMoney,
  explainedAdminRefundCents,
  needsOwedChoice,
  overpaidPartCents,
  refundabilityOf,
  refundCreditCents,
} from "@/lib/organization-invoice-money";

/**
 * Refunding an organization — the rules. For each refund the admin says
 * whether the money is still owed (the balance comes back) or no longer owed
 * (a credit). Refunding an overpayment only brings the balance back to 0.
 */

const P1 = new mongoose.Types.ObjectId();
const refund = (over: Record<string, unknown> = {}) => ({
  paymentId: P1,
  amountCents: 5000,
  creditCents: 0,
  via: "stripe" as const,
  status: "succeeded" as const,
  ...over,
});

describe("computeInvoiceMoney — balance = total − credited − paid", () => {
  it("paid is what came in less what went back; credits come off what is owed", () => {
    expect(
      computeInvoiceMoney({
        totalCents: 18000,
        payments: [{ amountCents: 18000, refundedCents: 5000, source: "stripe" }],
        refunds: [refund({ creditCents: 5000 })],
      }),
    ).toEqual({ paidCents: 13000, creditedCents: 5000, balanceCents: 0 });
  });

  it("a failed refund's credit does not count; an unconfirmed one does", () => {
    const base = { totalCents: 18000, payments: [{ amountCents: 18000, source: "stripe" }] };
    expect(computeInvoiceMoney({ ...base, refunds: [refund({ creditCents: 5000, status: "failed" })] }).creditedCents).toBe(0);
    expect(computeInvoiceMoney({ ...base, refunds: [refund({ creditCents: 5000, status: "requested" })] }).creditedCents).toBe(5000);
  });
});

describe("the owed / credit split", () => {
  it("only the part beyond an overpayment needs a choice", () => {
    // Paid 150 on an invoice of 120: 30 overpaid.
    expect(overpaidPartCents(3000, -3000)).toBe(3000);
    expect(overpaidPartCents(5000, -3000)).toBe(3000);
    expect(needsOwedChoice({ amountCents: 3000, balanceBeforeCents: -3000, invoiceStatus: "paid" })).toBe(false);
    expect(needsOwedChoice({ amountCents: 5000, balanceBeforeCents: -3000, invoiceStatus: "paid" })).toBe(true);
    expect(needsOwedChoice({ amountCents: 5000, balanceBeforeCents: 0, invoiceStatus: "paid" })).toBe(true);
  });

  it("« plus dû » credits only the part beyond the overpayment — the balance never goes below 0", () => {
    expect(refundCreditCents({ amountCents: 5000, balanceBeforeCents: -3000, owed: "no_longer", invoiceStatus: "paid" })).toBe(2000);
    expect(refundCreditCents({ amountCents: 5000, balanceBeforeCents: 0, owed: "no_longer", invoiceStatus: "paid" })).toBe(5000);
    // Partly paid (40 still owed): refunding 20 as no longer owed takes 20 off.
    expect(refundCreditCents({ amountCents: 2000, balanceBeforeCents: 4000, owed: "no_longer", invoiceStatus: "partially_paid" })).toBe(2000);
  });

  it("« toujours dû », an overpayment, or a void invoice credit nothing", () => {
    expect(refundCreditCents({ amountCents: 5000, balanceBeforeCents: 0, owed: "still", invoiceStatus: "paid" })).toBe(0);
    expect(refundCreditCents({ amountCents: 3000, balanceBeforeCents: -3000, owed: null, invoiceStatus: "paid" })).toBe(0);
    expect(refundCreditCents({ amountCents: 5000, balanceBeforeCents: 0, owed: "no_longer", invoiceStatus: "void" })).toBe(0);
    expect(needsOwedChoice({ amountCents: 5000, balanceBeforeCents: 0, invoiceStatus: "void" })).toBe(false);
  });

  it("each choice lands where the admin was told: still owed +amount, no longer owed unchanged", () => {
    // Paid 180 of 180, refund 50.
    const still = computeInvoiceMoney({
      totalCents: 18000,
      payments: [{ amountCents: 18000, refundedCents: 5000, source: "stripe" }],
      refunds: [refund({ creditCents: 0 })],
    });
    expect(still.balanceCents).toBe(5000);
    const noLonger = computeInvoiceMoney({
      totalCents: 18000,
      payments: [{ amountCents: 18000, refundedCents: 5000, source: "stripe" }],
      refunds: [refund({ creditCents: refundCreditCents({ amountCents: 5000, balanceBeforeCents: 0, owed: "no_longer", invoiceStatus: "paid" }) })],
    });
    expect(noLonger.balanceCents).toBe(0);
  });
});

describe("explainedAdminRefundCents — what the screen asked Stripe for", () => {
  it("counts the screen's Stripe refunds for that payment that did not fail", () => {
    const other = new mongoose.Types.ObjectId();
    expect(
      explainedAdminRefundCents(
        [
          refund({ amountCents: 3000 }),
          refund({ amountCents: 1000, status: "requested" }),
          refund({ amountCents: 9000, status: "failed" }),
          refund({ amountCents: 7000, via: "outside" }),
          refund({ amountCents: 2000, paymentId: other }),
        ],
        P1,
      ),
    ).toBe(4000);
  });
});

describe("refundabilityOf — what can be refunded, and what stands in the way", () => {
  const inv = (over: Record<string, unknown> = {}) => ({ status: "paid", disputed: false, refunds: [], ...over });
  const payment = (over: Record<string, unknown> = {}) => ({ paymentId: P1, amountCents: 18000, refundedCents: 5000, source: "stripe", ...over });

  it("what is left of the payment, through Stripe for a card, by hand otherwise", () => {
    expect(refundabilityOf(inv(), payment())).toEqual({ refundableCents: 13000, via: "stripe", blocked: null });
    expect(refundabilityOf(inv(), payment({ source: "admin" })).via).toBe("outside");
    expect(refundabilityOf(inv(), payment({ source: "interac_reconciler" })).via).toBe("outside");
  });

  it("blocked: no id, a chargeback, another refund unconfirmed, nothing left, a draft", () => {
    expect(refundabilityOf(inv(), payment({ paymentId: undefined })).blocked).toBe("NO_ID");
    expect(refundabilityOf(inv({ disputed: true }), payment()).blocked).toBe("DISPUTED");
    expect(refundabilityOf(inv({ refunds: [refund({ status: "requested" })] }), payment()).blocked).toBe("IN_PROGRESS");
    expect(refundabilityOf(inv(), payment({ refundedCents: 18000 })).blocked).toBe("NOT_REFUNDABLE");
    expect(refundabilityOf(inv({ status: "draft" }), payment()).blocked).toBe("NOT_REFUNDABLE");
  });

  it("money kept on a void invoice can go back", () => {
    expect(refundabilityOf(inv({ status: "void" }), payment()).blocked).toBeNull();
  });
});

/**
 * The schemas are strict: a field missing from them is dropped silently. And
 * a payment row gets its id where it is written — never from a default, which
 * would invent a new one each time an old row is loaded.
 */
describe("the invoice model keeps what refunds write", () => {
  it("refund rows, credits and payment ids survive; no id is invented", () => {
    const refundId = new mongoose.Types.ObjectId();
    const doc = new OrganizationInvoice({
      kind: "session",
      organizationId: new mongoose.Types.ObjectId(),
      draftKey: "session:r",
      creditedCents: 2000,
      payments: [
        { paymentId: P1, amountCents: 18000, method: "card", receivedAt: new Date(), source: "stripe", refundedCents: 5000 },
        { amountCents: 100, method: "cheque", receivedAt: new Date(), source: "admin" },
      ],
      refunds: [
        {
          refundId,
          paymentId: P1,
          amountCents: 5000,
          creditCents: 2000,
          owed: "no_longer",
          via: "stripe",
          reason: "Séance annulée",
          status: "pending",
          requestKey: "abcdefgh",
          stripeRefundId: "re_1",
          refundedAt: new Date(),
          at: new Date(),
          byUserId: new mongoose.Types.ObjectId(),
        },
      ],
      sendLog: [{ at: new Date(), to: ["a@b.ca"], kind: "refund_notice" }],
    });
    expect(doc.validateSync()).toBeUndefined();
    const o = doc.toObject();
    expect(o.creditedCents).toBe(2000);
    expect(String(o.payments[0].paymentId)).toBe(String(P1));
    expect(o.payments[1].paymentId).toBeUndefined();
    expect(o.refunds[0]).toMatchObject({ creditCents: 2000, owed: "no_longer", status: "pending", requestKey: "abcdefgh", stripeRefundId: "re_1" });
    expect(o.sendLog[0].kind).toBe("refund_notice");
  });
});

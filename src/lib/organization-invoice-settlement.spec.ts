import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

/**
 * Spec 002 phase 5 — money received from an organization. Recorded once per
 * external reference; an admin can never overpay or pay a void invoice, but
 * money already in the account is always recorded and handed to a person;
 * status follows the balance through conditional writes.
 */

const INV = new mongoose.Types.ObjectId("0123456789abcdef0123456e");
const ORG = new mongoose.Types.ObjectId("0123456789abcdef01234567");
const ADMIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-10-15T15:00:00Z");

type Doc = Record<string, unknown>;

const h = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  statusAfter: "paid",
  byIntent: null as Record<string, unknown> | null,
  written: null as Record<string, unknown> | null,
  fou: vi.fn(),
  invUpdateOne: vi.fn(),
  aptUpdateMany: vi.fn(async () => ({ modifiedCount: 0 })),
  receipt: vi.fn(async () => true),
  review: vi.fn(async () => true),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/Appointment", () => ({ default: { updateMany: h.aptUpdateMany } }));
vi.mock("@/models/Organization", () => ({
  default: {
    findById: () => ({
      select: () => ({
        lean: async () => ({ _id: ORG, name: "PAE Desjardins", language: "fr", billingEmails: ["factu@pae.ca"] }),
      }),
    }),
  },
}));
vi.mock("@/models/OrganizationInvoice", () => {
  const chain = (get: () => unknown) => {
    const p = Promise.resolve().then(get);
    return Object.assign(p, { lean: async () => get(), select: () => ({ lean: async () => get() }) });
  };
  return {
    default: {
      // After the writes, syncInvoiceStatus reads the status back.
      findById: () => chain(() => (h.invoice ? { ...h.invoice, status: h.written ? h.statusAfter : h.invoice.status } : null)),
      findOne: () => chain(() => h.byIntent),
      findOneAndUpdate: (filter: unknown, update: unknown, opts: unknown) => {
        const result = h.fou(filter, update, opts) as Doc | null;
        h.written = result;
        const doc = result ? { ...result, toObject: () => ({ ...result }) } : null;
        return Object.assign(Promise.resolve(doc), { lean: async () => (result ? { ...result } : null) });
      },
      updateOne: h.invUpdateOne,
    },
  };
});
vi.mock("@/lib/notifications", () => ({
  sendOrganizationPaymentReceivedEmail: h.receipt,
  sendAdminOrganizationPaymentReview: h.review,
}));

import {
  flagOrganizationInvoiceDispute,
  recordOrganizationPayment,
  recordOrganizationStripeRefund,
  recordReceivedOrganizationMoney,
  settleOrganizationInvoiceIntent,
  syncInvoiceStatus,
} from "@/lib/organization-invoice-settlement";

const sent = (over: Doc = {}): Doc => ({
  _id: INV,
  organizationId: ORG,
  number: "JCO-2026-000007",
  status: "sent",
  totalCents: 18000,
  paidCents: 0,
  balanceCents: 18000,
  payments: [],
  payToken: "f".repeat(64),
  billTo: { name: "PAE Desjardins", emails: ["factu@pae.ca", "rh@pae.ca"] },
  ...over,
});

/** What the invoice looks like once `amount` has landed on it. */
const after = (inv: Doc, amount: number): Doc => ({
  ...inv,
  paidCents: (inv.paidCents as number) + amount,
  balanceCents: (inv.balanceCents as number) - amount,
});

const updatesOf = () => h.invUpdateOne.mock.calls as unknown as Array<[Doc, Doc]>;
const pushedEvents = () =>
  updatesOf()
    .map(([, u]) => (u.$push as Doc | undefined)?.paymentEvents)
    .filter(Boolean) as Doc[];

beforeEach(() => {
  h.invoice = sent();
  h.statusAfter = "paid";
  h.byIntent = null;
  h.written = null;
  h.fou.mockReset();
  h.fou.mockImplementation((_f: Doc, u: { $inc: { paidCents: number } }) => after(h.invoice!, u.$inc.paidCents));
  h.invUpdateOne.mockReset();
  h.invUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  h.aptUpdateMany.mockClear();
  h.receipt.mockClear();
  h.review.mockClear();
});

describe("syncInvoiceStatus", () => {
  it("sets each status only while the balance still says so", async () => {
    h.written = {};
    await syncInvoiceStatus(INV, NOW);
    const filters = updatesOf().map(([f, u]) => [f, (u.$set as Doc).status]);
    expect(filters).toEqual([
      [expect.objectContaining({ paidCents: { $gt: 0 }, balanceCents: { $lte: 0 } }), "paid"],
      [expect.objectContaining({ paidCents: { $gt: 0 }, balanceCents: { $gt: 0 } }), "partially_paid"],
      [expect.objectContaining({ paidCents: { $lte: 0 } }), "refunded"],
    ]);
    // Never touches a void, draft or issuing invoice.
    expect((updatesOf()[0][0].status as { $in: string[] }).$in).not.toContain("void");
  });

  it("marks the sessions paid when the invoice is, and walks them back when it is not", async () => {
    h.written = {};
    h.statusAfter = "paid";
    await syncInvoiceStatus(INV, NOW);
    expect(h.aptUpdateMany).toHaveBeenLastCalledWith(
      { "thirdPartyBilling.orgInvoiceId": INV, "thirdPartyBilling.orgStatus": { $ne: "paid" } },
      { $set: { "thirdPartyBilling.orgStatus": "paid", "thirdPartyBilling.orgPaidAt": NOW } },
    );
    h.statusAfter = "partially_paid";
    await syncInvoiceStatus(INV, NOW);
    expect(h.aptUpdateMany).toHaveBeenLastCalledWith(
      { "thirdPartyBilling.orgInvoiceId": INV, "thirdPartyBilling.orgStatus": "paid" },
      { $set: { "thirdPartyBilling.orgStatus": "invoiced" }, $unset: { "thirdPartyBilling.orgPaidAt": 1 } },
    );
  });
});

describe("recordOrganizationPayment (an admin records a cheque, an EFT…)", () => {
  const pay = (amountCents: number, externalRef?: string) =>
    recordOrganizationPayment({
      invoiceId: String(INV),
      amountCents,
      method: "cheque",
      source: "admin",
      externalRef,
      byUserId: ADMIN,
      now: NOW,
    });

  it("never takes more than the balance", async () => {
    expect(await pay(18001)).toMatchObject({ code: "OVERPAYMENT" });
    expect(h.fou).not.toHaveBeenCalled();
  });

  it("refuses an invoice that is not awaiting payment", async () => {
    h.invoice = sent({ status: "void" });
    expect(await pay(18000)).toMatchObject({ code: "NOT_PAYABLE" });
    expect(h.fou).not.toHaveBeenCalled();
  });

  it("refuses a zero or fractional amount", async () => {
    expect(await pay(0)).toMatchObject({ code: "INVALID_AMOUNT" });
    expect(await pay(10.5)).toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("is a no-op for a payment already recorded (same external reference)", async () => {
    h.invoice = sent({ payments: [{ externalRef: "chq-1", amountCents: 18000 }] });
    expect(await pay(18000, "chq-1")).toMatchObject({ ok: true });
    expect(h.fou).not.toHaveBeenCalled();
  });

  it("writes only while the balance still covers it, then tells the organization", async () => {
    const r = await pay(9000);
    expect(r.ok).toBe(true);
    const [filter, update] = h.fou.mock.calls[0] as [Doc, { $inc: Doc; $push: { payments: Doc } }];
    expect(filter).toMatchObject({ balanceCents: { $gte: 9000 }, status: { $in: ["sent", "overdue", "partially_paid"] } });
    expect(update.$inc).toEqual({ paidCents: 9000, balanceCents: -9000 });
    expect(update.$push.payments).toMatchObject({ amountCents: 9000, method: "cheque", source: "admin" });

    expect(h.receipt).toHaveBeenCalledTimes(2);
    expect(h.receipt.mock.calls[0]).toEqual([
      expect.objectContaining({ to: "factu@pae.ca", amountCents: 9000, balanceCents: 9000, number: "JCO-2026-000007" }),
    ]);
    // A balance is still due: the receipt offers the pay link.
    expect((h.receipt.mock.calls[0] as unknown as [{ payUrl: string }])[0].payUrl).toContain("/org-pay?token=");
    const logged = updatesOf().find(([, u]) => (u.$push as Doc | undefined)?.sendLog);
    expect((logged![1].$push as { sendLog: Doc }).sendLog).toMatchObject({ kind: "payment_received", to: ["factu@pae.ca", "rh@pae.ca"] });
    expect(h.review).not.toHaveBeenCalled();
  });

  it("reports a race instead of guessing", async () => {
    h.fou.mockReturnValue(null);
    expect(await pay(9000)).toMatchObject({ code: "CHANGED_MEANWHILE" });
    expect(h.receipt).not.toHaveBeenCalled();
  });
});

describe("recordReceivedOrganizationMoney (card, Interac — already in the account)", () => {
  const receive = (amountCents: number, externalRef = "pi_1") =>
    recordReceivedOrganizationMoney({
      invoiceId: String(INV),
      amountCents,
      method: "card",
      source: "stripe",
      externalRef,
      now: NOW,
    });

  it("records it once per external reference", async () => {
    const r = await receive(18000);
    expect(r.outcome).toBe("applied");
    const [filter, update] = h.fou.mock.calls[0] as [Doc, Doc];
    expect(filter).toEqual({ _id: INV, "payments.externalRef": { $ne: "pi_1" } });
    expect(update.$inc).toEqual({ paidCents: 18000, balanceCents: -18000 });
    expect(h.receipt).toHaveBeenCalled();
    expect(h.review).not.toHaveBeenCalled();
  });

  it("a replay changes nothing and emails nobody", async () => {
    h.fou.mockReturnValue(null);
    const r = await receive(18000);
    expect(r.outcome).toBe("duplicate");
    expect(h.receipt).not.toHaveBeenCalled();
    expect(h.review).not.toHaveBeenCalled();
  });

  it("an unknown invoice is reported, not thrown", async () => {
    h.fou.mockReturnValue(null);
    h.invoice = null;
    expect((await receive(18000)).outcome).toBe("not_found");
    expect(await recordReceivedOrganizationMoney({
      invoiceId: "nope", amountCents: 100, method: "card", source: "stripe", externalRef: "pi_x",
    })).toEqual({ outcome: "not_found" });
  });

  it("an overpayment is recorded as received and handed to a person — never refunded", async () => {
    h.invoice = sent({ paidCents: 9000, balanceCents: 9000, status: "partially_paid" });
    const r = await receive(18000);
    expect(r).toMatchObject({ outcome: "needs_review", reason: "overpaid" });
    expect((h.fou.mock.calls[0][1] as Doc).$inc).toEqual({ paidCents: 18000, balanceCents: -18000 });
    expect(pushedEvents()[0]).toMatchObject({ kind: "overpaid" });
    expect(String(pushedEvents()[0].detail)).toContain("90,00 $");
    expect(h.review).toHaveBeenCalledWith(expect.objectContaining({ kind: "overpaid", invoiceNumber: "JCO-2026-000007" }));
    expect(h.receipt).toHaveBeenCalled();
  });

  it("money on a void invoice is recorded, not applied, and the organization is not thanked", async () => {
    h.invoice = sent({ status: "void" });
    const r = await receive(18000);
    expect(r).toMatchObject({ outcome: "needs_review", reason: "not_payable" });
    expect(pushedEvents()[0]).toMatchObject({ kind: "not_payable" });
    expect(h.review).toHaveBeenCalledWith(expect.objectContaining({ kind: "not_payable" }));
    expect(h.receipt).not.toHaveBeenCalled();
  });
});

describe("settleOrganizationInvoiceIntent", () => {
  it("finds the invoice from the intent and records what Stripe actually received", async () => {
    await settleOrganizationInvoiceIntent({
      id: "pi_9",
      amount: 18000,
      amount_received: 17000,
      metadata: { type: "organization_invoice", organizationInvoiceId: String(INV) },
    });
    const [filter, update] = h.fou.mock.calls[0] as [Doc, { $push: { payments: Doc } }];
    expect(filter).toMatchObject({ "payments.externalRef": { $ne: "pi_9" } });
    expect(update.$push.payments).toMatchObject({ amountCents: 17000, method: "card", source: "stripe", externalRef: "pi_9" });
  });

  it("falls back to the stored intent id, and gives up quietly when nothing matches", async () => {
    h.byIntent = null;
    expect(await settleOrganizationInvoiceIntent({ id: "pi_lost", amount: 100, metadata: {} })).toEqual({
      outcome: "not_found",
    });
    expect(h.fou).not.toHaveBeenCalled();
  });
});

describe("refunds and chargebacks on a card payment", () => {
  beforeEach(() => {
    h.byIntent = sent({
      status: "paid",
      paidCents: 18000,
      balanceCents: 0,
      payments: [{ externalRef: "pi_1", amountCents: 18000, refundedCents: 0 }],
    });
  });

  it("a refund only ever grows the refunded amount, then recomputes paid and balance in one write", async () => {
    expect(await recordOrganizationStripeRefund({ paymentIntentId: "pi_1", refundedCents: 5000, now: NOW })).toBe("recorded");
    const [first, second] = updatesOf();
    expect(first[0]).toEqual({ _id: INV, "payments.externalRef": "pi_1" });
    expect(first[1]).toEqual({ $max: { "payments.$.refundedCents": 5000 } });
    expect(Array.isArray(second[1])).toBe(true);
    expect(JSON.stringify(second[1])).toContain("$$p.refundedCents");
    expect(pushedEvents()[0]).toMatchObject({ kind: "refund" });
  });

  it("an old event delivered late cannot undo a newer refund", async () => {
    h.byIntent = sent({ payments: [{ externalRef: "pi_1", amountCents: 18000, refundedCents: 9000 }] });
    expect(await recordOrganizationStripeRefund({ paymentIntentId: "pi_1", refundedCents: 5000 })).toBe("unchanged");
    expect(h.invUpdateOne).not.toHaveBeenCalled();
  });

  it("a failed refund sets the amount as Stripe now has it", async () => {
    h.byIntent = sent({ payments: [{ externalRef: "pi_1", amountCents: 18000, refundedCents: 9000 }] });
    expect(await recordOrganizationStripeRefund({ paymentIntentId: "pi_1", refundedCents: 0, exact: true })).toBe("recorded");
    expect(updatesOf()[0][1]).toEqual({ $set: { "payments.$.refundedCents": 0 } });
  });

  it("never records more refunded than was paid", async () => {
    await recordOrganizationStripeRefund({ paymentIntentId: "pi_1", refundedCents: 99999 });
    expect(updatesOf()[0][1]).toEqual({ $max: { "payments.$.refundedCents": 18000 } });
  });

  it("ignores a payment that is not an organization's", async () => {
    h.byIntent = null;
    expect(await recordOrganizationStripeRefund({ paymentIntentId: "pi_appt", refundedCents: 100 })).toBe("not_found");
    expect(await flagOrganizationInvoiceDispute("pi_appt")).toBe("not_found");
    expect(h.invUpdateOne).not.toHaveBeenCalled();
  });

  it("a chargeback flags the invoice and tells the team", async () => {
    expect(await flagOrganizationInvoiceDispute("pi_1", NOW)).toBe("flagged");
    expect(updatesOf()[0]).toEqual([{ _id: INV }, { $set: { disputed: true } }]);
    expect(h.review).toHaveBeenCalledWith(expect.objectContaining({ kind: "dispute" }));
  });
});

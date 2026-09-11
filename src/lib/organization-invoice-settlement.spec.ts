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
  debitFailed: vi.fn(async () => true),
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
  sendOrganizationDebitFailedEmail: h.debitFailed,
}));

import {
  clearOrganizationPendingDebit,
  flagOrganizationInvoiceDispute,
  markOrganizationDebitProcessing,
  markOrganizationRefundStatus,
  organizationMethodForIntent,
  recordOrganizationDebitFailure,
  openOrganizationStripeRefund,
  recordOrganizationOutsideRefund,
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
  h.debitFailed.mockClear();
});

describe("syncInvoiceStatus", () => {
  it("sets each status only while the money still says so", async () => {
    h.written = {};
    await syncInvoiceStatus(INV, NOW);
    const filters = updatesOf().map(([f, u]) => [f, (u.$set as Doc).status]);
    expect(filters).toEqual([
      [expect.objectContaining({ paidCents: { $gt: 0 }, balanceCents: { $lte: 0 } }), "paid"],
      [expect.objectContaining({ paidCents: { $gt: 0 }, balanceCents: { $gt: 0 } }), "partially_paid"],
      // All went back and nothing is owed: closed.
      [expect.objectContaining({ paidCents: { $lte: 0 }, balanceCents: { $lte: 0 } }), "refunded"],
      // All went back and it is owed again (« toujours dû »): awaiting payment,
      // overdue once past its due date.
      [expect.objectContaining({ paidCents: { $lte: 0 }, balanceCents: { $gt: 0 }, dueAt: { $lt: NOW } }), "overdue"],
      [expect.objectContaining({ paidCents: { $lte: 0 }, balanceCents: { $gt: 0 } }), "sent"],
    ]);
    // Never touches a void, draft or issuing invoice.
    for (const [f] of updatesOf()) {
      const statuses = (f.status as { $in: string[] }).$in;
      expect(statuses).not.toContain("void");
      expect(statuses).not.toContain("draft");
      expect(statuses).not.toContain("issuing");
    }
    // Only an invoice that had money goes back to awaiting payment.
    expect((updatesOf()[4][0].status as { $in: string[] }).$in).toEqual(["partially_paid", "paid", "refunded"]);
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
      { "thirdPartyBilling.orgInvoiceId": INV, "thirdPartyBilling.orgStatus": { $in: ["paid", "refunded"] } },
      { $set: { "thirdPartyBilling.orgStatus": "invoiced" }, $unset: { "thirdPartyBilling.orgPaidAt": 1 } },
    );
  });

  it("an invoice closed by its refunds marks its sessions refunded", async () => {
    h.written = {};
    h.statusAfter = "refunded";
    await syncInvoiceStatus(INV, NOW);
    expect(h.aptUpdateMany).toHaveBeenLastCalledWith(
      { "thirdPartyBilling.orgInvoiceId": INV, "thirdPartyBilling.orgStatus": { $in: ["paid", "invoiced"] } },
      { $set: { "thirdPartyBilling.orgStatus": "refunded" }, $unset: { "thirdPartyBilling.orgPaidAt": 1 } },
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
    expect(filter).toMatchObject({
      balanceCents: { $gte: 9000 },
      status: { $in: ["sent", "overdue", "partially_paid"] },
      // A debit that started since the read: the cheque would be paid twice.
      "pendingDebit.paymentIntentId": { $exists: false },
    });
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

  it("refuses while the organization's bank debit is on its way — it would be paid twice", async () => {
    h.invoice = sent({ pendingDebit: { paymentIntentId: "pi_debit", amountCents: 18000, since: NOW } });
    expect(await pay(9000)).toMatchObject({ code: "DEBIT_PENDING" });
    expect(h.fou).not.toHaveBeenCalled();
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
    // Nothing to clear either.
    expect(h.invUpdateOne).not.toHaveBeenCalled();
  });
});

/**
 * Phase 9 — the organization pays by pre-authorized bank debit (ACSS): the
 * debit is « en cours » for about 5 business days, then clears or bounces.
 */
describe("a bank debit from the pay link", () => {
  const PENDING = { paymentIntentId: "pi_debit", amountCents: 18000, since: NOW };
  const debit = (over: Doc = {}) => ({
    id: "pi_debit",
    amount: 18000,
    amount_received: 18000,
    payment_method_types: ["acss_debit"],
    metadata: { type: "organization_invoice", organizationInvoiceId: String(INV), method: "pad" },
    ...over,
  });
  const card = (over: Doc = {}) => debit({ payment_method_types: ["card"], metadata: { type: "organization_invoice", organizationInvoiceId: String(INV), method: "card" }, ...over });
  const CLEAR: [Doc, Doc] = [{ "pendingDebit.paymentIntentId": "pi_debit" }, { $unset: { pendingDebit: 1 } }];

  it("the method is read from the intent, never assumed", () => {
    expect(organizationMethodForIntent({ payment_method_types: ["acss_debit"] })).toBe("pad");
    expect(organizationMethodForIntent({ metadata: { method: "pad" } })).toBe("pad");
    expect(organizationMethodForIntent({ payment_method_types: ["card"], metadata: {} })).toBe("card");
    // An intent from before the switch carried no method: it was a card.
    expect(organizationMethodForIntent({})).toBe("card");
  });

  it("a debit that cleared is recorded as a bank debit, and its marker goes", async () => {
    h.invoice = sent({ pendingDebit: PENDING });
    const r = await settleOrganizationInvoiceIntent(debit());
    expect(r.outcome).toBe("applied");
    const [, update] = h.fou.mock.calls[0] as [Doc, { $push: { payments: Doc } }];
    expect(update.$push.payments).toMatchObject({ amountCents: 18000, method: "pad", source: "stripe", externalRef: "pi_debit" });
    expect(updatesOf()).toContainEqual(CLEAR);
    expect(h.receipt).toHaveBeenCalled();
  });

  it("a replay still clears the marker — a crash between the two writes heals itself", async () => {
    h.fou.mockReturnValue(null);
    const r = await settleOrganizationInvoiceIntent(debit());
    expect(r.outcome).toBe("duplicate");
    expect(updatesOf()).toContainEqual(CLEAR);
    expect(h.receipt).not.toHaveBeenCalled();
  });

  it("clearing only ever takes away that intent's own marker", async () => {
    await clearOrganizationPendingDebit("pi_debit");
    expect(updatesOf()).toEqual([CLEAR]);
  });

  describe("markOrganizationDebitProcessing", () => {
    it("marks it on its way — unless already recorded, already bounced, or another debit is pending", async () => {
      expect(await markOrganizationDebitProcessing(debit(), NOW)).toBe("marked");
      expect(updatesOf()).toEqual([
        [
          {
            _id: INV,
            "payments.externalRef": { $ne: "pi_debit" },
            "pendingDebit.paymentIntentId": { $exists: false },
            paymentEvents: { $not: { $elemMatch: { kind: "debit_failed", ref: "pi_debit" } } },
          },
          { $set: { pendingDebit: { paymentIntentId: "pi_debit", amountCents: 18000, since: NOW } } },
        ],
      ]);
    });

    it("says so when nothing was marked", async () => {
      h.invUpdateOne.mockResolvedValue({ modifiedCount: 0 });
      expect(await markOrganizationDebitProcessing(debit(), NOW)).toBe("ignored");
    });

    it("a card is never « en cours »: nothing is written", async () => {
      expect(await markOrganizationDebitProcessing(card(), NOW)).toBe("ignored");
      expect(h.invUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe("recordOrganizationDebitFailure", () => {
    const bounced = (over: Doc = {}) =>
      debit({ latest_charge: "py_1", last_payment_error: { code: "insufficient_funds", message: "Insufficient funds" }, ...over });

    it("a declined card stays silent — the pay link is still usable", async () => {
      h.invoice = sent();
      expect(await recordOrganizationDebitFailure(card({ latest_charge: "ch_1" }), NOW)).toBe("ignored");
      expect(h.invUpdateOne).not.toHaveBeenCalled();
      expect(h.review).not.toHaveBeenCalled();
      expect(h.debitFailed).not.toHaveBeenCalled();
    });

    it("a bank check that failed before anything was debited is not a bounce", async () => {
      h.invoice = sent();
      expect(await recordOrganizationDebitFailure(debit({ latest_charge: null }), NOW)).toBe("ignored");
      expect(h.invUpdateOne).not.toHaveBeenCalled();
      expect(h.review).not.toHaveBeenCalled();
    });

    it("a bounce clears the marker, is recorded once, alerts the team and tells the organization it still owes", async () => {
      h.invoice = sent({ pendingDebit: PENDING });
      expect(await recordOrganizationDebitFailure(bounced(), NOW)).toBe("recorded");

      expect(updatesOf()[0]).toEqual([{ _id: INV, "pendingDebit.paymentIntentId": "pi_debit" }, { $unset: { pendingDebit: 1 } }]);
      const [eventFilter, eventUpdate] = updatesOf()[1];
      expect(eventFilter).toEqual({ _id: INV, paymentEvents: { $not: { $elemMatch: { kind: "debit_failed", ref: "pi_debit" } } } });
      const event = (eventUpdate.$push as { paymentEvents: Doc }).paymentEvents;
      expect(event).toMatchObject({ kind: "debit_failed", ref: "pi_debit" });
      expect(String(event.detail)).toContain("180,00 $");
      expect(h.review).toHaveBeenCalledWith(expect.objectContaining({ kind: "debit_failed", invoiceNumber: "JCO-2026-000007" }));

      expect(h.debitFailed).toHaveBeenCalledTimes(2);
      const mail = h.debitFailed.mock.calls[0] as unknown as [Doc];
      expect(mail[0]).toMatchObject({ to: "factu@pae.ca", number: "JCO-2026-000007", amountCents: 18000, balanceCents: 18000 });
      expect(String(mail[0].payUrl)).toContain("/org-pay?token=");
      // The bank's reason is for the team, never the organization's email.
      expect(JSON.stringify(mail[0])).not.toContain("Insufficient");
      const logged = updatesOf().find(([, u]) => (u.$push as Doc | undefined)?.sendLog);
      expect((logged![1].$push as { sendLog: Doc }).sendLog).toMatchObject({ kind: "debit_failed", to: ["factu@pae.ca", "rh@pae.ca"] });
    });

    it("the same bounce delivered again records nothing and emails nobody", async () => {
      h.invoice = sent();
      h.invUpdateOne.mockImplementation(async (_f: Doc, u: Doc) => ({
        modifiedCount: (u.$push as Doc | undefined)?.paymentEvents ? 0 : 1,
      }));
      expect(await recordOrganizationDebitFailure(bounced(), NOW)).toBe("ignored");
      expect(h.review).not.toHaveBeenCalled();
      expect(h.debitFailed).not.toHaveBeenCalled();
    });

    it("the processing event never came: a debit that took money and bounced is still recorded", async () => {
      h.invoice = sent();
      expect(await recordOrganizationDebitFailure(bounced(), NOW)).toBe("recorded");
      expect(h.review).toHaveBeenCalled();
    });

    it("paid another way meanwhile: the team is told, the organization is not asked to pay again", async () => {
      h.invoice = sent({ status: "paid", paidCents: 18000, balanceCents: 0, pendingDebit: PENDING });
      expect(await recordOrganizationDebitFailure(bounced(), NOW)).toBe("recorded");
      expect(h.review).toHaveBeenCalled();
      expect(h.debitFailed).not.toHaveBeenCalled();
    });
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

/**
 * Refunds from the invoice screen: each payment row has an id a refund can
 * name; credits (« plus dû ») are part of what is owed; the team hears only
 * about refunds it did not make there.
 */
describe("refunds from the invoice screen", () => {
  const P1 = new mongoose.Types.ObjectId("0123456789abcdef01234599");
  const adminRefund = (over: Doc = {}): Doc => ({
    refundId: new mongoose.Types.ObjectId(),
    paymentId: P1,
    amountCents: 5000,
    creditCents: 0,
    via: "stripe",
    status: "succeeded",
    requestKey: "key-1",
    ...over,
  });

  it("every payment row gets its own id, whoever records it", async () => {
    await recordOrganizationPayment({ invoiceId: String(INV), amountCents: 1000, method: "cheque", source: "admin", byUserId: ADMIN, now: NOW });
    await recordReceivedOrganizationMoney({ invoiceId: String(INV), amountCents: 1000, method: "card", source: "stripe", externalRef: "pi_z", now: NOW });
    for (const [, update] of h.fou.mock.calls as unknown as Array<[Doc, { $push: { payments: Doc } }]>) {
      expect(update.$push.payments.paymentId).toBeInstanceOf(mongoose.Types.ObjectId);
    }
  });

  it("what is owed counts credits, and a failed refund's credit does not count", async () => {
    h.byIntent = sent({ status: "paid", paidCents: 18000, balanceCents: 0, payments: [{ paymentId: P1, externalRef: "pi_1", amountCents: 18000, refundedCents: 0 }] });
    await recordOrganizationStripeRefund({ paymentIntentId: "pi_1", refundedCents: 5000, now: NOW });
    const pipeline = JSON.stringify(updatesOf()[1][1]);
    expect(pipeline).toContain("$$r.creditCents");
    expect(pipeline).toContain('"$ne":["$$r.status","failed"]');
    expect(pipeline).toContain('"$add":["$creditedCents","$paidCents"]');
  });

  it("a refund the screen made — the webhook landing first or after — alerts nobody", async () => {
    h.byIntent = sent({
      status: "paid",
      paidCents: 18000,
      balanceCents: 0,
      payments: [{ paymentId: P1, externalRef: "pi_1", amountCents: 18000, refundedCents: 0 }],
      refunds: [adminRefund({ status: "requested" })],
    });
    expect(await recordOrganizationStripeRefund({ paymentIntentId: "pi_1", refundedCents: 5000, now: NOW })).toBe("recorded");
    expect(pushedEvents()).toEqual([]);
    expect(h.review).not.toHaveBeenCalled();
  });

  it("a refund made in the Stripe dashboard alerts the team for that amount only", async () => {
    h.byIntent = sent({
      status: "paid",
      paidCents: 13000,
      balanceCents: 0,
      payments: [{ paymentId: P1, externalRef: "pi_1", amountCents: 18000, refundedCents: 5000 }],
      refunds: [adminRefund()],
    });
    await recordOrganizationStripeRefund({ paymentIntentId: "pi_1", refundedCents: 7000, now: NOW });
    expect(pushedEvents()).toHaveLength(1);
    expect(String(pushedEvents()[0].detail)).toContain("20,00 $");
    expect(String(pushedEvents()[0].detail)).toContain("hors de l’écran des factures");
  });

  it("a refund that failed always alerts the team", async () => {
    h.byIntent = sent({
      payments: [{ paymentId: P1, externalRef: "pi_1", amountCents: 18000, refundedCents: 5000 }],
      refunds: [adminRefund({ status: "failed" })],
    });
    await recordOrganizationStripeRefund({ paymentIntentId: "pi_1", refundedCents: 0, exact: true, now: NOW });
    expect(String(pushedEvents()[0].detail)).toContain("a échoué");
  });

  it("an outside refund is one conditional write, on the payment as the admin saw it", async () => {
    h.fou.mockImplementation(() => ({ ...h.invoice }));
    const row = adminRefund({ via: "outside", method: "cheque", requestKey: "key-2" });
    const r = await recordOrganizationOutsideRefund({
      invoiceId: INV,
      paymentId: P1,
      expected: { status: "paid", balanceCents: 0, refundedCents: 0 },
      row: row as never,
      now: NOW,
    });
    expect(r).toBe("recorded");
    const [filter, update, opts] = h.fou.mock.calls[0] as [Doc, Doc, Doc];
    expect(filter).toMatchObject({
      _id: INV,
      status: "paid",
      balanceCents: 0,
      payments: { $elemMatch: { paymentId: P1, source: { $ne: "stripe" }, refundedCents: { $in: [null, 0] } } },
      refunds: { $not: { $elemMatch: { status: "requested" } } },
      "refunds.requestKey": { $ne: "key-2" },
    });
    expect(update).toEqual({ $inc: { "payments.$[p].refundedCents": 5000 }, $push: { refunds: row } });
    expect(opts).toMatchObject({ arrayFilters: [{ "p.paymentId": P1 }] });
  });

  it("the same outside refund twice records once; a changed invoice records nothing", async () => {
    h.fou.mockReturnValue(null);
    const row = adminRefund({ via: "outside", requestKey: "key-3" });
    h.invoice = sent({ refunds: [row] });
    const args = { invoiceId: INV, paymentId: P1, expected: { status: "sent", balanceCents: 18000, refundedCents: 0 }, row: row as never };
    expect(await recordOrganizationOutsideRefund(args)).toBe("replay");
    h.invoice = sent({ refunds: [] });
    expect(await recordOrganizationOutsideRefund(args)).toBe("changed");
  });

  it("a Stripe refund row opens only on a Stripe payment, not disputed, with no other refund unconfirmed", async () => {
    const row = adminRefund({ status: "requested", requestKey: "key-4" });
    await openOrganizationStripeRefund({ invoiceId: INV, paymentId: P1, expected: { status: "paid", balanceCents: 0 }, row: row as never });
    const [filter, update] = updatesOf()[0];
    expect(filter).toMatchObject({
      status: "paid",
      balanceCents: 0,
      disputed: { $ne: true },
      payments: { $elemMatch: { paymentId: P1, source: "stripe" } },
      refunds: { $not: { $elemMatch: { status: "requested" } } },
      "refunds.requestKey": { $ne: "key-4" },
    });
    expect(update).toEqual({ $push: { refunds: row } });
  });

  it("a refund row moves only forward, and a failed one gives its credit back", async () => {
    const REF = new mongoose.Types.ObjectId();
    await markOrganizationRefundStatus({ invoiceId: INV, refundId: REF, status: "succeeded", stripeRefundId: "re_1" });
    const [filter, update] = updatesOf()[0];
    expect(filter).toMatchObject({ refunds: { $elemMatch: { refundId: REF, status: { $in: ["requested", "pending"] } } } });
    expect(update).toEqual({ $set: { "refunds.$[r].status": "succeeded", "refunds.$[r].stripeRefundId": "re_1" } });
    expect(updatesOf()).toHaveLength(1);

    h.invUpdateOne.mockClear();
    await markOrganizationRefundStatus({ invoiceId: INV, refundId: REF, status: "failed", failureReason: "insufficient_funds" });
    expect((updatesOf()[0][0].refunds as Doc).$elemMatch).toMatchObject({ status: { $in: ["requested", "pending", "succeeded"] } });
    // The recompute follows: the failed refund's credit no longer counts.
    expect(Array.isArray(updatesOf()[1][1])).toBe(true);
  });
});

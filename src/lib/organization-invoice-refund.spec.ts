import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";
import Stripe from "stripe";

/**
 * Refunding an organization from the invoice screen. A card is refunded
 * through Stripe: the row is written BEFORE Stripe is asked, the key comes
 * from that row, the result is recorded like the webhook would. Interac,
 * cheque, EFT are recorded as refunded outside — Stripe is never called.
 */

const INV = new mongoose.Types.ObjectId("0123456789abcdef0123456e");
const ORG = new mongoose.Types.ObjectId("0123456789abcdef01234567");
const CARD = new mongoose.Types.ObjectId("0123456789abcdef01234591");
const CHEQUE = new mongoose.Types.ObjectId("0123456789abcdef01234592");
const ADMIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-10-15T15:00:00Z");

type Doc = Record<string, unknown>;

const h = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  calls: [] as string[],
  create: vi.fn(),
  list: vi.fn(),
  retrieve: vi.fn(),
  chargeRetrieve: vi.fn(),
  open: vi.fn(),
  outside: vi.fn(),
  mark: vi.fn(),
  drop: vi.fn(),
  record: vi.fn(),
  refresh: vi.fn(),
  cancelIntent: vi.fn(),
  email: vi.fn(),
  invUpdateOne: vi.fn(async () => ({ modifiedCount: 1 })),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: { create: h.create, list: h.list, retrieve: h.retrieve },
    charges: { retrieve: h.chargeRetrieve },
  },
}));
vi.mock("@/models/OrganizationInvoice", () => {
  const findById = () => {
    const doc = h.invoice ? { ...h.invoice } : null;
    return Object.assign(Promise.resolve(doc), { lean: async () => doc });
  };
  return { default: { findById, updateOne: h.invUpdateOne } };
});
vi.mock("@/models/Organization", () => ({
  default: {
    findById: () => ({
      select: () => ({ lean: async () => ({ name: "PAE Desjardins", language: "fr", billingEmails: ["factu@pae.ca"] }) }),
    }),
  },
}));
vi.mock("@/lib/organization-invoice-settlement", () => ({
  ORGANIZATION_REFUND_TYPE: "organization_invoice_refund",
  openOrganizationStripeRefund: h.open,
  recordOrganizationOutsideRefund: h.outside,
  markOrganizationRefundStatus: h.mark,
  dropOrganizationStripeRefundRequest: h.drop,
  recordOrganizationStripeRefund: h.record,
  refreshInvoiceMoney: h.refresh,
}));
vi.mock("@/lib/organization-invoice-card", () => ({ cancelOpenOrganizationPaymentIntent: h.cancelIntent }));
vi.mock("@/lib/organization-invoice-pay-link", () => ({
  ensurePayToken: async () => "t".repeat(64),
  organizationPayUrl: (token: string) => `https://x/org-pay?token=${token}`,
}));
vi.mock("@/lib/notifications", () => ({ sendOrganizationRefundEmail: h.email }));

import { checkOrganizationRefund, refundOrganizationPayment } from "@/lib/organization-invoice-refund";

const paid = (over: Doc = {}): Doc => ({
  _id: INV,
  organizationId: ORG,
  number: "JCO-2026-000007",
  status: "paid",
  totalCents: 18000,
  paidCents: 18000,
  balanceCents: 0,
  disputed: false,
  payToken: "p".repeat(64),
  billTo: { name: "PAE Desjardins", emails: ["factu@pae.ca"] },
  payments: [
    { paymentId: CARD, amountCents: 9000, refundedCents: 0, method: "card", source: "stripe", externalRef: "pi_card" },
    { paymentId: CHEQUE, amountCents: 9000, refundedCents: 0, method: "cheque", source: "admin" },
  ],
  refunds: [],
  ...over,
});

const refund = (over: Partial<Parameters<typeof refundOrganizationPayment>[0]> = {}) =>
  refundOrganizationPayment({
    invoiceId: String(INV),
    paymentId: String(CARD),
    amountCents: 5000,
    owed: "still",
    reason: "Séance annulée par l'organisme",
    requestKey: "req-key-1",
    notify: true,
    byUserId: ADMIN,
    now: NOW,
    ...over,
  });

const stripeRefund = (over: Doc = {}) =>
  ({ id: "re_1", status: "succeeded", payment_intent: "pi_card", charge: { id: "ch_1", amount_refunded: 5000 }, ...over }) as unknown as Stripe.Refund;

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.invoice = paid();
  h.open.mockImplementation(async () => {
    h.calls.push("open");
    return "opened";
  });
  h.create.mockImplementation(async () => {
    h.calls.push("stripe");
    return stripeRefund();
  });
  h.mark.mockImplementation(async () => {
    h.calls.push("mark");
    return true;
  });
  h.record.mockImplementation(async () => {
    h.calls.push("record");
    return "recorded";
  });
  h.refresh.mockResolvedValue("paid");
  h.outside.mockResolvedValue("recorded");
  h.email.mockResolvedValue(true);
});

describe("a card refund goes through Stripe", () => {
  it("writes the row first, then asks Stripe with a key derived from it, then records Stripe's total", async () => {
    const r = await refund();
    expect(r.ok).toBe(true);
    expect(h.calls).toEqual(["open", "stripe", "mark", "record"]);
    expect(h.open.mock.invocationCallOrder[0]).toBeLessThan(h.create.mock.invocationCallOrder[0]);

    const row = (h.open.mock.calls[0][0] as { row: Doc }).row;
    expect(row).toMatchObject({ via: "stripe", status: "requested", amountCents: 5000, creditCents: 0, owed: "still", requestKey: "req-key-1" });
    const [params, options] = h.create.mock.calls[0] as [Doc, Doc];
    expect(params).toMatchObject({
      payment_intent: "pi_card",
      amount: 5000,
      metadata: { type: "organization_invoice_refund", organizationInvoiceId: String(INV), organizationRefundId: String(row.refundId) },
      expand: ["charge"],
    });
    expect(options).toEqual({ idempotencyKey: `orgref_${String(row.refundId)}` });
    // The refunded total is Stripe's, not a guess.
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: "pi_card", refundedCents: 5000 }));
    expect(h.cancelIntent).toHaveBeenCalled();
  });

  it("« plus dû » records the credit; the reason never reaches the organization", async () => {
    await refund({ owed: "no_longer" });
    expect((h.open.mock.calls[0][0] as { row: Doc }).row).toMatchObject({ creditCents: 5000, owed: "no_longer" });
    expect(h.email).toHaveBeenCalledTimes(1);
    const mail = h.email.mock.calls[0][0] as Doc;
    expect(mail).toMatchObject({ to: "factu@pae.ca", amountCents: 5000, via: "card", pending: false });
    expect(JSON.stringify(mail)).not.toContain("annulée");
  });

  it("no email when the admin unticks it", async () => {
    await refund({ notify: false });
    expect(h.email).not.toHaveBeenCalled();
  });

  it("a bank debit is refunded through Stripe too — to the account, pending while the bank moves it", async () => {
    h.invoice = paid({
      payments: [{ paymentId: CARD, amountCents: 18000, refundedCents: 0, method: "pad", source: "stripe", externalRef: "pi_debit" }],
    });
    h.create.mockResolvedValue(stripeRefund({ status: "pending", payment_intent: "pi_debit" }));
    await refund();
    expect(h.create.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_debit", amount: 5000 });
    expect(h.email.mock.calls[0][0]).toMatchObject({ via: "bank", pending: true });
  });

  it("Stripe refusing outright takes the row back", async () => {
    h.create.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({ message: "Charge already refunded", type: "invalid_request_error", statusCode: 400 } as never),
    );
    const r = await refund();
    expect(r).toMatchObject({ ok: false, status: 409, code: "STRIPE_REFUSED", error: "Charge already refunded" });
    expect(h.drop).toHaveBeenCalled();
    expect(h.mark).not.toHaveBeenCalled();
  });

  it("an unknown outcome keeps the row to check — never re-sent, never reported done", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.create.mockRejectedValue(new Stripe.errors.StripeConnectionError({ message: "socket hang up" } as never));
    const r = await refund();
    expect(r).toMatchObject({ ok: false, status: 502, code: "REFUND_UNCONFIRMED" });
    expect(h.drop).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();

    // The same click again: still unconfirmed, Stripe not asked twice.
    h.create.mockClear();
    h.invoice = paid({ refunds: [{ refundId: new mongoose.Types.ObjectId(), paymentId: CARD, requestKey: "req-key-1", status: "requested", via: "stripe", amountCents: 5000, creditCents: 0 }] });
    expect(await refund()).toMatchObject({ code: "REFUND_UNCONFIRMED" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("the same click after it went through answers with the invoice, and refunds nothing more", async () => {
    h.invoice = paid({ refunds: [{ refundId: new mongoose.Types.ObjectId(), paymentId: CARD, requestKey: "req-key-1", status: "succeeded", via: "stripe", amountCents: 5000, creditCents: 0 }] });
    expect((await refund()).ok).toBe(true);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a bank refund still on its way is recorded as pending", async () => {
    h.create.mockImplementation(async () => stripeRefund({ status: "pending" }));
    await refund();
    expect(h.mark).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", stripeRefundId: "re_1" }));
    expect((h.email.mock.calls[0][0] as Doc).pending).toBe(true);
  });
});

describe("refused before anything moves", () => {
  it.each([
    ["a chargeback", paid({ disputed: true }), "DISPUTED"],
    ["another refund unconfirmed", paid({ refunds: [{ refundId: new mongoose.Types.ObjectId(), paymentId: CARD, requestKey: "other", status: "requested", via: "stripe", amountCents: 1000, creditCents: 0 }] }), "REFUND_IN_PROGRESS"],
  ])("%s", async (_label, invoice, code) => {
    h.invoice = invoice as Doc;
    expect(await refund()).toMatchObject({ ok: false, status: 409, code });
    expect(h.open).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.outside).not.toHaveBeenCalled();
  });

  it("more than what is left of the payment", async () => {
    const r = await refund({ amountCents: 9001 });
    expect(r).toMatchObject({ code: "REFUND_TOO_LARGE", details: { refundableCents: 9000 } });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("no reason, no owed choice when one is needed, a bad amount", async () => {
    expect(await refund({ reason: "  " })).toMatchObject({ code: "REASON_REQUIRED" });
    expect(await refund({ owed: null })).toMatchObject({ code: "OWED_REQUIRED" });
    expect(await refund({ amountCents: 0 })).toMatchObject({ code: "INVALID_AMOUNT" });
    expect(await refund({ amountCents: 10.5 })).toMatchObject({ code: "INVALID_AMOUNT" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refunding an overpayment needs no choice and credits nothing", async () => {
    h.invoice = paid({ paidCents: 21000, balanceCents: -3000, totalCents: 18000 });
    await refund({ amountCents: 3000, owed: null });
    expect((h.open.mock.calls[0][0] as { row: Doc }).row).toMatchObject({ amountCents: 3000, creditCents: 0 });
    expect((h.open.mock.calls[0][0] as { row: Doc }).row).not.toHaveProperty("owed");
  });
});

describe("a payment made outside Stripe is recorded as refunded outside", () => {
  it("never calls Stripe, and records how the money went back", async () => {
    const r = await refund({ paymentId: String(CHEQUE), outside: { method: "cheque", reference: "CHQ-88" } });
    expect(r.ok).toBe(true);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
    const args = h.outside.mock.calls[0][0] as { row: Doc; expected: Doc };
    expect(args.row).toMatchObject({ via: "outside", method: "cheque", reference: "CHQ-88", status: "succeeded", amountCents: 5000 });
    expect(args.expected).toEqual({ status: "paid", balanceCents: 0, refundedCents: 0 });
    expect((h.email.mock.calls[0][0] as Doc).via).toBe("outside");
  });

  it("asks how the money went back", async () => {
    expect(await refund({ paymentId: String(CHEQUE), outside: null })).toMatchObject({ code: "METHOD_REQUIRED" });
    expect(await refund({ paymentId: String(CHEQUE), outside: { method: "card" } })).toMatchObject({ code: "METHOD_REQUIRED" });
    expect(h.outside).not.toHaveBeenCalled();
  });

  it("an invoice changed meanwhile records nothing", async () => {
    h.outside.mockResolvedValue("changed");
    expect(await refund({ paymentId: String(CHEQUE), outside: { method: "eft" } })).toMatchObject({ code: "CHANGED_MEANWHILE" });
    expect(h.email).not.toHaveBeenCalled();
  });
});

describe("checkOrganizationRefund — « Vérifier »", () => {
  const REF = new mongoose.Types.ObjectId("0123456789abcdef012345aa");
  const requested = (at: Date) =>
    paid({ refunds: [{ refundId: REF, paymentId: CARD, requestKey: "k", status: "requested", via: "stripe", amountCents: 5000, creditCents: 0, at }] });

  it("adopts the refund Stripe has under our id", async () => {
    h.invoice = requested(new Date(NOW.getTime() - 5 * 60_000));
    h.list.mockResolvedValue({ data: [stripeRefund({ metadata: { organizationRefundId: String(REF) } })] });
    expect((await checkOrganizationRefund({ invoiceId: String(INV), refundId: String(REF), now: NOW })).ok).toBe(true);
    expect(h.list).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_card" }));
    expect(h.mark).toHaveBeenCalledWith(expect.objectContaining({ refundId: REF, status: "succeeded" }));
    expect(h.record).toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("marks it failed when Stripe never got it — and never re-sends it", async () => {
    h.invoice = requested(new Date(NOW.getTime() - 5 * 60_000));
    h.list.mockResolvedValue({ data: [] });
    await checkOrganizationRefund({ invoiceId: String(INV), refundId: String(REF), now: NOW });
    expect(h.mark).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", failureReason: "not_sent" }));
    expect(h.create).not.toHaveBeenCalled();
  });

  it("waits a minute: the first answer may still be on its way", async () => {
    h.invoice = requested(new Date(NOW.getTime() - 10_000));
    expect(await checkOrganizationRefund({ invoiceId: String(INV), refundId: String(REF), now: NOW })).toMatchObject({ code: "CHECK_TOO_SOON" });
    expect(h.list).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

/**
 * Spec 002 phase 5 — a card payment from the organization's pay link. The
 * amount comes from the database; the intent is tagged as an organization's
 * and carries no appointmentId; an open intent is reused, never stacked, and
 * cancelled once it no longer matches what is owed.
 */

const INV_ID = "0123456789abcdef0123456e";
const ORG_ID = "0123456789abcdef01234567";
const TOKEN = "a".repeat(64);

const h = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  org: null as Record<string, unknown> | null,
  retrieve: vi.fn(),
  create: vi.fn(),
  cancel: vi.fn(async () => ({})),
  customerCreate: vi.fn(async () => ({ id: "cus_new" })),
  invUpdateOne: vi.fn(async () => ({ modifiedCount: 1 })),
  orgUpdateOne: vi.fn(async () => ({ modifiedCount: 1 })),
  findOneFilter: null as unknown,
  padEnabled: true,
  markProcessing: vi.fn(async () => "marked"),
  debitFailure: vi.fn(async () => "recorded"),
  clearDebit: vi.fn(async () => undefined),
  settle: vi.fn(async () => ({ outcome: "applied" })),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: { retrieve: h.retrieve, create: h.create, cancel: h.cancel },
    customers: { create: h.customerCreate },
  },
}));
vi.mock("@/lib/organization-invoice-settlement", () => ({
  ORGANIZATION_INVOICE_PAYMENT_TYPE: "organization_invoice",
  markOrganizationDebitProcessing: h.markProcessing,
  recordOrganizationDebitFailure: h.debitFailure,
  clearOrganizationPendingDebit: h.clearDebit,
  settleOrganizationInvoiceIntent: h.settle,
}));
vi.mock("@/lib/organization-invoice-pay-link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organization-invoice-pay-link")>()),
  isOrganizationPadEnabled: async () => h.padEnabled,
}));
vi.mock("@/models/OrganizationInvoice", () => ({
  default: {
    findOne: (filter: unknown) => {
      h.findOneFilter = filter;
      return { select: () => ({ lean: async () => h.invoice }) };
    },
    findById: () => ({ select: () => ({ lean: async () => h.invoice }) }),
    updateOne: h.invUpdateOne,
  },
}));
vi.mock("@/models/Organization", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: async () => h.org }) }),
    updateOne: h.orgUpdateOne,
  },
}));

import {
  cancelOpenOrganizationPaymentIntent,
  confirmOrganizationPaymentStarted,
  reconcileOrganizationDebit,
  startOrganizationPayment,
} from "@/lib/organization-invoice-card";

const openInvoice = (over: Record<string, unknown> = {}) => ({
  _id: INV_ID,
  organizationId: ORG_ID,
  number: "JCO-2026-000007",
  status: "sent",
  balanceCents: 18000,
  payments: [],
  ...over,
});

beforeEach(() => {
  h.invoice = openInvoice();
  h.findOneFilter = null;
  h.org = { _id: ORG_ID, name: "PAE Desjardins", billingEmails: ["factu@pae.ca"], stripeCustomerId: "cus_org" };
  for (const f of [h.retrieve, h.create, h.cancel, h.customerCreate, h.invUpdateOne, h.orgUpdateOne]) f.mockClear();
  h.retrieve.mockReset();
  h.create.mockReset();
  h.create.mockImplementation(async () => ({ id: "pi_new", client_secret: "pi_new_secret" }));
  h.padEnabled = true;
  for (const f of [h.markProcessing, h.debitFailure, h.clearDebit, h.settle]) f.mockClear();
});

describe("startOrganizationPayment", () => {
  it("refuses a malformed token without touching the database", async () => {
    expect(await startOrganizationPayment("../etc")).toMatchObject({ ok: false, status: 404 });
    expect(await startOrganizationPayment({ $ne: null })).toMatchObject({ ok: false, status: 404 });
    expect(h.findOneFilter).toBeNull();
  });

  it("refuses an unknown link, and an invoice with nothing due", async () => {
    h.invoice = null;
    expect(await startOrganizationPayment(TOKEN)).toMatchObject({ status: 404 });
    for (const over of [{ status: "paid", balanceCents: 0 }, { status: "void" }, { status: "draft" }, { balanceCents: 0 }]) {
      h.invoice = openInvoice(over);
      expect(await startOrganizationPayment(TOKEN)).toMatchObject({ status: 409, code: "NOT_PAYABLE" });
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("charges the balance from the database, as an organization's payment, never an appointment's", async () => {
    h.invoice = openInvoice({ status: "partially_paid", balanceCents: 9000, payments: [{ externalRef: "chq" }] });
    const r = await startOrganizationPayment(TOKEN);
    expect(r).toEqual({ ok: true, clientSecret: "pi_new_secret", amountCents: 9000, reused: false, method: "card" });
    expect(h.findOneFilter).toEqual({ payToken: TOKEN });

    const [params, opts] = h.create.mock.calls[0] as [Record<string, unknown>, { idempotencyKey: string }];
    expect(params).toMatchObject({ amount: 9000, currency: "cad", customer: "cus_org", payment_method_types: ["card"] });
    expect(params.metadata).toMatchObject({ type: "organization_invoice", organizationInvoiceId: INV_ID });
    expect(params.metadata).not.toHaveProperty("appointmentId");
    expect(opts.idempotencyKey).toBe(`orginv_${INV_ID}_card_9000_1_none`);
    expect(h.invUpdateOne).toHaveBeenCalledWith({ _id: INV_ID }, { $set: { stripePaymentIntentId: "pi_new" } });
  });

  it("hands back an intent still waiting for the same amount instead of stacking a new one", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old" });
    h.retrieve.mockResolvedValue({ id: "pi_old", status: "requires_payment_method", amount: 18000, client_secret: "old_secret", payment_method_types: ["card"] });
    expect(await startOrganizationPayment(TOKEN)).toMatchObject({ clientSecret: "old_secret", reused: true });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("cancels an intent for a balance that has since moved, then starts a fresh one", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old", balanceCents: 9000 });
    h.retrieve.mockResolvedValue({ id: "pi_old", status: "requires_payment_method", amount: 18000, client_secret: "x" });
    const r = await startOrganizationPayment(TOKEN);
    expect(h.cancel).toHaveBeenCalledWith("pi_old");
    expect(r).toMatchObject({ amountCents: 9000, reused: false });
  });

  it("refuses while a payment is in flight or paid but not yet recorded", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old" });
    for (const status of ["processing", "succeeded"]) {
      h.retrieve.mockResolvedValue({ id: "pi_old", status, amount: 18000 });
      expect(await startOrganizationPayment(TOKEN)).toMatchObject({ status: 409, code: "PAYMENT_IN_PROGRESS" });
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("ignores an intent already recorded as a payment", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_paid", balanceCents: 9000, payments: [{ externalRef: "pi_paid" }] });
    await startOrganizationPayment(TOKEN);
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalled();
  });

  it("does not read a Stripe outage as 'nothing in flight'", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old" });
    h.retrieve.mockRejectedValue(
      new Stripe.errors.StripeAPIError({ message: "down", type: "api_error" } as never),
    );
    await expect(startOrganizationPayment(TOKEN)).rejects.toThrow();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("creates the organization's Stripe customer once, idempotently", async () => {
    h.org = { ...h.org, stripeCustomerId: undefined };
    await startOrganizationPayment(TOKEN);
    expect(h.customerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "PAE Desjardins", email: "factu@pae.ca" }),
      { idempotencyKey: `org_customer_${ORG_ID}` },
    );
    expect(h.orgUpdateOne).toHaveBeenCalledWith(
      { _id: ORG_ID, stripeCustomerId: { $exists: false } },
      { $set: { stripeCustomerId: "cus_new" } },
    );
  });
});

/**
 * Phase 9 — paying by pre-authorized bank debit (DPA): one debit, for this
 * invoice, from a business account; nothing kept for another debit. Its own
 * switch, off by default.
 */
describe("startOrganizationPayment — bank debit", () => {
  it("a one-off business debit, confirmed by the organization, never kept for later", async () => {
    const r = await startOrganizationPayment(TOKEN, "pad");
    expect(r).toMatchObject({ ok: true, method: "pad", amountCents: 18000 });
    const [params, opts] = h.create.mock.calls[0] as [Record<string, unknown>, { idempotencyKey: string }];
    expect(params).toMatchObject({
      amount: 18000,
      currency: "cad",
      payment_method_types: ["acss_debit"],
      payment_method_options: {
        acss_debit: {
          mandate_options: { payment_schedule: "sporadic", transaction_type: "business" },
          verification_method: "automatic",
        },
      },
      metadata: { type: "organization_invoice", organizationInvoiceId: INV_ID, method: "pad" },
    });
    expect(params).not.toHaveProperty("setup_future_usage");
    expect(params.metadata).not.toHaveProperty("appointmentId");
    expect(opts.idempotencyKey).toBe(`orginv_${INV_ID}_pad_18000_0_none`);
  });

  it("switching from card to debit cancels the card intent — the key names both, so no replay", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_card" });
    h.retrieve.mockResolvedValue({ id: "pi_card", status: "requires_payment_method", amount: 18000, client_secret: "c", payment_method_types: ["card"] });
    await startOrganizationPayment(TOKEN, "pad");
    expect(h.cancel).toHaveBeenCalledWith("pi_card");
    expect((h.create.mock.calls[0] as [unknown, { idempotencyKey: string }])[1].idempotencyKey).toBe(`orginv_${INV_ID}_pad_18000_0_pi_card`);
  });

  it("reuses a debit still waiting, with its microdeposit link — but never one that already failed", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_pad" });
    h.retrieve.mockResolvedValue({
      id: "pi_pad",
      status: "requires_action",
      amount: 18000,
      client_secret: "pad_secret",
      payment_method_types: ["acss_debit"],
      next_action: { type: "verify_with_microdeposits", verify_with_microdeposits: { hosted_verification_url: "https://stripe/verify", arrival_date: 1790000000 } },
    });
    expect(await startOrganizationPayment(TOKEN, "pad")).toMatchObject({
      reused: true,
      clientSecret: "pad_secret",
      verification: { url: "https://stripe/verify", arrivalDate: 1790000000 },
    });
    expect(h.create).not.toHaveBeenCalled();

    h.retrieve.mockResolvedValue({
      id: "pi_pad",
      status: "requires_payment_method",
      amount: 18000,
      client_secret: "pad_secret",
      payment_method_types: ["acss_debit"],
      last_payment_error: { code: "debit_not_authorized" },
    });
    expect(await startOrganizationPayment(TOKEN, "pad")).toMatchObject({ reused: false });
    expect(h.cancel).toHaveBeenCalledWith("pi_pad");
  });

  it("while a debit is on its way, nothing starts — and Stripe is not even asked", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_pad", pendingDebit: { paymentIntentId: "pi_pad", amountCents: 18000, since: new Date() } });
    expect(await startOrganizationPayment(TOKEN, "card")).toMatchObject({ status: 409, code: "PAYMENT_IN_PROGRESS" });
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses a debit while its switch is off, and an unknown method", async () => {
    h.padEnabled = false;
    expect(await startOrganizationPayment(TOKEN, "pad")).toMatchObject({ status: 409, code: "METHOD_UNAVAILABLE" });
    expect(await startOrganizationPayment(TOKEN, "bitcoin")).toMatchObject({ status: 400, code: "INVALID_METHOD" });
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("confirmOrganizationPaymentStarted — the pay page reports a debit", () => {
  it("marks it on its way only when Stripe says so, for this invoice's own intent", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_pad" });
    h.retrieve.mockResolvedValue({ id: "pi_pad", status: "processing", metadata: { organizationInvoiceId: INV_ID } });
    expect(await confirmOrganizationPaymentStarted(TOKEN, "pi_pad")).toMatchObject({ ok: true, status: "processing" });
    expect(h.markProcessing).toHaveBeenCalledTimes(1);
  });

  it("believes nothing: another intent, another invoice's, or a malformed id", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_pad" });
    expect(await confirmOrganizationPaymentStarted(TOKEN, "pi_other")).toMatchObject({ ok: false, status: 404 });
    // Not the invoice's own intent: refused without asking Stripe about it.
    expect(h.retrieve).not.toHaveBeenCalled();
    h.retrieve.mockResolvedValue({ id: "pi_pad", status: "processing", metadata: { organizationInvoiceId: "someone-else" } });
    expect(await confirmOrganizationPaymentStarted(TOKEN, "pi_pad")).toMatchObject({ ok: false, status: 404 });
    expect(await confirmOrganizationPaymentStarted(TOKEN, "pi_pad; drop")).toMatchObject({ ok: false, status: 404 });
    expect(h.markProcessing).not.toHaveBeenCalled();
  });
});

describe("reconcileOrganizationDebit — « Vérifier » on a debit", () => {
  beforeEach(() => {
    h.invoice = openInvoice({ pendingDebit: { paymentIntentId: "pi_pad", amountCents: 18000, since: new Date() } });
  });

  it.each([
    ["succeeded", "settled"],
    ["processing", "processing"],
    ["requires_payment_method", "failed"],
    ["canceled", "cleared"],
  ])("Stripe says %s → %s", async (status, outcome) => {
    h.retrieve.mockResolvedValue({ id: "pi_pad", status, payment_method_types: ["acss_debit"] });
    expect(await reconcileOrganizationDebit(INV_ID)).toBe(outcome);
    expect(h.settle).toHaveBeenCalledTimes(status === "succeeded" ? 1 : 0);
    expect(h.debitFailure).toHaveBeenCalledTimes(status === "requires_payment_method" ? 1 : 0);
    expect(h.clearDebit.mock.calls.length > 0).toBe(status === "requires_payment_method" || status === "canceled");
  });

  it("nothing to check without a debit on its way", async () => {
    h.invoice = openInvoice();
    expect(await reconcileOrganizationDebit(INV_ID)).toBe("none");
    expect(h.retrieve).not.toHaveBeenCalled();
  });
});

describe("cancelOpenOrganizationPaymentIntent", () => {
  it("cancels an unfinished card payment on a voided or settled invoice", async () => {
    h.retrieve.mockResolvedValue({ id: "pi_old", status: "requires_payment_method", amount: 18000 });
    for (const over of [{ status: "void" }, { status: "paid", balanceCents: 0 }]) {
      h.cancel.mockClear();
      h.invoice = openInvoice({ stripePaymentIntentId: "pi_old", ...over });
      expect(await cancelOpenOrganizationPaymentIntent(INV_ID)).toBe(true);
      expect(h.cancel).toHaveBeenCalledWith("pi_old");
    }
  });

  it("cancels one for an amount no longer owed, keeps one that still matches", async () => {
    h.retrieve.mockResolvedValue({ id: "pi_old", status: "requires_payment_method", amount: 18000 });
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old" });
    expect(await cancelOpenOrganizationPaymentIntent(INV_ID)).toBe(false);
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old", status: "partially_paid", balanceCents: 9000 });
    expect(await cancelOpenOrganizationPaymentIntent(INV_ID)).toBe(true);
  });

  it("leaves a paid or processing intent alone, and never throws", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old", status: "void" });
    h.retrieve.mockResolvedValue({ id: "pi_old", status: "processing", amount: 18000 });
    expect(await cancelOpenOrganizationPaymentIntent(INV_ID)).toBe(false);
    h.retrieve.mockRejectedValue(new Error("network"));
    expect(await cancelOpenOrganizationPaymentIntent(INV_ID)).toBe(false);
    expect(h.cancel).not.toHaveBeenCalled();
  });
});

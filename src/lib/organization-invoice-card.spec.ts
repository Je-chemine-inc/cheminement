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
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: { retrieve: h.retrieve, create: h.create, cancel: h.cancel },
    customers: { create: h.customerCreate },
  },
}));
vi.mock("@/lib/organization-invoice-settlement", () => ({ ORGANIZATION_INVOICE_PAYMENT_TYPE: "organization_invoice" }));
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

import { cancelOpenOrganizationPaymentIntent, startOrganizationCardPayment } from "@/lib/organization-invoice-card";

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
});

describe("startOrganizationCardPayment", () => {
  it("refuses a malformed token without touching the database", async () => {
    expect(await startOrganizationCardPayment("../etc")).toMatchObject({ ok: false, status: 404 });
    expect(await startOrganizationCardPayment({ $ne: null })).toMatchObject({ ok: false, status: 404 });
    expect(h.findOneFilter).toBeNull();
  });

  it("refuses an unknown link, and an invoice with nothing due", async () => {
    h.invoice = null;
    expect(await startOrganizationCardPayment(TOKEN)).toMatchObject({ status: 404 });
    for (const over of [{ status: "paid", balanceCents: 0 }, { status: "void" }, { status: "draft" }, { balanceCents: 0 }]) {
      h.invoice = openInvoice(over);
      expect(await startOrganizationCardPayment(TOKEN)).toMatchObject({ status: 409, code: "NOT_PAYABLE" });
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("charges the balance from the database, as an organization's payment, never an appointment's", async () => {
    h.invoice = openInvoice({ status: "partially_paid", balanceCents: 9000, payments: [{ externalRef: "chq" }] });
    const r = await startOrganizationCardPayment(TOKEN);
    expect(r).toEqual({ ok: true, clientSecret: "pi_new_secret", amountCents: 9000, reused: false });
    expect(h.findOneFilter).toEqual({ payToken: TOKEN });

    const [params, opts] = h.create.mock.calls[0] as [Record<string, unknown>, { idempotencyKey: string }];
    expect(params).toMatchObject({ amount: 9000, currency: "cad", customer: "cus_org", payment_method_types: ["card"] });
    expect(params.metadata).toMatchObject({ type: "organization_invoice", organizationInvoiceId: INV_ID });
    expect(params.metadata).not.toHaveProperty("appointmentId");
    expect(opts.idempotencyKey).toBe(`orginv_${INV_ID}_9000_1`);
    expect(h.invUpdateOne).toHaveBeenCalledWith({ _id: INV_ID }, { $set: { stripePaymentIntentId: "pi_new" } });
  });

  it("hands back an intent still waiting for the same amount instead of stacking a new one", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old" });
    h.retrieve.mockResolvedValue({ id: "pi_old", status: "requires_payment_method", amount: 18000, client_secret: "old_secret" });
    expect(await startOrganizationCardPayment(TOKEN)).toMatchObject({ clientSecret: "old_secret", reused: true });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("cancels an intent for a balance that has since moved, then starts a fresh one", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old", balanceCents: 9000 });
    h.retrieve.mockResolvedValue({ id: "pi_old", status: "requires_payment_method", amount: 18000, client_secret: "x" });
    const r = await startOrganizationCardPayment(TOKEN);
    expect(h.cancel).toHaveBeenCalledWith("pi_old");
    expect(r).toMatchObject({ amountCents: 9000, reused: false });
  });

  it("refuses while a payment is in flight or paid but not yet recorded", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old" });
    for (const status of ["processing", "succeeded"]) {
      h.retrieve.mockResolvedValue({ id: "pi_old", status, amount: 18000 });
      expect(await startOrganizationCardPayment(TOKEN)).toMatchObject({ status: 409, code: "PAYMENT_IN_PROGRESS" });
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("ignores an intent already recorded as a payment", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_paid", balanceCents: 9000, payments: [{ externalRef: "pi_paid" }] });
    await startOrganizationCardPayment(TOKEN);
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalled();
  });

  it("does not read a Stripe outage as 'nothing in flight'", async () => {
    h.invoice = openInvoice({ stripePaymentIntentId: "pi_old" });
    h.retrieve.mockRejectedValue(
      new Stripe.errors.StripeAPIError({ message: "down", type: "api_error" } as never),
    );
    await expect(startOrganizationCardPayment(TOKEN)).rejects.toThrow();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("creates the organization's Stripe customer once, idempotently", async () => {
    h.org = { ...h.org, stripeCustomerId: undefined };
    await startOrganizationCardPayment(TOKEN);
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

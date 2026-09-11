/**
 * POST /api/admin/organization-invoices/[id] — the invoice's actions. Pins the
 * refund action's input checks and what it hands the refund service, the
 * « send without the form » flag, and that an admin never records a card
 * payment by hand.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const INV = "0123456789abcdef0123456e";
const PAY = "0123456789abcdef01234591";

const h = vi.hoisted(() => ({
  gate: { session: { user: { id: "admin1" } } } as Record<string, unknown>,
  refund: vi.fn(),
  check: vi.fn(),
  issue: vi.fn(),
  resend: vi.fn(),
  pay: vi.fn(),
  reconcile: vi.fn(),
  invoiceDoc: null as Record<string, unknown> | null,
}));

const ok = { ok: true, invoice: { toObject: () => ({ _id: INV, organizationId: "o1" }) } };

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
vi.mock("@/lib/organization-admin", () => ({ requireBillingAdmin: async () => h.gate }));
vi.mock("@/lib/organization-invoice", () => ({
  issueAndSend: h.issue,
  resendInvoice: h.resend,
  refreshDraft: vi.fn(),
  voidInvoice: vi.fn(),
  recordOrganizationPayment: h.pay,
}));
vi.mock("@/lib/organization-invoice-refund", () => ({
  refundOrganizationPayment: h.refund,
  checkOrganizationRefund: h.check,
}));
vi.mock("@/lib/organization-invoice-card", () => ({
  cancelOpenOrganizationPaymentIntent: vi.fn(),
  reconcileOrganizationDebit: h.reconcile,
}));
vi.mock("@/lib/organization-invoice-serialize", () => ({ serializeInvoice: (inv: { _id: string }) => ({ id: inv._id }) }));
vi.mock("@/models/Organization", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => ({ name: "PAE" }) }) }) },
}));
vi.mock("@/models/OrganizationInvoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/OrganizationInvoice")>()),
  default: { findById: () => ({ lean: async () => h.invoiceDoc }) },
}));

import { POST } from "./route";

type Res = { status: number; body: Record<string, unknown> };
const post = async (body: Record<string, unknown>) =>
  (await POST({ json: async () => body } as never, { params: Promise.resolve({ id: INV }) })) as unknown as Res;
const refundBody = (over: Record<string, unknown> = {}) => ({
  action: "refund",
  paymentId: PAY,
  amount: "50,00",
  owed: "no_longer",
  reason: "Séance annulée",
  requestKey: "7f3c2a1e-9b8d-4c6e-a5f4-3d2c1b0a9e8f",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { session: { user: { id: "admin1" } } };
  for (const f of [h.refund, h.check, h.issue, h.resend, h.pay]) f.mockResolvedValue(ok);
  h.reconcile.mockResolvedValue("processing");
  h.invoiceDoc = { _id: INV, organizationId: "o1" };
});

describe("refund", () => {
  it("hands the service the amount in cents, the choice, the reason, the key and the admin", async () => {
    expect((await post(refundBody())).status).toBe(200);
    expect(h.refund).toHaveBeenCalledWith({
      invoiceId: INV,
      paymentId: PAY,
      amountCents: 5000,
      owed: "no_longer",
      reason: "Séance annulée",
      requestKey: "7f3c2a1e-9b8d-4c6e-a5f4-3d2c1b0a9e8f",
      notify: true,
      byUserId: "admin1",
      outside: null,
    });
  });

  it("tells the organization unless explicitly unticked; passes how an outside refund was made", async () => {
    await post(refundBody({ notify: false, method: "cheque", reference: "CHQ-88", refundedOn: "2026-10-14" }));
    expect(h.refund.mock.calls[0][0]).toMatchObject({
      notify: false,
      outside: { method: "cheque", reference: "CHQ-88", refundedAt: expect.any(Date) },
    });
  });

  it("an unknown owed value is no choice at all", async () => {
    await post(refundBody({ owed: "maybe" }));
    expect(h.refund.mock.calls[0][0]).toMatchObject({ owed: null });
  });

  it("refuses a bad amount, payment or key before the service is called", async () => {
    expect((await post(refundBody({ amount: "zéro" }))).status).toBe(400);
    expect((await post(refundBody({ amount: "0" }))).status).toBe(400);
    expect((await post(refundBody({ paymentId: "nope" }))).status).toBe(400);
    expect((await post(refundBody({ requestKey: "short" }))).status).toBe(400);
    expect((await post(refundBody({ requestKey: "has spaces in it!" }))).status).toBe(400);
    expect((await post(refundBody({ refundedOn: "14/10/2026" }))).status).toBe(400);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("passes the service's refusal on, with its code", async () => {
    h.refund.mockResolvedValue({ ok: false, status: 409, code: "REFUND_TOO_LARGE", error: "too much", details: { refundableCents: 4000 } });
    const r = await post(refundBody());
    expect(r).toMatchObject({ status: 409, body: { code: "REFUND_TOO_LARGE", details: { refundableCents: 4000 } } });
  });

  it("refund_check asks where a refund stands", async () => {
    await post({ action: "refund_check", refundId: "0123456789abcdef012345aa" });
    expect(h.check).toHaveBeenCalledWith({ invoiceId: INV, refundId: "0123456789abcdef012345aa" });
  });
});

describe("the other actions", () => {
  it("sends without the organization's form only on an explicit true", async () => {
    await post({ action: "send", withoutOwnForm: "true" });
    expect(h.issue.mock.calls[0][0]).toMatchObject({ withoutOwnForm: false });
    await post({ action: "resend", withoutOwnForm: true });
    expect(h.resend.mock.calls[0][0]).toMatchObject({ withoutOwnForm: true });
  });

  it("an admin never records a card payment or a bank debit by hand — those come from Stripe", async () => {
    for (const method of ["card", "pad"]) {
      const r = await post({ action: "pay", amount: "10", method });
      expect(r.status).toBe(400);
    }
    expect(h.pay).not.toHaveBeenCalled();
  });

  it("debit_check asks Stripe where the bank debit stands and answers with the outcome", async () => {
    h.reconcile.mockResolvedValue("settled");
    const r = await post({ action: "debit_check" });
    expect(h.reconcile).toHaveBeenCalledWith(INV);
    expect(r).toEqual({ status: 200, body: { outcome: "settled", invoice: { id: INV } } });
  });

  it("debit_check with Stripe down changes nothing and says so", async () => {
    const Stripe = (await import("stripe")).default;
    h.reconcile.mockRejectedValue(new Stripe.errors.StripeConnectionError({ message: "timeout" } as never));
    const r = await post({ action: "debit_check" });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("STRIPE_UNAVAILABLE");
  });

  it("without billing rights, nothing runs", async () => {
    h.gate = { error: { status: 403, body: { error: "Forbidden" } } };
    expect((await post(refundBody())).status).toBe(403);
    expect(h.refund).not.toHaveBeenCalled();
  });
});

/**
 * GOLDEN RULE: issueFiscalReceipt must NEVER send a receipt or create a
 * client-visible (paid) receipt unless payment.status === "paid" for a closed,
 * billable session — and must be idempotent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const store: { appointment: Record<string, unknown> | null; existingPaid: unknown } = {
    appointment: null,
    existingPaid: null,
  };
  const sendFiscalReceiptEmail = vi.fn().mockResolvedValue(true);
  const sendSessionInvoiceEmail = vi.fn().mockResolvedValue(true);
  const sendInteracTransferInstructionsEmail = vi.fn().mockResolvedValue(true);
  const sendSessionInvoiceSms = vi.fn().mockResolvedValue(undefined);
  const receiptFindOne = vi.fn();
  const receiptUpdate = vi.fn().mockResolvedValue(null);
  const aptFindByIdAndUpdate = vi.fn().mockResolvedValue(null);
  const ledgerCreate = vi.fn().mockResolvedValue(null);
  const nextInvoiceNumber = vi.fn().mockResolvedValue("JC-2026-000001");
  const resolveBillingUrl = vi.fn().mockResolvedValue("https://x/pay");
  const aptUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const decisionAlert = vi.fn().mockResolvedValue(true);
  return {
    aptUpdateOne,
    decisionAlert,
    store,
    sendFiscalReceiptEmail,
    sendSessionInvoiceEmail,
    sendInteracTransferInstructionsEmail,
    sendSessionInvoiceSms,
    receiptFindOne,
    receiptUpdate,
    aptFindByIdAndUpdate,
    ledgerCreate,
    nextInvoiceNumber,
    resolveBillingUrl,
  };
});

const makeQuery = (result: unknown) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    return Promise.resolve(result).then(res, rej);
  },
});

vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => makeQuery(h.store.appointment),
    findByIdAndUpdate: h.aptFindByIdAndUpdate,
    updateOne: h.aptUpdateOne,
  },
}));
vi.mock("@/models/Profile", () => ({
  default: { findOne: () => ({ lean: () => Promise.resolve(null) }) },
}));
vi.mock("@/models/ClientReceipt", () => ({
  default: {
    findOne: h.receiptFindOne,
    findOneAndUpdate: h.receiptUpdate,
  },
}));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: { create: h.ledgerCreate },
}));
vi.mock("@/lib/notifications", () => ({
  sendFiscalReceiptEmail: h.sendFiscalReceiptEmail,
  sendSessionInvoiceEmail: h.sendSessionInvoiceEmail,
  sendInteracTransferInstructionsEmail: h.sendInteracTransferInstructionsEmail,
  sendAdminThirdPartyDecisionAlert: h.decisionAlert,
}));
vi.mock("@/lib/sms", () => ({ sendSessionInvoiceSms: h.sendSessionInvoiceSms }));
vi.mock("@/lib/receipt-pdf", () => ({
  buildFiscalReceiptPdfBuffer: vi.fn(() => Buffer.from("pdf")),
  buildFiscalReceiptInputFromPopulatedAppointment: vi.fn(() => ({})),
}));
vi.mock("@/lib/interac-deposit-email", () => ({
  getInteracDepositEmail: vi.fn().mockResolvedValue("deposit@x.ca"),
}));
vi.mock("@/lib/platform-contact", () => ({
  getPlatformContactInfo: vi.fn().mockResolvedValue({
    physicalAddress: "",
    companyName: "Je chemine",
    phoneNumber: "",
    supportEmail: "support@jechemine.ca",
  }),
}));
vi.mock("@/lib/format-platform-contact", () => ({
  formatStandardAddressBlock: vi.fn(() => []),
}));
vi.mock("@/lib/guardian-utils", () => ({
  resolveAppointmentRecipient: vi.fn(() => ({
    name: "Alex Roy",
    email: "alex@example.com",
    language: "fr",
  })),
}));
vi.mock("@/lib/client-portal-urls", () => ({ resolveBillingUrl: h.resolveBillingUrl }));
vi.mock("@/lib/invoice-number", () => ({ nextInvoiceNumber: h.nextInvoiceNumber }));
vi.mock("@/lib/ledger-cycle", () => ({ cycleKeyFromDateOrNow: () => "2026-06" }));

import {
  issueFiscalReceipt,
  runSessionClosureSideEffects,
} from "@/lib/session-post-closure";

const baseClient = {
  _id: { toString: () => "c1" },
  firstName: "Alex",
  lastName: "Roy",
  email: "alex@example.com",
  language: "fr",
  phone: "+15145551234",
  status: "active",
};
// A real ObjectId string: the ledger write builds an ObjectId from it, and "p1"
// made that throw silently, so no test ever exercised the ledger.
const basePro = {
  _id: { toString: () => "bbbbbbbbbbbbbbbbbbbbbbbb" },
  firstName: "Sam",
  lastName: "Pro",
};

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => "apt1" },
    date: new Date("2026-06-01T15:00:00Z"),
    time: "11:00",
    bookingFor: "self",
    sessionOutcome: "completed",
    invoiceNumber: "JC-2026-000001",
    fiscalReceiptIssuedAt: undefined,
    clientId: baseClient,
    professionalId: basePro,
    payment: {
      status: "paid",
      price: 120,
      platformFee: 20,
      professionalPayout: 100,
      method: "card",
    },
    toObject() {
      return { ...this };
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.store.appointment = null;
  h.store.existingPaid = null;
  h.receiptFindOne.mockImplementation(() => Promise.resolve(h.store.existingPaid));
  h.aptUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  h.decisionAlert.mockResolvedValue(true);
});

describe("issueFiscalReceipt — golden rule", () => {
  it("does NOT send a receipt when payment is not paid", async () => {
    h.store.appointment = makeAppointment({
      payment: { status: "pending", price: 120, platformFee: 20, professionalPayout: 100, method: "card" },
    });
    await issueFiscalReceipt("apt1");
    expect(h.sendFiscalReceiptEmail).not.toHaveBeenCalled();
    expect(h.receiptUpdate).not.toHaveBeenCalled();
    expect(h.aptFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("does NOT send for a non-billable outcome even when paid", async () => {
    h.store.appointment = makeAppointment({ sessionOutcome: "cancelled_free" });
    await issueFiscalReceipt("apt1");
    expect(h.sendFiscalReceiptEmail).not.toHaveBeenCalled();
    expect(h.receiptUpdate).not.toHaveBeenCalled();
  });

  it("issues + sends the receipt when paid and billable", async () => {
    h.store.appointment = makeAppointment();
    await issueFiscalReceipt("apt1");
    expect(h.sendFiscalReceiptEmail).toHaveBeenCalledTimes(1);
    // Creates the client-visible paid receipt (upsert, never resurrecting refunds).
    expect(h.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $ne: "refunded" } }),
      expect.objectContaining({ $set: { status: "paid" } }),
      expect.objectContaining({ upsert: true }),
    );
    expect(h.aptFindByIdAndUpdate).toHaveBeenCalledWith(
      "apt1",
      expect.objectContaining({ fiscalReceiptIssuedAt: expect.any(Date) }),
    );
  });

  it("is idempotent — skips when the receipt was already issued", async () => {
    h.store.appointment = makeAppointment({ fiscalReceiptIssuedAt: new Date() });
    await issueFiscalReceipt("apt1");
    expect(h.sendFiscalReceiptEmail).not.toHaveBeenCalled();
  });

  it("skips when a paid receipt already exists", async () => {
    h.store.appointment = makeAppointment();
    h.store.existingPaid = { _id: "r1" };
    await issueFiscalReceipt("apt1");
    expect(h.sendFiscalReceiptEmail).not.toHaveBeenCalled();
  });
});

describe("runSessionClosureSideEffects — unpaid closure sends a payment request, not a receipt", () => {
  it("card pending → invoice email + SMS, NO receipt", async () => {
    h.store.appointment = makeAppointment({
      payment: { status: "pending", price: 120, platformFee: 20, professionalPayout: 100, method: "card" },
    });
    await runSessionClosureSideEffects("apt1");
    expect(h.sendSessionInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(h.sendSessionInvoiceSms).toHaveBeenCalledTimes(1);
    expect(h.sendFiscalReceiptEmail).not.toHaveBeenCalled();
  });

  it("paid at closure (saved card at H+0) → issues the receipt", async () => {
    h.store.appointment = makeAppointment();
    await runSessionClosureSideEffects("apt1");
    expect(h.sendFiscalReceiptEmail).toHaveBeenCalledTimes(1);
    expect(h.sendSessionInvoiceEmail).not.toHaveBeenCalled();
  });
});

/** Spec 002 — a third party pays part or all of the session. */
describe("runSessionClosureSideEffects — third-party payer", () => {
  // $120 session, pro share 90 %, as the resolver would have written it.
  const snapshot = (over: Record<string, unknown> = {}) => ({
    kind: "organization",
    state: "confirmed",
    reason: "org_full",
    listPriceCents: 12000,
    orgAmountCents: 12000,
    clientAmountCents: 0,
    platformFeeTotalCents: 1200,
    proPayoutTotalCents: 10800,
    ...over,
  });
  const covered = (over: Record<string, unknown> = {}) =>
    makeAppointment({
      invoiceNumber: undefined,
      payment: { status: "covered", price: 0, platformFee: 0, professionalPayout: 0, method: "card" },
      thirdPartyBilling: snapshot(),
      ...over,
    });
  const ledgerRow = () => h.ledgerCreate.mock.calls[0]?.[0] as Record<string, unknown>;

  it("credits the professional for the WHOLE session even when the client owes 0", async () => {
    h.store.appointment = covered();
    await runSessionClosureSideEffects("apt1");
    expect(h.ledgerCreate).toHaveBeenCalledTimes(1);
    expect(ledgerRow()).toMatchObject({
      grossAmountCad: 120,
      platformFeeCad: 12,
      netToProfessionalCad: 108,
      paymentChannel: "organization",
      clientAmountCad: 0,
      orgAmountCad: 120,
    });
  });

  it("sends the client nothing and allocates no invoice number when the org pays it all", async () => {
    h.store.appointment = covered();
    await runSessionClosureSideEffects("apt1");
    expect(h.nextInvoiceNumber).not.toHaveBeenCalled();
    expect(h.sendSessionInvoiceEmail).not.toHaveBeenCalled();
    expect(h.sendSessionInvoiceSms).not.toHaveBeenCalled();
    expect(h.sendFiscalReceiptEmail).not.toHaveBeenCalled();
  });

  it("co-pay: the client is asked for their share only; the ledger still has the total", async () => {
    h.store.appointment = makeAppointment({
      payment: { status: "pending", price: 30, platformFee: 3, professionalPayout: 27, method: "card" },
      thirdPartyBilling: snapshot({ reason: "org_rate_gap", orgAmountCents: 9000, clientAmountCents: 3000 }),
    });
    await runSessionClosureSideEffects("apt1");
    expect(h.sendSessionInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(h.sendSessionInvoiceEmail.mock.calls[0][0]).toMatchObject({ amountCad: 30 });
    expect(ledgerRow()).toMatchObject({
      grossAmountCad: 120,
      netToProfessionalCad: 108,
      clientAmountCad: 30,
      orgAmountCad: 90,
    });
  });

  it("a session held for a payer decision alerts the team exactly once", async () => {
    h.store.appointment = covered({
      thirdPartyBilling: snapshot({ state: "awaiting_decision", reason: "declaration_pending" }),
      payerDeclaration: { organizationName: "PAE Desjardins" },
    });
    await runSessionClosureSideEffects("apt1");
    expect(h.aptUpdateOne).toHaveBeenCalledWith(
      {
        _id: expect.anything(),
        "thirdPartyBilling.state": "awaiting_decision",
        "thirdPartyBilling.decisionAlertSentAt": { $exists: false },
      },
      { $set: { "thirdPartyBilling.decisionAlertSentAt": expect.any(Date) } },
    );
    expect(h.decisionAlert).toHaveBeenCalledTimes(1);
    expect(h.decisionAlert.mock.calls[0][0]).toMatchObject({
      reason: "declaration_pending",
      organizationName: "PAE Desjardins",
    });
  });

  it("does not alert twice when another run already claimed it", async () => {
    h.store.appointment = covered({
      thirdPartyBilling: snapshot({ state: "awaiting_decision", reason: "consent_missing" }),
    });
    h.aptUpdateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    await runSessionClosureSideEffects("apt1");
    expect(h.decisionAlert).not.toHaveBeenCalled();
  });

  it("gives the claim back when the alert could not be sent", async () => {
    h.store.appointment = covered({
      thirdPartyBilling: snapshot({ state: "awaiting_decision", reason: "consent_missing" }),
    });
    h.decisionAlert.mockResolvedValueOnce(false);
    await runSessionClosureSideEffects("apt1");
    expect(h.aptUpdateOne).toHaveBeenLastCalledWith(
      { _id: expect.anything() },
      { $unset: { "thirdPartyBilling.decisionAlertSentAt": "" } },
    );
  });

  it("a confirmed payer never triggers the decision alert", async () => {
    h.store.appointment = covered();
    await runSessionClosureSideEffects("apt1");
    expect(h.decisionAlert).not.toHaveBeenCalled();
  });

  it("without a payer snapshot the ledger is exactly as before", async () => {
    h.store.appointment = makeAppointment({
      payment: { status: "pending", price: 120, platformFee: 20, professionalPayout: 100, method: "transfer" },
    });
    await runSessionClosureSideEffects("apt1");
    expect(ledgerRow()).toEqual(
      expect.objectContaining({
        grossAmountCad: 120,
        platformFeeCad: 20,
        netToProfessionalCad: 100,
        paymentChannel: "transfer",
      }),
    );
    expect(ledgerRow()).not.toHaveProperty("orgAmountCad");
  });
});

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
  return {
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
const basePro = { _id: { toString: () => "p1" }, firstName: "Sam", lastName: "Pro" };

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

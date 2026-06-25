/**
 * Post-session invoice dunning: H+12 first reminder, H+36 second reminder,
 * H+48 → "overdue" + admin alert. Ordered + idempotent via boolean flags.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const store: { candidates: Record<string, unknown>[] } = { candidates: [] };
  const findByIdAndUpdate = vi.fn().mockResolvedValue(null);
  const sendSessionInvoiceEmail = vi.fn().mockResolvedValue(true);
  const sendSessionInvoiceSms = vi.fn().mockResolvedValue(undefined);
  const sendAdminPaymentOverdueAlert = vi.fn().mockResolvedValue(undefined);
  const resolveBillingUrl = vi
    .fn()
    .mockResolvedValue("https://x/pay?token=t&lang=fr");
  return {
    store,
    findByIdAndUpdate,
    sendSessionInvoiceEmail,
    sendSessionInvoiceSms,
    sendAdminPaymentOverdueAlert,
    resolveBillingUrl,
  };
});

vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    find: () => ({
      populate() {
        return this;
      },
      limit() {
        return Promise.resolve(h.store.candidates);
      },
    }),
    findByIdAndUpdate: h.findByIdAndUpdate,
  },
}));
vi.mock("@/lib/interac-deposit-email", () => ({
  getInteracDepositEmail: vi.fn().mockResolvedValue("deposit@x.ca"),
}));
vi.mock("@/lib/platform-contact", () => ({
  getPlatformContactInfo: vi.fn().mockResolvedValue({
    phoneNumber: "(450) 634-5569",
    supportEmail: "support@jechemine.ca",
    companyName: "Je chemine",
    physicalAddress: {},
  }),
}));
vi.mock("@/lib/guardian-utils", () => ({
  resolveAppointmentRecipient: vi.fn(() => ({
    name: "Alex Roy",
    email: "alex@example.com",
    language: "fr",
  })),
}));
vi.mock("@/lib/client-portal-urls", () => ({
  resolveBillingUrl: h.resolveBillingUrl,
}));
vi.mock("@/lib/notifications", () => ({
  sendSessionInvoiceEmail: h.sendSessionInvoiceEmail,
  sendAdminPaymentOverdueAlert: h.sendAdminPaymentOverdueAlert,
}));
vi.mock("@/lib/sms", () => ({ sendSessionInvoiceSms: h.sendSessionInvoiceSms }));

import { runPaymentReminders } from "@/lib/payment-reminders";

const HOUR = 60 * 60 * 1000;

function makeApt(ageHours: number, overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => "apt1" },
    date: new Date("2026-06-01T15:00:00Z"),
    time: "11:00",
    bookingFor: "self",
    sessionOutcome: "completed",
    invoiceNumber: "JC-2026-000001",
    sessionCompletedAt: new Date(Date.now() - ageHours * HOUR),
    clientId: {
      firstName: "Alex",
      lastName: "Roy",
      email: "alex@example.com",
      language: "fr",
      phone: "+15145551234",
      status: "active",
    },
    professionalId: { firstName: "Sam", lastName: "Pro" },
    paymentReminder12hSent: false,
    paymentReminder36hSent: false,
    payment: { status: "pending", price: 120 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.store.candidates = [];
});

describe("runPaymentReminders — dunning schedule", () => {
  it("H+12 unpaid → first reminder (email + SMS), sets the 12h flag", async () => {
    h.store.candidates = [makeApt(13)];
    const res = await runPaymentReminders();
    expect(h.sendSessionInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(h.sendSessionInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ reminderNumber: 1 }),
    );
    expect(h.sendSessionInvoiceSms).toHaveBeenCalledTimes(1);
    expect(h.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: { paymentReminder12hSent: true } }),
    );
    expect(h.sendAdminPaymentOverdueAlert).not.toHaveBeenCalled();
    expect(res.firstReminders).toBe(1);
  });

  it("H+36 with the first sent → second reminder, sets the 36h flag", async () => {
    h.store.candidates = [makeApt(37, { paymentReminder12hSent: true })];
    const res = await runPaymentReminders();
    expect(h.sendSessionInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ reminderNumber: 2 }),
    );
    expect(h.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: { paymentReminder36hSent: true } }),
    );
    expect(res.secondReminders).toBe(1);
  });

  it("H+48 → flips to overdue + admin alert, no reminder email", async () => {
    h.store.candidates = [
      makeApt(49, { paymentReminder12hSent: true, paymentReminder36hSent: true }),
    ];
    const res = await runPaymentReminders();
    expect(h.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: { "payment.status": "overdue" } }),
    );
    expect(h.sendAdminPaymentOverdueAlert).toHaveBeenCalledTimes(1);
    expect(h.sendSessionInvoiceEmail).not.toHaveBeenCalled();
    expect(res.markedOverdue).toBe(1);
  });

  it("idempotent — first already sent, not yet H+36 → nothing fires", async () => {
    h.store.candidates = [makeApt(20, { paymentReminder12hSent: true })];
    const res = await runPaymentReminders();
    expect(h.sendSessionInvoiceEmail).not.toHaveBeenCalled();
    expect(h.sendAdminPaymentOverdueAlert).not.toHaveBeenCalled();
    expect(res).toEqual({
      firstReminders: 0,
      secondReminders: 0,
      markedOverdue: 0,
    });
  });
});

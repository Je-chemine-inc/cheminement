import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

/**
 * Spec 002 phase 4 — issuing, voiding and paying organization invoices.
 * Nothing is reserved or numbered before every check passes; nothing leaves
 * without consent; a failure after the claim puts things back.
 */

const INV = new mongoose.Types.ObjectId("0123456789abcdef0123456e");
const ORG = new mongoose.Types.ObjectId("0123456789abcdef01234567");
const COV = new mongoose.Types.ObjectId("0123456789abcdef01234568");
const A1 = new mongoose.Types.ObjectId("0123456789abcdef01234561");
const A2 = new mongoose.Types.ObjectId("0123456789abcdef01234562");
const ADMIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-10-01T13:00:00Z");

const h = vi.hoisted(() => ({
  calls: [] as string[],
  invoice: null as Record<string, unknown> | null,
  org: null as Record<string, unknown> | null,
  consent: "given",
  snapshots: [] as Record<string, unknown>[],
  reservedCount: 2,
  claimResult: true,
  delivered: true,
  invFindOneAndUpdate: vi.fn(),
  invUpdateOne: vi.fn(),
  invDeleteOne: vi.fn(async () => ({})),
  invFindByIdAndUpdate: vi.fn(),
  aptUpdateMany: vi.fn(),
  send: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/Profile", () => ({ default: {} }));
vi.mock("@/models/OrganizationInvoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/models/OrganizationInvoice")>();
  const findById = () => {
    const doc = h.invoice ? { ...h.invoice } : null;
    return Object.assign(Promise.resolve(doc), { lean: async () => doc });
  };
  return {
    ...actual,
    default: {
      findById,
      findOneAndUpdate: h.invFindOneAndUpdate,
      updateOne: h.invUpdateOne,
      deleteOne: h.invDeleteOne,
      findByIdAndUpdate: h.invFindByIdAndUpdate,
    },
  };
});
vi.mock("@/models/Organization", () => ({
  default: { findById: () => ({ lean: async () => h.org }) },
}));
vi.mock("@/models/OrganizationCoverage", () => ({
  default: {
    find: () => ({ select: () => ({ lean: async () => [{ _id: COV, consent: { status: h.consent } }] }) }),
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    find: () => ({ select: () => ({ lean: async () => h.snapshots }) }),
    updateMany: h.aptUpdateMany,
  },
}));
vi.mock("@/lib/invoice-number", () => ({
  nextOrganizationInvoiceNumber: vi.fn(async () => {
    h.calls.push("number");
    return "JCO-2026-000007";
  }),
}));
vi.mock("@/lib/organization-invoice-pdf", () => ({
  buildOrganizationInvoicePdfBuffer: vi.fn(() => Buffer.from("%PDF")),
}));
vi.mock("@/lib/platform-contact", () => ({
  getPlatformContactInfo: async () => ({ companyName: "Je chemine", physicalAddress: {}, phoneNumber: "", supportEmail: "" }),
}));
vi.mock("@/lib/interac-deposit-email", () => ({ getInteracDepositEmail: async () => "paiement@jechemine.ca" }));
vi.mock("@/lib/notifications", () => ({ sendOrganizationInvoiceEmail: h.send }));

import {
  issueAndSend,
  recordOrganizationPayment,
  voidInvoice,
} from "@/lib/organization-invoice";

const line = (appointmentId: mongoose.Types.ObjectId, amountCents = 9000) => ({
  appointmentId,
  coverageId: COV,
  sessionDate: new Date("2026-09-10T12:00:00Z"),
  patientFullName: "Léa Roy",
  professionalName: "Sam Pro",
  amountCents,
});
const snapshot = (id: mongoose.Types.ObjectId, amount = 9000) => ({
  _id: id,
  thirdPartyBilling: { kind: "organization", state: "confirmed", organizationId: ORG, orgAmountCents: amount },
});

beforeEach(() => {
  h.calls = [];
  h.invoice = {
    _id: INV,
    kind: "statement",
    status: "draft",
    draftKey: `statement:${ORG}:2026-09`,
    organizationId: ORG,
    lines: [line(A1), line(A2)],
    totalCents: 18000,
    paidCents: 0,
    balanceCents: 18000,
    payments: [],
    billTo: { name: "PAE Desjardins", emails: ["factu@pae.ca", "rh@pae.ca"] },
  };
  h.org = { _id: ORG, name: "PAE Desjardins", billingEmails: ["factu@pae.ca", "rh@pae.ca"], paymentTermsDays: 30, language: "fr" };
  h.consent = "given";
  h.snapshots = [snapshot(A1), snapshot(A2)];
  h.reservedCount = 2;
  h.claimResult = true;
  h.invFindOneAndUpdate.mockReset();
  h.invFindOneAndUpdate.mockImplementation(async (filter: Record<string, unknown>) => {
    h.calls.push(`claim:${String(filter.status)}`);
    return h.claimResult ? { ...h.invoice, status: "sent" } : null;
  });
  h.invUpdateOne.mockReset();
  h.invUpdateOne.mockImplementation(async (_f: unknown, update: { $set?: Record<string, unknown> }) => {
    if (update.$set?.number) {
      h.calls.push("store-number");
      h.invoice = { ...h.invoice, ...update.$set, status: "issuing" };
    }
    return { modifiedCount: 1 };
  });
  h.invDeleteOne.mockClear();
  h.invFindByIdAndUpdate.mockReset();
  h.invFindByIdAndUpdate.mockImplementation(async () => h.invoice);
  h.aptUpdateMany.mockReset();
  h.aptUpdateMany.mockImplementation(async (filter: Record<string, unknown>) => {
    if (filter._id) {
      h.calls.push("reserve");
      return { modifiedCount: h.reservedCount };
    }
    h.calls.push("release-or-mark");
    return { modifiedCount: 0 };
  });
  h.send.mockReset();
  h.send.mockImplementation(async () => {
    h.calls.push("email");
    return h.delivered;
  });
  h.delivered = true;
});

const issue = () => issueAndSend({ invoiceId: String(INV), byUserId: ADMIN, now: NOW });

describe("issueAndSend", () => {
  it("claims, reserves the sessions, THEN numbers, then emails every billing address", async () => {
    const r = await issue();
    expect(r.ok).toBe(true);
    expect(h.calls).toEqual(["claim:draft", "reserve", "number", "store-number", "email", "email", "claim:issuing"]);

    const [reserveFilter, reserveUpdate] = h.aptUpdateMany.mock.calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(reserveFilter).toMatchObject({
      "thirdPartyBilling.orgInvoiceId": { $exists: false },
      "thirdPartyBilling.orgStatus": "unbilled",
      "thirdPartyBilling.kind": "organization",
    });
    expect(reserveUpdate.$set).toMatchObject({ "thirdPartyBilling.orgStatus": "invoiced" });

    const numbered = h.invUpdateOne.mock.calls.find((c) => (c[1] as { $set?: { number?: string } }).$set?.number)!;
    const set = (numbered[1] as { $set: Record<string, unknown> }).$set;
    expect(set.dueAt).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
    expect(set.billTo).toMatchObject({ name: "PAE Desjardins", emails: ["factu@pae.ca", "rh@pae.ca"] });

    const sent = h.invFindOneAndUpdate.mock.calls.at(-1)![1] as { $set: Record<string, unknown>; $push: { sendLog: Record<string, unknown> } };
    expect(sent.$set.status).toBe("sent");
    expect(sent.$push.sendLog).toMatchObject({ kind: "sent", to: ["factu@pae.ca", "rh@pae.ca"], at: NOW });
  });

  it("sends nothing, reserves nothing and numbers nothing without every client's consent", async () => {
    h.consent = "withdrawn";
    const r = await issue();
    expect(r).toMatchObject({ ok: false, status: 409, code: "CONSENT_MISSING" });
    expect((r as { details: { blocked: unknown[] } }).details.blocked).toHaveLength(2);
    expect(h.calls).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses a draft whose sessions changed since it was built", async () => {
    h.snapshots = [snapshot(A1), snapshot(A2, 12000)];
    expect(await issue()).toMatchObject({ code: "DRAFT_STALE" });
    expect(h.calls).toEqual([]);
  });

  it("refuses without a billing address", async () => {
    h.org = { ...h.org, billingEmails: [] };
    expect(await issue()).toMatchObject({ code: "NO_BILLING_EMAIL" });
    expect(h.calls).toEqual([]);
  });

  it("puts everything back when a session is already on another invoice — and burns no number", async () => {
    h.reservedCount = 1;
    const r = await issue();
    expect(r).toMatchObject({ code: "SESSIONS_TAKEN" });
    expect(h.calls).toEqual(["claim:draft", "reserve", "release-or-mark"]);
    const release = h.aptUpdateMany.mock.calls[1] as [Record<string, unknown>, Record<string, unknown>];
    expect(release[0]).toEqual({ "thirdPartyBilling.orgInvoiceId": INV });
    expect(release[1]).toMatchObject({ $set: { "thirdPartyBilling.orgStatus": "unbilled" } });
    expect(h.invUpdateOne).toHaveBeenCalledWith({ _id: INV }, { $set: { status: "draft" } });
  });

  it("stays issuing (numbered, reserved) when no email could go out, and a retry just sends", async () => {
    h.delivered = false;
    expect(await issue()).toMatchObject({ status: 502, code: "EMAIL_FAILED" });
    expect(h.calls).not.toContain("claim:issuing");

    // Retry: already issuing — no second claim, reservation or number.
    h.calls = [];
    h.delivered = true;
    h.invoice = { ...h.invoice, status: "issuing", number: "JCO-2026-000007" };
    const r = await issue();
    expect(r.ok).toBe(true);
    expect(h.calls).toEqual(["email", "email", "claim:issuing"]);
  });

  it("refuses an invoice already sent", async () => {
    h.invoice = { ...h.invoice, status: "sent" };
    expect(await issue()).toMatchObject({ code: "NOT_A_DRAFT" });
  });
});

describe("voidInvoice", () => {
  it("discards a draft outright — nothing left, nothing to release", async () => {
    const r = await voidInvoice({ invoiceId: String(INV), reason: "", byUserId: ADMIN });
    expect(r).toEqual({ ok: true, invoice: null });
    expect(h.invDeleteOne).toHaveBeenCalled();
    expect(h.aptUpdateMany).not.toHaveBeenCalled();
  });

  it("voids a sent invoice, frees its key and makes its sessions billable again", async () => {
    h.invoice = { ...h.invoice, status: "sent", number: "JCO-2026-000007" };
    const r = await voidInvoice({ invoiceId: String(INV), reason: "Erreur de tarif", byUserId: ADMIN, now: NOW });
    expect(r.ok).toBe(true);
    const update = h.invFindOneAndUpdate.mock.calls[0][1] as { $set: Record<string, unknown> };
    expect(update.$set).toMatchObject({ status: "void", voidReason: "Erreur de tarif" });
    expect(update.$set.draftKey).toBe(`statement:${ORG}:2026-09#void-${INV}`);
    expect(update.$set).not.toHaveProperty("number");
    expect(h.aptUpdateMany.mock.calls[0][0]).toEqual({ "thirdPartyBilling.orgInvoiceId": INV });
  });

  it("refuses once money was received", async () => {
    h.invoice = { ...h.invoice, status: "partially_paid", paidCents: 5000 };
    expect(await voidInvoice({ invoiceId: String(INV), reason: "", byUserId: ADMIN })).toMatchObject({ code: "CANNOT_VOID" });
    expect(h.aptUpdateMany).not.toHaveBeenCalled();
  });
});

describe("recordOrganizationPayment", () => {
  beforeEach(() => {
    h.invoice = { ...h.invoice, status: "sent", number: "JCO-2026-000007" };
  });
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
    expect(h.invFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op for a payment already recorded (same external reference)", async () => {
    h.invoice = { ...h.invoice, payments: [{ externalRef: "pi_1", amountCents: 18000 }] };
    expect(await pay(18000, "pi_1")).toMatchObject({ ok: true });
    expect(h.invFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("a full payment marks the invoice and its sessions paid", async () => {
    h.invFindOneAndUpdate.mockResolvedValueOnce({ ...h.invoice, paidCents: 18000, balanceCents: 0 });
    const r = await pay(18000);
    expect(r.ok).toBe(true);
    const [filter, update] = h.invFindOneAndUpdate.mock.calls[0] as [Record<string, unknown>, { $inc: Record<string, number> }];
    expect(filter).toMatchObject({ balanceCents: { $gte: 18000 } });
    expect(update.$inc).toEqual({ paidCents: 18000, balanceCents: -18000 });
    expect(h.invUpdateOne).toHaveBeenCalledWith({ _id: INV }, { $set: { status: "paid" } });
    expect(h.aptUpdateMany).toHaveBeenCalledWith(
      { "thirdPartyBilling.orgInvoiceId": INV },
      { $set: { "thirdPartyBilling.orgStatus": "paid", "thirdPartyBilling.orgPaidAt": NOW } },
    );
  });

  it("a partial payment leaves the sessions invoiced", async () => {
    h.invFindOneAndUpdate.mockResolvedValueOnce({ ...h.invoice, paidCents: 9000, balanceCents: 9000 });
    await pay(9000);
    expect(h.invUpdateOne).toHaveBeenCalledWith({ _id: INV }, { $set: { status: "partially_paid" } });
    expect(h.aptUpdateMany).not.toHaveBeenCalled();
  });
});

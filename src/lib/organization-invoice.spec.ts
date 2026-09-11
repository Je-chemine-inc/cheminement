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
  // A deleted draft, as findOneAndDelete returns it.
  deleted: null as Record<string, unknown> | null,
  invFindOneAndDelete: vi.fn(),
  aptUpdateMany: vi.fn(),
  send: vi.fn(),
  // The organization's own form (phase 7).
  storedForm: null as { data: Buffer } | null,
  fileDeleteOne: vi.fn(async () => ({})),
  // Sessions a draft is rebuilt from (linesFor).
  billable: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/Profile", () => ({
  default: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));
vi.mock("@/models/StoredFile", () => ({
  default: {
    findOne: () => ({
      select: () => ({
        lean: async () => {
          h.calls.push("load-form");
          return h.storedForm;
        },
      }),
    }),
    deleteOne: h.fileDeleteOne,
  },
}));
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
      findOneAndDelete: h.invFindOneAndDelete,
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
    // staleLines reads the snapshots (select → lean); linesFor rebuilds a
    // draft from the billable sessions (select → populate → sort → lean).
    find: () => {
      let rebuilding = false;
      const q = {
        select: () => q,
        populate: () => {
          rebuilding = true;
          return q;
        },
        sort: () => q,
        lean: async () => (rebuilding ? h.billable : h.snapshots),
      };
      return q;
    },
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
  draftStatement,
  issueAndSend,
  voidInvoice,
  resendInvoice,
} from "@/lib/organization-invoice";
import { linesFingerprint, sha256Hex } from "@/lib/organization-invoice-form";

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

// The organization's own form, attached to the invoice's two lines.
const FORM_FILE = new mongoose.Types.ObjectId("0123456789abcdef0123456f");
const FORM_BYTES = Buffer.from("%PDF-1.4 formulaire PAE rempli");
const attachedForm = (over: Record<string, unknown> = {}) => ({
  fileId: FORM_FILE,
  fileName: "Formulaire Léa Roy (interne).pdf",
  size: FORM_BYTES.length,
  sha256: sha256Hex(FORM_BYTES),
  scanStatus: "clean",
  linesFingerprint: linesFingerprint([line(A1), line(A2)]),
  uploadedAt: NOW,
  ...over,
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
  h.deleted = null;
  h.invFindOneAndDelete.mockReset();
  h.invFindOneAndDelete.mockImplementation(() => ({ select: () => ({ lean: async () => h.deleted }) }));
  h.storedForm = null;
  h.fileDeleteOne.mockClear();
  h.billable = [];
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
    expect(set.payToken).toMatch(/^[a-f0-9]{64}$/);
    const email = h.send.mock.calls[0][0] as { payUrl: string; interacEmail: string };
    expect(email.payUrl).toContain(`/org-pay?token=${set.payToken as string}&lang=fr`);
    expect(email.interacEmail).toBe("paiement@jechemine.ca");

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
    expect(h.invFindOneAndDelete).toHaveBeenCalledWith({ _id: INV, status: "draft" });
    expect(h.aptUpdateMany).not.toHaveBeenCalled();
    expect(h.fileDeleteOne).not.toHaveBeenCalled();
  });

  it("discarding a draft deletes its form: it never left", async () => {
    h.deleted = { _id: INV, attachment: { fileId: FORM_FILE } };
    await voidInvoice({ invoiceId: String(INV), reason: "", byUserId: ADMIN });
    expect(h.fileDeleteOne).toHaveBeenCalledWith({ _id: FORM_FILE, kind: "organization-form" });
  });

  it("voiding a sent invoice keeps its form: it is the record of what went out", async () => {
    h.invoice = { ...h.invoice, status: "sent", number: "JCO-2026-000007", attachment: attachedForm() };
    const r = await voidInvoice({ invoiceId: String(INV), reason: "Erreur", byUserId: ADMIN, now: NOW });
    expect(r.ok).toBe(true);
    expect(h.fileDeleteOne).not.toHaveBeenCalled();
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

  it("voids an invoice whose money all went back, so its sessions can go to another payer", async () => {
    h.invoice = { ...h.invoice, status: "refunded", paidCents: 0, number: "JCO-2026-000007" };
    const r = await voidInvoice({ invoiceId: String(INV), reason: "Pas couvert", byUserId: ADMIN, now: NOW });
    expect(r.ok).toBe(true);
    expect(h.invFindOneAndUpdate.mock.calls[0][0]).toMatchObject({ status: "refunded", paidCents: 0 });
  });

  it("refuses while a refund is not settled yet", async () => {
    h.invoice = { ...h.invoice, status: "sent", number: "JCO-2026-000007", refunds: [{ status: "pending" }] };
    expect(await voidInvoice({ invoiceId: String(INV), reason: "", byUserId: ADMIN })).toMatchObject({ code: "REFUND_IN_PROGRESS" });
    expect(h.invFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refuses while the organization's bank debit is on its way — the money would land on a void invoice", async () => {
    h.invoice = {
      ...h.invoice,
      status: "sent",
      number: "JCO-2026-000007",
      pendingDebit: { paymentIntentId: "pi_debit", amountCents: 9000, since: NOW },
    };
    expect(await voidInvoice({ invoiceId: String(INV), reason: "", byUserId: ADMIN })).toMatchObject({ code: "DEBIT_PENDING" });
    expect(h.invFindOneAndUpdate).not.toHaveBeenCalled();
    expect(h.aptUpdateMany).not.toHaveBeenCalled();
  });

  it("the void itself is conditional on no debit having started since the read", async () => {
    h.invoice = { ...h.invoice, status: "sent", number: "JCO-2026-000007" };
    await voidInvoice({ invoiceId: String(INV), reason: "Erreur", byUserId: ADMIN, now: NOW });
    expect(h.invFindOneAndUpdate.mock.calls[0][0]).toMatchObject({
      "pendingDebit.paymentIntentId": { $exists: false },
    });
  });
});

/**
 * Phase 7 — some organizations want their own claim form with each invoice.
 * For them nothing goes out until it is attached, unless an admin sends
 * without it on purpose (recorded). The form goes out under a fixed name.
 */
describe("issueAndSend — the organization's own form", () => {
  const sentLog = () =>
    (h.invFindOneAndUpdate.mock.calls.at(-1)![1] as { $push: { sendLog: Record<string, unknown> } }).$push.sendLog;

  it("refuses when the organization requires its form and none is attached — before anything is reserved", async () => {
    h.org = { ...h.org, requiresOwnForm: true, formNotes: "Formulaire PAE-12, signé" };
    const r = await issue();
    expect(r).toMatchObject({ ok: false, status: 409, code: "OWN_FORM_MISSING" });
    expect((r as { details: { formNotes: string } }).details.formNotes).toBe("Formulaire PAE-12, signé");
    expect(h.calls).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("an admin may send without it: the decision is recorded and nothing else is attached", async () => {
    h.org = { ...h.org, requiresOwnForm: true };
    const r = await issueAndSend({ invoiceId: String(INV), byUserId: ADMIN, now: NOW, withoutOwnForm: true });
    expect(r.ok).toBe(true);
    expect((h.send.mock.calls[0][0] as { formPdf: unknown }).formPdf).toBeNull();
    expect(sentLog()).toMatchObject({ kind: "sent", withoutOwnForm: true });
    expect(sentLog()).not.toHaveProperty("attachment");
    expect(h.calls).not.toContain("load-form");
  });

  it("with the form: claimed, reserved and numbered first, then the form is read and goes out under a fixed name", async () => {
    h.org = { ...h.org, requiresOwnForm: true };
    h.invoice = { ...h.invoice, attachment: attachedForm() };
    h.storedForm = { data: FORM_BYTES };
    const r = await issue();
    expect(r.ok).toBe(true);
    expect(h.calls).toEqual([
      "claim:draft", "reserve", "number", "store-number", "load-form", "email", "email", "claim:issuing",
    ]);
    const email = h.send.mock.calls[0][0] as { formPdf: Buffer };
    expect(Buffer.compare(email.formPdf, FORM_BYTES)).toBe(0);
    expect(sentLog()).toMatchObject({
      kind: "sent",
      attachment: {
        fileId: FORM_FILE,
        // Never the uploaded name, which may carry a patient's name.
        fileName: "JCO-2026-000007-formulaire.pdf",
        size: FORM_BYTES.length,
        sha256: sha256Hex(FORM_BYTES),
      },
    });
    expect(sentLog()).not.toHaveProperty("withoutOwnForm");
  });

  it("refuses a form attached before the sessions changed, before anything is reserved", async () => {
    h.org = { ...h.org, requiresOwnForm: true };
    h.invoice = { ...h.invoice, attachment: attachedForm({ linesFingerprint: "attached-to-other-lines" }) };
    expect(await issue()).toMatchObject({ status: 409, code: "OWN_FORM_STALE" });
    expect(h.calls).toEqual([]);
  });

  it("without every client's consent the form is not even read", async () => {
    h.consent = "withdrawn";
    h.invoice = { ...h.invoice, attachment: attachedForm() };
    h.storedForm = { data: FORM_BYTES };
    expect(await issue()).toMatchObject({ code: "CONSENT_MISSING" });
    expect(h.calls).not.toContain("load-form");
  });

  it("a form whose bytes changed is not sent; the invoice stays issuing with its number", async () => {
    h.invoice = { ...h.invoice, attachment: attachedForm() };
    h.storedForm = { data: Buffer.from("%PDF-1.4 un autre fichier") };
    expect(await issue()).toMatchObject({ status: 409, code: "OWN_FORM_UNAVAILABLE" });
    expect(h.calls).toEqual(["claim:draft", "reserve", "number", "store-number", "load-form"]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("an organization that asks for no form gets the invoice alone", async () => {
    await issue();
    expect((h.send.mock.calls[0][0] as { formPdf: unknown }).formPdf).toBeNull();
    expect(sentLog()).not.toHaveProperty("attachment");
    expect(sentLog()).not.toHaveProperty("withoutOwnForm");
  });
});

describe("resendInvoice — the organization's own form", () => {
  const resend = (withoutOwnForm?: boolean) =>
    resendInvoice({ invoiceId: String(INV), byUserId: ADMIN, now: NOW, withoutOwnForm });
  const resentLog = () =>
    (h.invFindByIdAndUpdate.mock.calls.at(-1)![1] as { $push: { sendLog: Record<string, unknown> } }).$push.sendLog;

  beforeEach(() => {
    // A sent invoice has its number and its pay link.
    h.invoice = { ...h.invoice, status: "sent", number: "JCO-2026-000007", payToken: "a".repeat(64) };
  });

  it("refuses without the form the organization requires", async () => {
    h.org = { ...h.org, requiresOwnForm: true };
    expect(await resend()).toMatchObject({ code: "OWN_FORM_MISSING" });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("sends the form attached since, and records it", async () => {
    h.org = { ...h.org, requiresOwnForm: true, language: "en" };
    h.invoice = { ...h.invoice, attachment: attachedForm() };
    h.storedForm = { data: FORM_BYTES };
    expect((await resend()).ok).toBe(true);
    expect(resentLog()).toMatchObject({ kind: "resent", attachment: { fileName: "JCO-2026-000007-form.pdf" } });
  });

  it("records a resend without the form, on purpose", async () => {
    h.org = { ...h.org, requiresOwnForm: true };
    expect((await resend(true)).ok).toBe(true);
    expect(resentLog()).toMatchObject({ kind: "resent", withoutOwnForm: true });
  });
});

describe("drafts dropped with their form", () => {
  it("an emptied draft goes, and its form with it", async () => {
    h.billable = [];
    h.deleted = { _id: INV, attachment: { fileId: FORM_FILE } };
    expect(await draftStatement(String(ORG), "2026-09")).toBeNull();
    expect(h.invFindOneAndDelete).toHaveBeenCalledWith({ draftKey: `statement:${ORG}:2026-09`, status: "draft" });
    expect(h.fileDeleteOne).toHaveBeenCalledWith({ _id: FORM_FILE, kind: "organization-form" });
  });
});

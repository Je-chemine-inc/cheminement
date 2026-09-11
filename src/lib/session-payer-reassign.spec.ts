import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

/**
 * Spec 002 — an admin changes who pays for a CLOSED session. Money must never
 * move twice: a paid client or an invoiced organization is refused, the
 * professional's change is an adjustment row (never a rewrite), a cap slot is
 * taken or given back exactly once, and the client is emailed only when what
 * they owe changed.
 */

const h = vi.hoisted(() => ({
  apt: null as Record<string, unknown> | null,
  coverage: null as Record<string, unknown> | null,
  org: null as Record<string, unknown> | null,
  modified: 1,
  updateOne: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(async () => true),
  ledgerExists: true,
  ledgerCreate: vi.fn(async () => ({})),
  receiptDelete: vi.fn(async () => ({})),
  piCancel: vi.fn(async () => ({})),
  sideEffects: vi.fn(async () => undefined),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/stripe", () => ({ stripe: { paymentIntents: { cancel: h.piCancel } } }));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => ({ select: async () => h.apt }),
    updateOne: h.updateOne,
  },
}));
vi.mock("@/models/Organization", () => ({
  default: { findById: vi.fn(async () => h.org) },
}));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: {
    exists: vi.fn(async () => (h.ledgerExists ? { _id: "l1" } : null)),
    create: h.ledgerCreate,
  },
}));
vi.mock("@/models/ClientReceipt", () => ({ default: { deleteOne: h.receiptDelete } }));
vi.mock("@/lib/session-post-closure", () => ({
  runSessionClosureSideEffects: h.sideEffects,
}));
vi.mock("@/lib/organization-coverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/organization-coverage")>();
  return {
    ...actual,
    findApplicableCoverage: vi.fn(async () => h.coverage),
    reserveCoverageSlot: h.reserve,
    releaseCoverageSlot: h.release,
  };
});

import { reassignSessionPayer } from "@/lib/session-payer-reassign";

const APT_ID = new mongoose.Types.ObjectId("0123456789abcdef01234569");
const ORG_ID = new mongoose.Types.ObjectId("0123456789abcdef01234567");
const COV_ID = new mongoose.Types.ObjectId("0123456789abcdef01234568");
const PRO_ID = new mongoose.Types.ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb");
const ADMIN_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PLANNED_AT = new Date("2026-09-10T16:00:00Z");
const NOW = new Date("2026-09-11T15:00:00Z");

/** A session held at closure: nothing charged, pro credited 108 provisionally. */
const heldSnapshot = (over: Record<string, unknown> = {}) => ({
  kind: "organization",
  state: "awaiting_decision",
  reason: "declaration_pending",
  listPriceCents: 12000,
  orgAmountCents: 12000,
  clientAmountCents: 0,
  proBasisCents: 12000,
  proPayoutTotalCents: 10800,
  plannedAt: PLANNED_AT,
  ...over,
});

const run = (decision: "organization" | "client" | "external") =>
  reassignSessionPayer({
    appointmentId: String(APT_ID),
    decision,
    adminUserId: ADMIN_ID,
    now: NOW,
  });

const lastSet = () =>
  (h.updateOne.mock.calls.at(-1)?.[1] as { $set: Record<string, unknown> }).$set;
const lastFilter = () => h.updateOne.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  h.apt = {
    _id: APT_ID,
    clientId: "client-1",
    professionalId: PRO_ID,
    bookingFor: "self",
    date: new Date("2026-09-10T12:00:00Z"),
    sessionCompletedAt: PLANNED_AT,
    sessionOutcome: "completed",
    payment: { price: 0, platformFee: 0, professionalPayout: 0, status: "covered", method: "card" },
    thirdPartyBilling: heldSnapshot(),
  };
  h.coverage = {
    _id: COV_ID,
    organizationId: ORG_ID,
    mode: "full",
    caseNumber: "PAE-4471",
    consent: { status: "given" },
    consumedAppointmentIds: [],
  };
  h.org = { _id: ORG_ID, name: "PAE Desjardins", gapPolicy: "client_copay", active: true };
  h.modified = 1;
  h.updateOne.mockReset();
  h.updateOne.mockImplementation(async () => ({ modifiedCount: h.modified }));
  h.reserve.mockReset();
  h.release.mockClear();
  h.ledgerExists = true;
  h.ledgerCreate.mockClear();
  h.receiptDelete.mockClear();
  h.piCancel.mockClear();
  h.sideEffects.mockClear();
});

describe("reassignSessionPayer — refusals (nothing is written)", () => {
  it("refuses a session that is not closed yet", async () => {
    h.apt = { ...h.apt, sessionCompletedAt: null };
    expect(await run("client")).toMatchObject({ ok: false, status: 409, code: "NOT_CLOSED" });
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it.each(["paid", "processing", "refunded", "partially_refunded"])(
    "refuses when the client's payment is %s (refund first)",
    async (status) => {
      h.apt = { ...h.apt, payment: { price: 120, status } };
      expect(await run("organization")).toMatchObject({ code: "CLIENT_ALREADY_PAID" });
      expect(h.updateOne).not.toHaveBeenCalled();
    },
  );

  it("refuses a session already on an organization invoice (void it first)", async () => {
    h.apt = { ...h.apt, thirdPartyBilling: heldSnapshot({ orgInvoiceId: ORG_ID }) };
    expect(await run("client")).toMatchObject({ code: "ON_ORGANIZATION_INVOICE" });
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("keeps a no-show on the client, whatever the admin picks", async () => {
    h.apt = { ...h.apt, sessionOutcome: "no_show" };
    expect(await run("organization")).toMatchObject({ code: "LATE_OR_NO_SHOW_IS_CLIENTS" });
    expect(await run("external")).toMatchObject({ code: "LATE_OR_NO_SHOW_IS_CLIENTS" });
  });

  it("cannot bill an organization with no coverage, an archived org, or no consent", async () => {
    h.coverage = null;
    expect(await run("organization")).toMatchObject({ code: "NO_COVERAGE" });
    h.coverage = { _id: COV_ID, organizationId: ORG_ID, mode: "full", consumedAppointmentIds: [], consent: { status: "given" } };
    h.org = { ...h.org, active: false };
    expect(await run("organization")).toMatchObject({ code: "NO_ACTIVE_ORGANIZATION" });
    h.org = { ...h.org, active: true };
    h.coverage = { ...h.coverage, consent: { status: "withdrawn" } };
    expect(await run("organization")).toMatchObject({ code: "CONSENT_MISSING" });
    expect(h.updateOne).not.toHaveBeenCalled();
  });
});

describe("reassignSessionPayer — decisions", () => {
  it("confirms a held session as the organization's, without emailing the client", async () => {
    const r = await run("organization");
    expect(r).toMatchObject({ ok: true, ledgerAdjustmentCents: 0 });
    const set = lastSet();
    expect(set["payment.status"]).toBe("covered");
    expect(set["payment.price"]).toBe(0);
    expect(set.thirdPartyBilling).toMatchObject({
      kind: "organization",
      state: "confirmed",
      orgAmountCents: 12000,
      caseNumber: "PAE-4471",
      resolvedAt: NOW,
    });
    expect(String((set.billingOverride as { setBy: unknown }).setBy)).toBe(ADMIN_ID);
    // The client's side did not change: no payment request, no receipt.
    expect(h.sideEffects).not.toHaveBeenCalled();
    expect(h.ledgerCreate).not.toHaveBeenCalled();
  });

  it("pins the write to the snapshot it read, so a double click applies once", async () => {
    await run("organization");
    expect(lastFilter()).toMatchObject({
      _id: APT_ID,
      "thirdPartyBilling.plannedAt": PLANNED_AT,
      "thirdPartyBilling.orgInvoiceId": { $exists: false },
      "payment.status": { $nin: ["paid", "processing", "refunded", "partially_refunded"] },
    });
  });

  it("hands the session to the client: full price owed, request sent, stale payment cancelled", async () => {
    h.apt = {
      ...h.apt,
      payment: { ...(h.apt!.payment as object), stripePaymentIntentId: "pi_old" },
    };
    const r = await run("client");
    expect(r).toMatchObject({ ok: true });
    const set = lastSet();
    expect(set["payment.price"]).toBe(120);
    expect(set["payment.status"]).toBe("pending");
    expect(set.thirdPartyBilling).toMatchObject({ kind: "client", orgAmountCents: 0 });
    expect(h.piCancel).toHaveBeenCalledWith("pi_old");
    expect(h.receiptDelete).toHaveBeenCalledWith({ appointmentId: APT_ID, status: "pending_transfer" });
    expect(h.sideEffects).toHaveBeenCalledWith(String(APT_ID));
  });

  it("records a session settled outside the platform as paid, with the payer's name", async () => {
    await run("external");
    const set = lastSet();
    expect(set["payment.status"]).toBe("paid");
    expect(set["payment.method"]).toBe("manual");
    expect(set["payment.paidAt"]).toEqual(NOW);
    expect(set.thirdPartyBilling).toMatchObject({
      kind: "external",
      externalPayerLabel: "PAE Desjardins",
    });
    // The side effects issue the client's receipt « Réglé hors plateforme ».
    expect(h.sideEffects).toHaveBeenCalled();
  });
});

describe("reassignSessionPayer — the professional's ledger", () => {
  it("adds an adjustment row when what the pro is owed changes, never rewriting the credit", async () => {
    // Closed on "clinic absorbs, pro paid on the org rate": pro got 81 of a 90 rate.
    h.apt = {
      ...h.apt,
      thirdPartyBilling: heldSnapshot({
        state: "confirmed",
        orgAmountCents: 9000,
        proBasisCents: 9000,
        proPayoutTotalCents: 8100,
      }),
    };
    const r = await run("client");
    expect(r).toMatchObject({ ok: true, ledgerAdjustmentCents: 2700 });
    expect(h.ledgerCreate).toHaveBeenCalledTimes(1);
    const row = (h.ledgerCreate.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(row).toMatchObject({
      professionalId: PRO_ID,
      entryKind: "credit",
      adjustsAppointmentId: APT_ID,
      netToProfessionalCad: 27,
      grossAmountCad: 0,
    });
    // No appointmentId: that key is unique to the session's original credit.
    expect(row.appointmentId).toBeUndefined();
  });

  it("writes no adjustment when no credit exists yet — the side effects write the full one", async () => {
    h.ledgerExists = false;
    h.apt = {
      ...h.apt,
      thirdPartyBilling: heldSnapshot({ proBasisCents: 9000, proPayoutTotalCents: 8100 }),
    };
    await run("organization");
    expect(h.ledgerCreate).not.toHaveBeenCalled();
    expect(h.sideEffects).toHaveBeenCalled();
  });
});

describe("reassignSessionPayer — the session cap", () => {
  beforeEach(() => {
    h.coverage = { ...h.coverage, maxSessions: 6 };
  });

  it("takes a slot when the organization now pays", async () => {
    h.reserve.mockResolvedValue({ granted: true, used: 3, max: 6, exhaustedNow: false });
    await run("organization");
    expect(h.reserve).toHaveBeenCalledWith(COV_ID, APT_ID);
    expect(lastSet().thirdPartyBilling).toMatchObject({ consumedCapSlot: true });
  });

  it("refuses when the coverage has no slot left", async () => {
    h.reserve.mockResolvedValue({ granted: false });
    expect(await run("organization")).toMatchObject({ code: "CAP_REACHED" });
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("gives the slot back when the session moves to the client", async () => {
    h.coverage = { ...h.coverage, consumedAppointmentIds: [APT_ID] };
    await run("client");
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledWith(COV_ID, APT_ID, NOW);
  });

  it("does not take the slot twice for a session that already holds it", async () => {
    h.coverage = { ...h.coverage, consumedAppointmentIds: [APT_ID] };
    await run("organization");
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
  });

  it("returns a slot it just took when the session changed meanwhile", async () => {
    h.reserve.mockResolvedValue({ granted: true, used: 3, max: 6, exhaustedNow: false });
    h.modified = 0;
    expect(await run("organization")).toMatchObject({ code: "CHANGED_MEANWHILE" });
    expect(h.release).toHaveBeenCalledWith(COV_ID, APT_ID, NOW);
    expect(h.ledgerCreate).not.toHaveBeenCalled();
    expect(h.sideEffects).not.toHaveBeenCalled();
  });
});

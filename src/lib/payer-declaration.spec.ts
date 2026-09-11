import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

/**
 * Spec 002 — reviewing what a client declared at booking. Confirming links a
 * coverage (carrying the booking consent) and settles the sessions held on
 * that answer as organization-paid; refusing hands them to the client. A
 * declaration is reviewed once.
 */

const APT = new mongoose.Types.ObjectId("0123456789abcdef01234569");
const CLIENT = new mongoose.Types.ObjectId("0123456789abcdef01234560");
const ORG = "0123456789abcdef01234567";
const OTHER_ORG = "0123456789abcdef0123456f";
const ADMIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const DECLARED_AT = new Date("2026-09-01T10:00:00Z");
const NEW_COV = "cccccccccccccccccccccccc";
const OLD_COV = "dddddddddddddddddddddddd";

const h = vi.hoisted(() => ({
  apt: null as Record<string, unknown> | null,
  existing: null as Record<string, unknown> | null,
  held: [] as Record<string, unknown>[],
  claimModified: 1,
  updateOne: vi.fn(),
  create: vi.fn(),
  reassign: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: async () => h.apt }) }),
    updateOne: h.updateOne,
    find: () => ({ select: () => ({ lean: async () => h.held }) }),
  },
}));
vi.mock("@/models/OrganizationCoverage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/OrganizationCoverage")>()),
  default: {
    findOne: () => ({ select: () => ({ lean: async () => h.existing }) }),
  },
}));
vi.mock("@/lib/coverage-admin", () => ({ createCoverage: h.create }));
vi.mock("@/lib/session-payer-reassign", () => ({ reassignSessionPayer: h.reassign }));

import { confirmPayerDeclaration, rejectPayerDeclaration } from "@/lib/payer-declaration";

const confirm = (organizationId = ORG) =>
  confirmPayerDeclaration({
    appointmentId: String(APT),
    organizationId,
    terms: { mode: "full" },
    adminUserId: ADMIN,
  });

beforeEach(() => {
  h.apt = {
    _id: APT,
    clientId: CLIENT,
    bookingFor: "self",
    payerDeclaration: {
      organizationName: "PAE Desjardins",
      caseNumber: "4471",
      consentGiven: true,
      consentTextVersion: "org-billing-2026-09",
      declaredAt: DECLARED_AT,
      status: "pending",
    },
  };
  h.existing = null;
  h.held = [];
  h.updateOne.mockReset();
  h.updateOne.mockImplementation(async () => ({ modifiedCount: h.claimModified }));
  h.claimModified = 1;
  h.create.mockReset();
  h.create.mockResolvedValue({ ok: true, coverage: { _id: NEW_COV } });
  h.reassign.mockReset();
  h.reassign.mockResolvedValue({ ok: true });
});

describe("confirmPayerDeclaration", () => {
  it("creates the coverage with the consent the client ticked at booking, and the case number", async () => {
    const r = await confirm();
    expect(r).toMatchObject({ ok: true, created: true, coverageId: NEW_COV });
    const args = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect(args).toMatchObject({
      clientId: String(CLIENT),
      beneficiary: "self",
      organizationId: ORG,
      terms: { mode: "full", caseNumber: "4471" },
      consentFromBooking: { at: DECLARED_AT, textVersion: "org-billing-2026-09" },
    });
    // Reviewed once: the claim is conditional on the declaration still pending.
    const [filter, update] = h.updateOne.mock.calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(filter).toMatchObject({ "payerDeclaration.status": "pending" });
    expect(update.$set["payerDeclaration.status"]).toBe("confirmed");
    expect(String(update.$set["payerDeclaration.coverageId"])).toBe(NEW_COV);
  });

  it("links the person's existing coverage with the same organization instead of duplicating it", async () => {
    h.existing = { _id: OLD_COV, organizationId: ORG };
    const r = await confirm();
    expect(r).toMatchObject({ ok: true, created: false, coverageId: OLD_COV });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses when the person is already covered by another organization", async () => {
    h.existing = { _id: OLD_COV, organizationId: OTHER_ORG };
    expect(await confirm()).toMatchObject({ ok: false, code: "COVERED_BY_ANOTHER_ORGANIZATION" });
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a declaration already reviewed, or reviewed meanwhile", async () => {
    h.apt = { ...h.apt, payerDeclaration: { ...(h.apt!.payerDeclaration as object), status: "rejected" } };
    expect(await confirm()).toMatchObject({ code: "ALREADY_REVIEWED" });
    h.apt = { ...h.apt, payerDeclaration: { ...(h.apt!.payerDeclaration as object), status: "pending" } };
    h.claimModified = 0;
    expect(await confirm()).toMatchObject({ code: "ALREADY_REVIEWED" });
    expect(h.reassign).not.toHaveBeenCalled();
  });

  it("settles as organization-paid only the held sessions of the same person", async () => {
    h.held = [
      { _id: "s1", bookingFor: "self" },
      { _id: "s2", bookingFor: "loved-one", lovedOneInfo: { firstName: "Léo", lastName: "X" } },
    ];
    const r = await confirm();
    expect(r).toMatchObject({ ok: true, resolvedHeldSessions: 1 });
    expect(h.reassign).toHaveBeenCalledTimes(1);
    expect(h.reassign.mock.calls[0][0]).toMatchObject({ appointmentId: "s1", decision: "organization" });
  });
});

describe("rejectPayerDeclaration", () => {
  it("records the refusal once and hands held sessions to the client", async () => {
    h.held = [{ _id: "s1", bookingFor: "self" }];
    const r = await rejectPayerDeclaration({ appointmentId: String(APT), reason: "Pas couvert", adminUserId: ADMIN });
    expect(r).toMatchObject({ ok: true, resolvedHeldSessions: 1 });
    const [filter, update] = h.updateOne.mock.calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(filter).toMatchObject({ "payerDeclaration.status": "pending" });
    expect(update.$set).toMatchObject({ "payerDeclaration.status": "rejected", "payerDeclaration.rejectionReason": "Pas couvert" });
    expect(h.reassign.mock.calls[0][0]).toMatchObject({ appointmentId: "s1", decision: "client" });
  });

  it("refuses a second review", async () => {
    h.claimModified = 0;
    h.apt = { ...h.apt, payerDeclaration: { status: "confirmed" } };
    expect(await rejectPayerDeclaration({ appointmentId: String(APT), reason: "", adminUserId: ADMIN })).toMatchObject({ code: "ALREADY_REVIEWED" });
    expect(h.reassign).not.toHaveBeenCalled();
  });
});

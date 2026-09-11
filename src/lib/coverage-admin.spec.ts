import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

/**
 * Spec 002 — admin actions on coverages. One active coverage per person, the
 * cap's used sessions are never rewritten, and consent changes are appended to
 * a log, never overwritten out of existence.
 */

const h = vi.hoisted(() => ({
  client: { _id: "c", role: "client" } as Record<string, unknown> | null,
  org: { _id: "o", active: true } as Record<string, unknown> | null,
  current: null as Record<string, unknown> | null,
  create: vi.fn(),
  findOneAndUpdate: vi.fn(),
  exists: vi.fn(async () => ({ _id: "x" })),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/User", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => h.client }) }) },
}));
vi.mock("@/models/Organization", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => h.org }) }) },
}));
vi.mock("@/models/OrganizationCoverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/models/OrganizationCoverage")>();
  return {
    ...actual,
    default: {
      create: h.create,
      findById: vi.fn(async () => h.current),
      findOneAndUpdate: h.findOneAndUpdate,
      exists: h.exists,
    },
  };
});

import {
  applyConsent,
  createCoverage,
  endCoverage,
  statusForCap,
  updateCoverageTerms,
} from "@/lib/coverage-admin";

const CLIENT = "0123456789abcdef01234560";
const ORG = "0123456789abcdef01234567";
const ADMIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-09-11T15:00:00Z");

beforeEach(() => {
  h.client = { _id: CLIENT, role: "client" };
  h.org = { _id: ORG, active: true };
  h.current = null;
  h.create.mockReset();
  h.create.mockImplementation(async (doc: unknown) => doc);
  h.findOneAndUpdate.mockReset();
  h.findOneAndUpdate.mockImplementation(async () => ({ _id: "cov" }));
  h.exists.mockClear();
});

const create = (over: Partial<Parameters<typeof createCoverage>[0]> = {}) =>
  createCoverage({
    clientId: CLIENT,
    beneficiary: "self",
    organizationId: ORG,
    terms: { mode: "full" },
    adminUserId: ADMIN,
    now: NOW,
    ...over,
  });

describe("createCoverage", () => {
  it("attaches the client themself, with no consent until one is recorded", async () => {
    const r = await create();
    expect(r.ok).toBe(true);
    const doc = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc).toMatchObject({ clientId: CLIENT, beneficiaryKey: "self", organizationId: ORG, status: "active" });
    expect(doc).not.toHaveProperty("consent");
  });

  it("keys a loved one by name, so the guardian's own sessions are not billed to it", async () => {
    await create({ beneficiary: { firstName: "Léa", lastName: "Roy" } });
    const doc = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.beneficiaryKey).not.toBe("self");
    expect(String(doc.beneficiaryKey)).toMatch(/^loved-one:/);
    expect(doc.beneficiaryName).toBe("Léa Roy");
  });

  it("records consent given at creation, in the state AND the log, with the text version", async () => {
    await create({ consent: { action: "give", method: "written", note: "Formulaire signé" } });
    const doc = h.create.mock.calls[0][0] as { consent: Record<string, unknown>; consentLog: Record<string, unknown>[] };
    expect(doc.consent).toMatchObject({ status: "given", method: "written", source: "admin_recorded", textVersion: "org-billing-2026-09" });
    expect(doc.consentLog).toHaveLength(1);
    expect(doc.consentLog[0]).toMatchObject({ action: "given", at: NOW });
  });

  it("refuses a second active coverage for the same person", async () => {
    h.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    expect(await create()).toMatchObject({ ok: false, status: 409, code: "ALREADY_COVERED" });
  });

  it("refuses an archived organization, an unknown client, and a split with no terms", async () => {
    h.org = { _id: ORG, active: false };
    expect(await create()).toMatchObject({ code: "ORGANIZATION_ARCHIVED" });
    h.org = { _id: ORG, active: true };
    h.client = null;
    expect(await create()).toMatchObject({ code: "CLIENT_NOT_FOUND" });
    h.client = { _id: CLIENT };
    expect(await create({ terms: { mode: "split" } })).toMatchObject({ code: "SPLIT_TERMS_MISSING" });
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("updateCoverageTerms", () => {
  const used = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  beforeEach(() => {
    h.current = { _id: "cov", status: "active", mode: "full", maxSessions: 6, consumedAppointmentIds: used };
  });

  it("marks the coverage exhausted when the cap is lowered to what is used", async () => {
    await updateCoverageTerms({ coverageId: "cov", terms: { maxSessions: 3 }, adminUserId: ADMIN });
    const [filter, update] = h.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(update.$set.status).toBe("exhausted");
    // Conditional on the used sessions not moving meanwhile — never rewrites them.
    expect(filter.consumedAppointmentIds).toEqual({ $size: 3 });
    expect(update.$set).not.toHaveProperty("consumedAppointmentIds");
  });

  it("reopens an exhausted coverage when the cap is raised", async () => {
    h.current = { ...h.current, status: "exhausted", maxSessions: 3 };
    await updateCoverageTerms({ coverageId: "cov", terms: { maxSessions: 10 }, adminUserId: ADMIN });
    const update = h.findOneAndUpdate.mock.calls[0][1] as { $set: Record<string, unknown> };
    expect(update.$set.status).toBe("active");
  });

  it("clears a cap with $unset, and a new cap gets fresh notices", async () => {
    await updateCoverageTerms({ coverageId: "cov", terms: { maxSessions: null }, adminUserId: ADMIN });
    const update = h.findOneAndUpdate.mock.calls[0][1] as { $unset: Record<string, unknown> };
    expect(update.$unset).toEqual({
      maxSessions: 1,
      lastSessionWarningSentAt: 1,
      exhaustedNotifiedAt: 1,
    });
  });

  it("keeps the notices already sent when the cap does not change", async () => {
    await updateCoverageTerms({ coverageId: "cov", terms: { maxSessions: 6, caseNumber: "X" }, adminUserId: ADMIN });
    const update = h.findOneAndUpdate.mock.calls[0][1] as { $unset?: Record<string, unknown> };
    expect(update.$unset).toBeUndefined();
  });

  it("refuses to edit an ended coverage, or switch to split without terms", async () => {
    h.current = { ...h.current, status: "ended" };
    expect(await updateCoverageTerms({ coverageId: "cov", terms: {}, adminUserId: ADMIN })).toMatchObject({ code: "COVERAGE_ENDED" });
    h.current = { ...h.current, status: "active" };
    expect(await updateCoverageTerms({ coverageId: "cov", terms: { mode: "split" }, adminUserId: ADMIN })).toMatchObject({ code: "SPLIT_TERMS_MISSING" });
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reports a concurrent change instead of overwriting it", async () => {
    h.findOneAndUpdate.mockResolvedValue(null);
    expect(await updateCoverageTerms({ coverageId: "cov", terms: { caseNumber: "X" }, adminUserId: ADMIN })).toMatchObject({ code: "CHANGED_MEANWHILE" });
  });
});

describe("consent and ending", () => {
  it("withdrawal keeps the history: $push to the log, only the state flips", async () => {
    await applyConsent({ coverageId: "cov", consent: { action: "withdraw", note: "Courriel" }, adminUserId: ADMIN, now: NOW });
    const [filter, update] = h.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>, Record<string, Record<string, unknown>>];
    expect(filter["consent.status"]).toBe("given");
    expect(update.$set["consent.status"]).toBe("withdrawn");
    expect(update.$set).not.toHaveProperty("consentLog");
    expect(update.$push.consentLog).toMatchObject({ action: "withdrawn", at: NOW, note: "Courriel" });
  });

  it("refuses to withdraw consent that was never given", async () => {
    h.findOneAndUpdate.mockResolvedValue(null);
    expect(await applyConsent({ coverageId: "cov", consent: { action: "withdraw", note: "x" }, adminUserId: ADMIN })).toMatchObject({ code: "NOT_GIVEN" });
  });

  it("ends a coverage once", async () => {
    await endCoverage({ coverageId: "cov", reason: "Dossier fermé", adminUserId: ADMIN, now: NOW });
    const [filter, update] = h.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(filter.status).toEqual({ $ne: "ended" });
    expect(update.$set).toMatchObject({ status: "ended", endedAt: NOW, endReason: "Dossier fermé" });
    h.findOneAndUpdate.mockResolvedValue(null);
    expect(await endCoverage({ coverageId: "cov", reason: "", adminUserId: ADMIN })).toMatchObject({ code: "COVERAGE_ENDED" });
  });
});

describe("statusForCap", () => {
  it("follows the cap, and an ended coverage stays ended", () => {
    expect(statusForCap("active", 6, 6)).toBe("exhausted");
    expect(statusForCap("exhausted", 3, 6)).toBe("active");
    expect(statusForCap("active", 99, null)).toBe("active");
    expect(statusForCap("ended", 0, 6)).toBe("ended");
  });
});

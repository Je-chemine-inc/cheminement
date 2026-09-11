import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

/**
 * Spec 002 phase 4 — the hourly organization-billing pass. Nothing while the
 * switch is off; each statement drafted once; auto-send only where the
 * organization opted in; the review email claimed per draft, once.
 */

const MONTHLY = new mongoose.Types.ObjectId("0123456789abcdef01234567");
const PER_SESSION = new mongoose.Types.ObjectId("0123456789abcdef01234568");
const S1 = new mongoose.Types.ObjectId("0123456789abcdef01234561");
const NOW = new Date("2026-10-02T13:00:00Z");

const h = vi.hoisted(() => ({
  enabled: true,
  existingKeys: new Set<string>(),
  existingSessionDraft: null as Record<string, unknown> | null,
  orgs: [] as Record<string, unknown>[],
  unannounced: [] as Record<string, unknown>[],
  reviewSent: true,
  draftStatement: vi.fn(),
  draftForSession: vi.fn(),
  issueAndSend: vi.fn(),
  refreshDraft: vi.fn(async () => ({ ok: true })),
  review: vi.fn(),
  invUpdateOne: vi.fn(async (..._args: unknown[]) => ({ modifiedCount: 1 })),
  invUpdateMany: vi.fn(async () => ({ modifiedCount: 0 })),
  dunning: vi.fn(async () => ({ reminders: 0, followUps: 0, reminderFailures: 0, teamAlerts: 0 })),
}));

vi.mock("@/lib/organization-dunning", () => ({ runOrganizationDunning: h.dunning }));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/session-payer-plan", () => ({ isOrganizationBillingEnabled: async () => h.enabled }));
vi.mock("@/lib/notifications", () => ({ sendAdminOrganizationInvoicesReview: h.review }));
vi.mock("@/lib/organization-invoice", () => ({
  billableSessionsFilter: (id: unknown) => ({ org: String(id) }),
  draftForSession: h.draftForSession,
  draftStatement: h.draftStatement,
  issueAndSend: h.issueAndSend,
  refreshDraft: h.refreshDraft,
  unbilledSummary: async () => h.orgs.map((o) => ({ organizationId: String(o._id), sessions: 1, totalCents: 9000 })),
}));
vi.mock("@/models/Appointment", () => ({
  default: { find: () => ({ select: () => ({ lean: async () => [{ _id: S1 }] }) }) },
}));
vi.mock("@/models/Organization", () => ({
  default: {
    find: () => ({ select: () => ({ lean: async () => h.orgs }) }),
  },
}));
vi.mock("@/models/OrganizationInvoice", () => ({
  default: {
    find: (filter: Record<string, unknown>) => ({
      select: () => ({
        lean: async () => ("reviewAlertSentAt" in filter ? h.unannounced : []),
      }),
    }),
    exists: vi.fn(async (f: { draftKey: string }) => (h.existingKeys.has(f.draftKey) ? { _id: "x" } : null)),
    findOne: () => ({ select: () => ({ lean: async () => h.existingSessionDraft }) }),
    updateOne: h.invUpdateOne,
    updateMany: h.invUpdateMany,
  },
}));

import { runOrganizationBilling } from "@/lib/organization-billing-run";

beforeEach(() => {
  h.enabled = true;
  h.existingKeys = new Set();
  h.existingSessionDraft = null;
  h.orgs = [
    { _id: MONTHLY, billingCycle: "monthly", autoSendPerSession: false },
    { _id: PER_SESSION, billingCycle: "per_session", autoSendPerSession: false },
  ];
  h.unannounced = [];
  h.reviewSent = true;
  for (const f of [h.draftStatement, h.draftForSession, h.issueAndSend, h.review, h.invUpdateOne, h.invUpdateMany]) f.mockReset();
  h.draftStatement.mockResolvedValue({ ok: true, invoice: { _id: "st1" } });
  h.draftForSession.mockResolvedValue({ ok: true, invoice: { _id: "se1" } });
  h.issueAndSend.mockResolvedValue({ ok: true });
  h.review.mockImplementation(async () => h.reviewSent);
  h.invUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  h.invUpdateMany.mockResolvedValue({ modifiedCount: 0 });
});

describe("runOrganizationBilling", () => {
  it("does nothing at all while the switch is off", async () => {
    h.enabled = false;
    const r = await runOrganizationBilling(NOW);
    expect(r.skipped).toBe("switch_off");
    expect(h.draftStatement).not.toHaveBeenCalled();
    expect(h.draftForSession).not.toHaveBeenCalled();
    expect(h.invUpdateMany).not.toHaveBeenCalled();
  });

  it("drafts last month's statement for a monthly organization — once", async () => {
    await runOrganizationBilling(NOW);
    expect(h.draftStatement).toHaveBeenCalledWith(String(MONTHLY), "2026-09");
    h.draftStatement.mockClear();
    h.existingKeys.add(`statement:${MONTHLY}:2026-09`);
    await runOrganizationBilling(NOW);
    expect(h.draftStatement).not.toHaveBeenCalled();
  });

  it("drafts per-session invoices without sending them, unless the organization opted in", async () => {
    await runOrganizationBilling(NOW);
    expect(h.draftForSession).toHaveBeenCalledWith(String(S1));
    expect(h.issueAndSend).not.toHaveBeenCalled();

    h.orgs = [{ _id: PER_SESSION, billingCycle: "per_session", autoSendPerSession: true }];
    const r = await runOrganizationBilling(NOW);
    expect(h.issueAndSend).toHaveBeenCalledWith({ invoiceId: "se1", byUserId: null, now: NOW });
    expect(r.autoSent).toBe(1);
  });

  it("never re-drafts a session already issued", async () => {
    h.orgs = [{ _id: PER_SESSION, billingCycle: "per_session", autoSendPerSession: true }];
    h.existingSessionDraft = { _id: "se0", status: "sent" };
    await runOrganizationBilling(NOW);
    expect(h.draftForSession).not.toHaveBeenCalled();
    expect(h.issueAndSend).not.toHaveBeenCalled();
  });

  it("counts an auto-send refused by the consent gate, and carries on", async () => {
    h.orgs = [{ _id: PER_SESSION, billingCycle: "per_session", autoSendPerSession: true }];
    h.issueAndSend.mockResolvedValue({ ok: false, code: "CONSENT_MISSING" });
    const r = await runOrganizationBilling(NOW);
    expect(r).toMatchObject({ autoSent: 0, autoSendRefused: 1 });
  });

  it("tells the team about each new draft once, and retries if the email fails", async () => {
    h.unannounced = [{ _id: "d1", organizationId: MONTHLY, kind: "statement", periodKey: "2026-09", lines: [{}, {}], totalCents: 18000 }];
    const r = await runOrganizationBilling(NOW);
    expect(h.invUpdateOne.mock.calls[0][0]).toMatchObject({ _id: "d1", reviewAlertSentAt: { $exists: false } });
    expect(h.review.mock.calls[0][0]).toEqual({
      items: [{ organizationName: "", kind: "statement", periodKey: "2026-09", sessions: 2, totalCents: 18000 }],
    });
    expect(r.reviewAlerts).toBe(1);

    h.invUpdateMany.mockClear();
    h.reviewSent = false;
    await runOrganizationBilling(NOW);
    expect(h.invUpdateMany).toHaveBeenCalledWith(
      { _id: { $in: ["d1"] } },
      { $unset: { reviewAlertSentAt: 1 } },
    );
  });

  it("marks sent invoices past their due date overdue", async () => {
    await runOrganizationBilling(NOW);
    expect(h.invUpdateMany).toHaveBeenCalledWith(
      { status: "sent", dueAt: { $lt: NOW } },
      { $set: { status: "overdue" } },
    );
  });

  it("chases unpaid invoices every run — and not at all while the switch is off", async () => {
    const r = await runOrganizationBilling(NOW);
    expect(h.dunning).toHaveBeenCalledWith(NOW);
    expect(r.dunning).toMatchObject({ reminders: 0 });

    h.dunning.mockClear();
    h.enabled = false;
    await runOrganizationBilling(NOW);
    expect(h.dunning).not.toHaveBeenCalled();
  });
});

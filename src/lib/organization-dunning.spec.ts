import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

/**
 * Spec 002 phase 5 — chasing an organization's unpaid invoice. One reminder at
 * the due date, one 14 days later, the team at 30 days; each step claimed
 * before its email and given back if nothing went out; reminders carry the
 * number and the balance, never a patient.
 */

const INV = new mongoose.Types.ObjectId("0123456789abcdef0123456e");
const ORG = new mongoose.Types.ObjectId("0123456789abcdef01234567");
const DUE = new Date("2026-10-01T13:00:00Z");
const day = (n: number) => new Date(DUE.getTime() + n * 86_400_000);
// A Wednesday, 11 h in Montréal (15:00 UTC in October).
const WEDNESDAY_11H = new Date("2026-10-14T15:00:00Z");

const h = vi.hoisted(() => ({
  candidates: [] as Record<string, unknown>[],
  findFilter: null as Record<string, unknown> | null,
  claimModified: 1,
  reminderOk: true,
  teamOk: true,
  invUpdateOne: vi.fn(),
  invUpdateMany: vi.fn(async () => ({ modifiedCount: 0 })),
  reminder: vi.fn(),
  team: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/interac-deposit-email", () => ({ getInteracDepositEmail: async () => "paiement@jechemine.ca" }));
vi.mock("@/models/Organization", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: async () => ({ _id: ORG, name: "PAE Desjardins", language: "fr", billingEmails: ["factu@pae.ca"] }) }) }),
    find: () => ({ select: () => ({ lean: async () => [{ _id: ORG, name: "PAE Desjardins" }] }) }),
  },
}));
vi.mock("@/models/OrganizationInvoice", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.findFilter = filter;
      return { select: () => ({ lean: async () => h.candidates }) };
    },
    findById: () => ({ select: () => ({ lean: async () => ({ payToken: "e".repeat(64) }) }) }),
    updateOne: h.invUpdateOne,
    updateMany: h.invUpdateMany,
  },
}));
vi.mock("@/lib/notifications", () => ({
  sendOrganizationPaymentReminderEmail: h.reminder,
  sendAdminOrganizationInvoicesOverdue: h.team,
}));

import { dunningStepFor, isReminderHour, runOrganizationDunning } from "@/lib/organization-dunning";

const invoice = (over: Record<string, unknown> = {}) => ({
  _id: INV,
  organizationId: ORG,
  number: "JCO-2026-000007",
  status: "overdue",
  balanceCents: 18000,
  dueAt: DUE,
  disputed: false,
  reminders: {},
  payToken: "f".repeat(64),
  billTo: { name: "PAE Desjardins", emails: ["factu@pae.ca", "rh@pae.ca"] },
  ...over,
});

beforeEach(() => {
  h.candidates = [];
  h.claimModified = 1;
  h.reminderOk = true;
  h.teamOk = true;
  h.invUpdateOne.mockReset();
  h.invUpdateOne.mockImplementation(async (_f: unknown, update: Record<string, unknown>) =>
    ({ modifiedCount: update.$set ? h.claimModified : 1 }));
  h.invUpdateMany.mockClear();
  h.reminder.mockReset();
  h.reminder.mockImplementation(async () => h.reminderOk);
  h.team.mockReset();
  h.team.mockImplementation(async () => h.teamOk);
});

describe("dunningStepFor", () => {
  const step = (over: Record<string, unknown>, now: Date) => dunningStepFor(invoice(over), now);

  it("nothing before the due date", () => {
    expect(step({ status: "sent" }, day(-1))).toMatchObject({ reminder: null, teamAlert: false });
  });

  it("a first reminder from the due date, the second from 14 days, the team from 30", () => {
    expect(step({}, day(0)).reminder).toBe("due");
    expect(step({ reminders: { dueSentAt: day(0) } }, day(13)).reminder).toBeNull();
    expect(step({ reminders: { dueSentAt: day(0) } }, day(14)).reminder).toBe("follow_up");
    expect(step({ reminders: { dueSentAt: day(0), followUpSentAt: day(14) } }, day(29))).toMatchObject({ reminder: null, teamAlert: false });
    expect(step({ reminders: { dueSentAt: day(0), followUpSentAt: day(14) } }, day(30))).toMatchObject({ reminder: null, teamAlert: true, daysLate: 30 });
    expect(step({ reminders: { dueSentAt: day(0), followUpSentAt: day(14), overdueAlertSentAt: day(30) } }, day(60)).teamAlert).toBe(false);
  });

  it("an invoice found two weeks late gets the second reminder, not both", () => {
    expect(step({}, day(20)).reminder).toBe("follow_up");
  });

  it("never chases a paid, void, disputed or fully settled invoice", () => {
    for (const over of [{ status: "paid" }, { status: "void" }, { status: "draft" }, { disputed: true }, { balanceCents: 0 }, { dueAt: null }]) {
      expect(step(over, day(40))).toMatchObject({ reminder: null, teamAlert: false });
    }
  });

  it("still chases a partly paid invoice for what is left", () => {
    expect(step({ status: "partially_paid", balanceCents: 9000 }, day(1)).reminder).toBe("due");
  });

  it("never chases an organization whose bank debit is on its way — nor alerts the team", () => {
    const pendingDebit = { paymentIntentId: "pi_debit", amountCents: 18000, since: day(-1) };
    expect(step({ pendingDebit }, day(0))).toMatchObject({ reminder: null, teamAlert: false });
    expect(step({ pendingDebit, reminders: { dueSentAt: day(0), followUpSentAt: day(14) } }, day(40))).toMatchObject({
      reminder: null,
      teamAlert: false,
    });
  });
});

describe("isReminderHour", () => {
  it("weekdays 8 h – 18 h in Montréal only", () => {
    expect(isReminderHour(WEDNESDAY_11H)).toBe(true);
    expect(isReminderHour(new Date("2026-10-14T11:00:00Z"))).toBe(false); // 7 h
    expect(isReminderHour(new Date("2026-10-14T22:30:00Z"))).toBe(false); // 18 h 30
    expect(isReminderHour(new Date("2026-10-17T15:00:00Z"))).toBe(false); // Saturday
  });
});

describe("runOrganizationDunning", () => {
  it("claims the step before emailing, then logs who was reached", async () => {
    h.candidates = [invoice()];
    const now = WEDNESDAY_11H; // 13 days late
    const r = await runOrganizationDunning(now);

    expect(r.reminders).toBe(1);
    const [claimFilter, claimUpdate] = h.invUpdateOne.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(claimFilter).toMatchObject({
      _id: INV,
      "reminders.dueSentAt": { $exists: false },
      balanceCents: { $gt: 0 },
      disputed: { $ne: true },
      // A debit started between the read and the claim: no reminder after all.
      "pendingDebit.paymentIntentId": { $exists: false },
    });
    expect(claimUpdate).toEqual({ $set: { "reminders.dueSentAt": now } });
    expect(h.reminder).toHaveBeenCalledTimes(2);
    const log = h.invUpdateOne.mock.calls[1][1] as { $push: { sendLog: Record<string, unknown> } };
    expect(log.$push.sendLog).toMatchObject({ kind: "reminder", to: ["factu@pae.ca", "rh@pae.ca"] });
  });

  it("never even looks at an invoice whose bank debit is on its way", async () => {
    await runOrganizationDunning(WEDNESDAY_11H);
    expect(h.findFilter).toMatchObject({ "pendingDebit.paymentIntentId": { $exists: false }, disputed: { $ne: true } });
  });

  it("a reminder names the invoice and the balance — no patient, no PDF", async () => {
    h.candidates = [invoice()];
    await runOrganizationDunning(WEDNESDAY_11H);
    const args = h.reminder.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(
      ["balanceCents", "dueAt", "interacEmail", "locale", "number", "organizationName", "payUrl", "stage", "to"].sort(),
    );
    expect(args).toMatchObject({ stage: "due", number: "JCO-2026-000007", balanceCents: 18000 });
    expect(String(args.payUrl)).toContain(`/org-pay?token=${"f".repeat(64)}`);
  });

  it("sends nothing another run already claimed", async () => {
    h.candidates = [invoice()];
    h.claimModified = 0;
    await runOrganizationDunning(WEDNESDAY_11H);
    expect(h.reminder).not.toHaveBeenCalled();
  });

  it("gives the step back when no email could go out", async () => {
    h.candidates = [invoice()];
    h.reminderOk = false;
    const r = await runOrganizationDunning(WEDNESDAY_11H);
    expect(r.reminderFailures).toBe(1);
    expect(h.invUpdateOne).toHaveBeenLastCalledWith({ _id: INV }, { $unset: { "reminders.dueSentAt": 1 } });
  });

  it("the second reminder also stamps a first one that never went, and gives both back on failure", async () => {
    h.candidates = [invoice()];
    h.reminderOk = false;
    const now = new Date("2026-10-21T15:00:00Z"); // Wednesday, 20 days late
    await runOrganizationDunning(now);
    expect(h.invUpdateOne.mock.calls[0][1]).toEqual({
      $set: { "reminders.followUpSentAt": now, "reminders.dueSentAt": now },
    });
    expect(h.invUpdateOne).toHaveBeenLastCalledWith(
      { _id: INV },
      { $unset: { "reminders.followUpSentAt": 1, "reminders.dueSentAt": 1 } },
    );
  });

  it("waits for office hours to write to an organization, but alerts the team any time", async () => {
    h.candidates = [invoice({ reminders: { dueSentAt: day(0), followUpSentAt: day(14) } })];
    const sundayMorning = new Date("2026-11-01T15:00:00Z"); // 31 days late
    const r = await runOrganizationDunning(sundayMorning);
    expect(h.reminder).not.toHaveBeenCalled();
    expect(r.teamAlerts).toBe(1);
    expect(h.team.mock.calls[0][0]).toEqual({
      items: [{ organizationName: "PAE Desjardins", number: "JCO-2026-000007", balanceCents: 18000, daysLate: 31 }],
    });
  });

  it("a reminder that is due waits for Monday — nothing claimed, nothing sent", async () => {
    h.candidates = [invoice()];
    const sunday = new Date("2026-10-11T15:00:00Z"); // 10 days late, Sunday 11 h
    const r = await runOrganizationDunning(sunday);
    expect(h.reminder).not.toHaveBeenCalled();
    expect(h.invUpdateOne).not.toHaveBeenCalled();
    expect(r.reminders).toBe(0);
  });

  it("the team alert is claimed per invoice and given back if the email fails", async () => {
    h.candidates = [invoice({ reminders: { dueSentAt: day(0), followUpSentAt: day(14) } })];
    h.teamOk = false;
    await runOrganizationDunning(day(31));
    expect(h.invUpdateMany).toHaveBeenCalledWith(
      { _id: { $in: [INV] } },
      { $unset: { "reminders.overdueAlertSentAt": 1 } },
    );
  });
});

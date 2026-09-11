import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));

import {
  agingBucket,
  agingCsv,
  buildAging,
  capIssuesFor,
  daysPastDue,
  debitStateOf,
  paymentReviewFilter,
} from "@/lib/organization-receivables";

/**
 * Spec 002 phase 6 — what organizations owe, by age, and coverage counters
 * that disagree with the sessions actually paid.
 */

const NOW = new Date("2026-10-31T16:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("paymentReviewFilter — money a person must look at", () => {
  const branches = paymentReviewFilter(NOW).$or as Array<Record<string, unknown>>;

  it("an overpayment, a chargeback, money on a void invoice, a refund Stripe never confirmed", () => {
    expect(branches).toContainEqual({ balanceCents: { $lt: 0 } });
    expect(branches).toContainEqual({ disputed: true });
    expect(branches).toContainEqual({ status: "void", paidCents: { $gt: 0 } });
    expect(branches).toContainEqual({
      refunds: { $elemMatch: { status: "requested", at: { $lt: new Date(NOW.getTime() - 15 * 60_000) } } },
    });
  });

  it("an invoice closed by its refunds is not a problem to review", () => {
    // Refunds are made from the screen now: « refunded » is a normal closed state.
    expect(branches).not.toContainEqual({ status: "refunded" });
    expect(branches).toContainEqual({ status: "refunded", balanceCents: { $gt: 0 } });
  });

  it("a bank debit still on its way after 10 days — not one that started this week", () => {
    expect(branches).toContainEqual({ "pendingDebit.since": { $lt: ago(10) } });
  });
});

describe("debitStateOf", () => {
  it("no debit, a debit on its way, one on its way for over 10 days", () => {
    expect(debitStateOf(undefined, NOW)).toBeNull();
    expect(debitStateOf(null, NOW)).toBeNull();
    expect(debitStateOf({ paymentIntentId: "pi_1", since: ago(3) }, NOW)).toBe("pending");
    expect(debitStateOf({ paymentIntentId: "pi_1", since: ago(10) }, NOW)).toBe("pending");
    expect(debitStateOf({ paymentIntentId: "pi_1", since: ago(10.1) }, NOW)).toBe("stuck");
  });
});

describe("agingBucket", () => {
  it("puts a balance in the right age bracket, boundaries included", () => {
    expect(agingBucket(new Date(NOW.getTime() + 1000), NOW)).toBe("current");
    expect(agingBucket(NOW, NOW)).toBe("current");
    expect(agingBucket(null, NOW)).toBe("current");
    expect(agingBucket(ago(0.5), NOW)).toBe("d1_30");
    expect(agingBucket(ago(30), NOW)).toBe("d1_30");
    expect(agingBucket(ago(31), NOW)).toBe("d31_60");
    expect(agingBucket(ago(60), NOW)).toBe("d31_60");
    expect(agingBucket(ago(61), NOW)).toBe("d61_90");
    expect(agingBucket(ago(90), NOW)).toBe("d61_90");
    expect(agingBucket(ago(91), NOW)).toBe("d90_plus");
  });

  it("counts whole days late", () => {
    expect(daysPastDue(ago(14.9), NOW)).toBe(14);
    expect(daysPastDue(null, NOW)).toBe(0);
  });
});

describe("buildAging", () => {
  const inv = (org: string, balanceCents: number, daysLate: number) => ({
    organizationId: org,
    balanceCents,
    dueAt: ago(daysLate),
  });

  it("adds balances per organization and per bracket, with totals", () => {
    const { rows, totals } = buildAging(
      [inv("a", 10000, -5), inv("a", 5000, 45), inv("b", 20000, 10), inv("a", 2500, 100)],
      NOW,
    );
    const a = rows.find((r) => r.organizationId === "a")!;
    expect(a.buckets).toEqual({ current: 10000, d1_30: 0, d31_60: 5000, d61_90: 0, d90_plus: 2500 });
    expect(a).toMatchObject({ totalCents: 17500, invoices: 3 });
    expect(a.oldestDueAt).toEqual(ago(100));
    expect(totals).toEqual({ current: 10000, d1_30: 20000, d31_60: 5000, d61_90: 0, d90_plus: 2500, totalCents: 37500 });
  });

  it("lists the most overdue money first", () => {
    const { rows } = buildAging([inv("big-but-recent", 900000, 5), inv("small-but-old", 100, 120)], NOW);
    expect(rows.map((r) => r.organizationId)).toEqual(["small-but-old", "big-but-recent"]);
  });

  it("leaves credits and settled invoices out — an overpayment is not a receivable", () => {
    const { rows, totals } = buildAging([inv("a", -5000, 10), inv("a", 0, 10)], NOW);
    expect(rows).toEqual([]);
    expect(totals.totalCents).toBe(0);
  });
});

describe("capIssuesFor", () => {
  const holders = (...ids: string[]) => new Set(ids);

  it("a coverage whose counter matches its paid sessions has no issue", () => {
    expect(capIssuesFor({ status: "active", maxSessions: 6, consumedAppointmentIds: ["a1", "a2"] }, holders("a1", "a2"))).toEqual({
      issues: [],
      staleSlots: 0,
    });
    expect(capIssuesFor({ status: "exhausted", maxSessions: 2, consumedAppointmentIds: ["a1", "a2"] }, holders("a1", "a2")).issues).toEqual([]);
    expect(capIssuesFor({ status: "active", consumedAppointmentIds: ["a1"] }, holders("a1")).issues).toEqual([]);
  });

  it("flags more sessions counted than the cap", () => {
    expect(capIssuesFor({ status: "exhausted", maxSessions: 2, consumedAppointmentIds: ["a1", "a2", "a3"] }, holders("a1", "a2", "a3")).issues).toEqual(["over_cap"]);
  });

  it("flags a coverage used up too early, or still open at its cap", () => {
    expect(capIssuesFor({ status: "exhausted", maxSessions: 6, consumedAppointmentIds: ["a1"] }, holders("a1")).issues).toEqual(["exhausted_below_cap"]);
    expect(capIssuesFor({ status: "active", maxSessions: 1, consumedAppointmentIds: ["a1"] }, holders("a1")).issues).toEqual(["active_at_cap"]);
  });

  it("flags counted sessions that no longer use the coverage (reassigned to the client)", () => {
    const r = capIssuesFor({ status: "active", maxSessions: 6, consumedAppointmentIds: ["a1", "a2", "a3"] }, holders("a1"));
    expect(r).toEqual({ issues: ["stale_slot"], staleSlots: 2 });
  });
});

describe("agingCsv", () => {
  it("one line per organization plus a total, in dollars, safely quoted", () => {
    const { rows, totals } = buildAging(
      [
        { organizationId: "a", balanceCents: 12050, dueAt: ago(40) },
        { organizationId: "b", balanceCents: 9000, dueAt: ago(-3) },
      ],
      NOW,
    );
    const csv = agingCsv(rows, totals, (id) => (id === "a" ? 'PAE "Desjardins", inc.' : "École B"));
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Organisme,Factures,Non échu,1-30 j,31-60 j,61-90 j,90 j et +,Total");
    expect(lines).toContain('"PAE ""Desjardins"", inc.",1,0.00,0.00,120.50,0.00,0.00,120.50');
    expect(lines).toContain("École B,1,90.00,0.00,0.00,0.00,0.00,90.00");
    expect(lines.at(-1)).toBe("TOTAL,2,90.00,0.00,120.50,0.00,0.00,210.50");
  });
});

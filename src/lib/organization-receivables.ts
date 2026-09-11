/**
 * What organizations owe, and what in organization billing needs a person
 * (spec 002, phase 6). The aging and cap checks are pure; the loader below
 * gathers the data for the admin screen.
 *
 * Nothing here names a diagnosis, a motif or a note: the lists carry the
 * client's name (the billing admin's own view), dates and amounts only.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Organization from "@/models/Organization";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import { AWAITING_PAYMENT_STATUSES } from "@/lib/organization-invoice-pay-link";

const DAY_MS = 86_400_000;

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Sessions an organization owes for that are still not invoiced after this long. */
export const UNINVOICED_AFTER_DAYS = 35;
/** How far back negative-margin sessions are listed. */
export const NEGATIVE_MARGIN_LOOKBACK_DAYS = 90;
const LIST_LIMIT = 200;

/** Whole days past the due date (0 or less = not yet due). */
export function daysPastDue(dueAt: Date | null | undefined, now: Date): number {
  if (!dueAt) return 0;
  return Math.floor((now.getTime() - new Date(dueAt).getTime()) / DAY_MS);
}

export function agingBucket(dueAt: Date | null | undefined, now: Date): AgingBucket {
  const late = daysPastDue(dueAt, now);
  if (!dueAt || now.getTime() <= new Date(dueAt).getTime()) return "current";
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  if (late <= 90) return "d61_90";
  return "d90_plus";
}

type Buckets = Record<AgingBucket, number>;
const emptyBuckets = (): Buckets => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });

export type AgingRow = {
  organizationId: string;
  buckets: Buckets;
  totalCents: number;
  invoices: number;
  oldestDueAt: Date | null;
};

/**
 * Open balances per organization, by how late they are. Only positive
 * balances count: an overpaid invoice is a credit, listed with the anomalies.
 */
export function buildAging(
  invoices: Array<{ organizationId: unknown; balanceCents: number; dueAt?: Date | null }>,
  now: Date,
): { rows: AgingRow[]; totals: Buckets & { totalCents: number } } {
  const byOrg = new Map<string, AgingRow>();
  const totals = { ...emptyBuckets(), totalCents: 0 };
  for (const inv of invoices) {
    if (!(inv.balanceCents > 0)) continue;
    const id = String(inv.organizationId);
    const row = byOrg.get(id) ?? {
      organizationId: id,
      buckets: emptyBuckets(),
      totalCents: 0,
      invoices: 0,
      oldestDueAt: null,
    };
    const bucket = agingBucket(inv.dueAt, now);
    row.buckets[bucket] += inv.balanceCents;
    row.totalCents += inv.balanceCents;
    row.invoices += 1;
    if (inv.dueAt && (!row.oldestDueAt || new Date(inv.dueAt) < row.oldestDueAt)) {
      row.oldestDueAt = new Date(inv.dueAt);
    }
    byOrg.set(id, row);
    totals[bucket] += inv.balanceCents;
    totals.totalCents += inv.balanceCents;
  }
  // Most overdue money first.
  const lateness = (r: AgingRow) =>
    r.buckets.d90_plus * 1e12 + r.buckets.d61_90 * 1e8 + r.buckets.d31_60 * 1e4 + r.buckets.d1_30;
  const rows = [...byOrg.values()].sort((a, b) => lateness(b) - lateness(a) || b.totalCents - a.totalCents);
  return { rows, totals };
}

export type CapIssue = "over_cap" | "exhausted_below_cap" | "active_at_cap" | "stale_slot";

/**
 * Where a coverage's session count and reality disagree. `slotHolders` is the
 * set of appointment ids that really hold a slot on this coverage (their payer
 * snapshot names it and says a slot was taken).
 */
export function capIssuesFor(
  coverage: { status: string; maxSessions?: number | null; consumedAppointmentIds?: unknown[] },
  slotHolders: Set<string>,
): { issues: CapIssue[]; staleSlots: number } {
  const consumed = (coverage.consumedAppointmentIds ?? []).map(String);
  const max = coverage.maxSessions ?? null;
  const issues: CapIssue[] = [];
  if (max !== null && consumed.length > max) issues.push("over_cap");
  if (coverage.status === "exhausted" && (max === null || consumed.length < max)) {
    issues.push("exhausted_below_cap");
  }
  if (coverage.status === "active" && max !== null && consumed.length >= max) {
    issues.push("active_at_cap");
  }
  const staleSlots = consumed.filter((id) => !slotHolders.has(id)).length;
  if (staleSlots > 0) issues.push("stale_slot");
  return { issues, staleSlots };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dollars = (cents: number) => (cents / 100).toFixed(2);

/** The aging table as CSV (dollars, dot decimal) for the accountant. */
export function agingCsv(
  rows: AgingRow[],
  totals: Buckets & { totalCents: number },
  nameOf: (organizationId: string) => string,
): string {
  const header = ["Organisme", "Factures", "Non échu", "1-30 j", "31-60 j", "61-90 j", "90 j et +", "Total"];
  const line = (name: string, count: number | string, b: Buckets, total: number) =>
    [name, count, ...AGING_BUCKETS.map((k) => dollars(b[k])), dollars(total)].map(csvCell).join(",");
  return [
    header.map(csvCell).join(","),
    ...rows.map((r) => line(nameOf(r.organizationId), r.invoices, r.buckets, r.totalCents)),
    line("TOTAL", rows.reduce((n, r) => n + r.invoices, 0), totals, totals.totalCents),
  ].join("\n");
}

type Person = { _id: unknown; firstName?: string; lastName?: string } | null;
const nameOfPerson = (p: Person) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "");

/** A Stripe refund still unconfirmed after this long needs someone to press « Vérifier ». */
const REFUND_CHECK_AFTER_MS = 15 * 60_000;

/**
 * Invoices whose money a person must look at: an overpayment (money to give
 * back), a chargeback, money kept on a void invoice, a refund Stripe never
 * confirmed. A fully refunded invoice is a normal, closed state — not listed.
 */
export function paymentReviewFilter(now: Date): Record<string, unknown> {
  return {
    $or: [
      { balanceCents: { $lt: 0 } },
      { disputed: true },
      { status: "void", paidCents: { $gt: 0 } },
      // Cannot happen once the status is synced (a full refund still owed goes
      // back to awaiting payment) — listed if it ever does.
      { status: "refunded", balanceCents: { $gt: 0 } },
      {
        refunds: {
          $elemMatch: { status: "requested", at: { $lt: new Date(now.getTime() - REFUND_CHECK_AFTER_MS) } },
        },
      },
    ],
  };
}

/** Everything the "Suivi" panel shows, in one pass. */
export async function loadOrganizationReceivables(now: Date = new Date()) {
  await connectToDatabase();
  const oid = (id: unknown) => new mongoose.Types.ObjectId(String(id));

  const open = await OrganizationInvoice.find({
    status: { $in: AWAITING_PAYMENT_STATUSES },
    balanceCents: { $gt: 0 },
  })
    .select("organizationId number status balanceCents totalCents dueAt reminders disputed")
    .sort({ dueAt: 1 })
    .lean();
  const aging = buildAging(open, now);

  const overdue = open
    .filter((i) => i.dueAt && new Date(i.dueAt) < now)
    .slice(0, LIST_LIMIT)
    .map((i) => ({
      invoiceId: String(i._id),
      organizationId: String(i.organizationId),
      number: i.number ?? "",
      balanceCents: i.balanceCents,
      dueAt: i.dueAt ?? null,
      daysLate: daysPastDue(i.dueAt, now),
      remindersSent: Number(Boolean(i.reminders?.dueSentAt)) + Number(Boolean(i.reminders?.followUpSentAt)),
      disputed: Boolean(i.disputed),
    }));

  const toReview = await OrganizationInvoice.find(paymentReviewFilter(now))
    .select("organizationId number status balanceCents paidCents disputed paymentEvents refunds.status")
    .limit(LIST_LIMIT)
    .lean();
  const paymentReview = toReview.map((i) => ({
    invoiceId: String(i._id),
    organizationId: String(i.organizationId),
    number: i.number ?? "",
    status: i.status,
    balanceCents: i.balanceCents,
    paidCents: i.paidCents,
    disputed: Boolean(i.disputed),
    refundUnconfirmed: (i.refunds ?? []).some((r) => r.status === "requested"),
    lastEvent: i.paymentEvents?.at(-1)?.detail ?? "",
  }));

  const sessionFields =
    "+thirdPartyBilling date clientId sessionCompletedAt bookingFor lovedOneInfo.firstName lovedOneInfo.lastName";
  const sessionRow = (s: {
    _id: unknown;
    date?: Date;
    clientId?: unknown;
    thirdPartyBilling?: { organizationId?: unknown; orgAmountCents?: number; reason?: string; platformFeeTotalCents?: number } | null;
    bookingFor?: string;
    lovedOneInfo?: { firstName?: string; lastName?: string } | null;
  }) => {
    const client = s.clientId as unknown as Person;
    return {
      appointmentId: String(s._id),
      clientId: client ? String(client._id) : "",
      clientName: nameOfPerson(client),
      forLovedOne:
        s.bookingFor === "loved-one"
          ? `${s.lovedOneInfo?.firstName ?? ""} ${s.lovedOneInfo?.lastName ?? ""}`.trim()
          : "",
      date: s.date ?? null,
      organizationId: s.thirdPartyBilling?.organizationId ? String(s.thirdPartyBilling.organizationId) : "",
      orgAmountCents: s.thirdPartyBilling?.orgAmountCents ?? 0,
    };
  };

  const awaiting = await Appointment.find({
    sessionCompletedAt: { $ne: null },
    "thirdPartyBilling.state": "awaiting_decision",
  })
    .select(sessionFields)
    .populate("clientId", "firstName lastName")
    .sort({ date: 1 })
    .limit(LIST_LIMIT)
    .lean();
  const awaitingDecision = awaiting.map((s) => ({ ...sessionRow(s), reason: s.thirdPartyBilling?.reason ?? "" }));

  const uninvoicedSessions = await Appointment.find({
    sessionCompletedAt: { $ne: null, $lte: new Date(now.getTime() - UNINVOICED_AFTER_DAYS * DAY_MS) },
    "thirdPartyBilling.kind": "organization",
    "thirdPartyBilling.state": "confirmed",
    "thirdPartyBilling.orgStatus": "unbilled",
    "thirdPartyBilling.orgAmountCents": { $gt: 0 },
    "thirdPartyBilling.orgInvoiceId": { $exists: false },
  })
    .select(sessionFields)
    .populate("clientId", "firstName lastName")
    .sort({ date: 1 })
    .limit(LIST_LIMIT)
    .lean();
  const uninvoiced = uninvoicedSessions.map((s) => ({
    ...sessionRow(s),
    daysSinceClosure: Math.floor((now.getTime() - new Date(s.sessionCompletedAt!).getTime()) / DAY_MS),
  }));

  const negative = await Appointment.find({
    sessionCompletedAt: { $gte: new Date(now.getTime() - NEGATIVE_MARGIN_LOOKBACK_DAYS * DAY_MS) },
    "thirdPartyBilling.platformFeeTotalCents": { $lt: 0 },
  })
    .select(sessionFields)
    .populate("clientId", "firstName lastName")
    .sort({ date: -1 })
    .limit(LIST_LIMIT)
    .lean();
  const negativeMargin = negative.map((s) => ({
    ...sessionRow(s),
    marginCents: s.thirdPartyBilling?.platformFeeTotalCents ?? 0,
  }));

  const coverages = await OrganizationCoverage.find({ status: { $in: ["active", "exhausted"] } })
    .select("clientId beneficiaryKey organizationId status maxSessions consumedAppointmentIds")
    .populate("clientId", "firstName lastName")
    .lean();
  const consumedIds = coverages.flatMap((c) => (c.consumedAppointmentIds ?? []).map(String));
  const holders = consumedIds.length
    ? await Appointment.find({ _id: { $in: consumedIds.map(oid) } })
        .select("+thirdPartyBilling")
        .lean()
    : [];
  const slotHoldersOf = new Map<string, Set<string>>();
  for (const a of holders) {
    const tpb = a.thirdPartyBilling;
    if (!tpb?.coverageId || !tpb.consumedCapSlot) continue;
    const key = String(tpb.coverageId);
    if (!slotHoldersOf.has(key)) slotHoldersOf.set(key, new Set());
    slotHoldersOf.get(key)!.add(String(a._id));
  }
  const capMismatch = coverages
    .map((c) => {
      const { issues, staleSlots } = capIssuesFor(c, slotHoldersOf.get(String(c._id)) ?? new Set());
      const client = c.clientId as unknown as Person;
      return {
        coverageId: String(c._id),
        clientId: client ? String(client._id) : "",
        clientName: nameOfPerson(client),
        beneficiaryKey: c.beneficiaryKey,
        organizationId: String(c.organizationId),
        status: c.status,
        used: c.consumedAppointmentIds?.length ?? 0,
        max: c.maxSessions ?? null,
        issues,
        staleSlots,
      };
    })
    .filter((c) => c.issues.length > 0)
    .slice(0, LIST_LIMIT);

  const orgIds = new Set<string>([
    ...aging.rows.map((r) => r.organizationId),
    ...paymentReview.map((r) => r.organizationId),
    ...awaitingDecision.map((r) => r.organizationId),
    ...uninvoiced.map((r) => r.organizationId),
    ...negativeMargin.map((r) => r.organizationId),
    ...capMismatch.map((r) => r.organizationId),
  ].filter((id) => mongoose.Types.ObjectId.isValid(id)));
  const orgs = await Organization.find({ _id: { $in: [...orgIds].map(oid) } }).select("name").lean();
  const organizations = Object.fromEntries(orgs.map((o) => [String(o._id), o.name]));

  return {
    generatedAt: now,
    organizations,
    aging,
    anomalies: { overdue, awaitingDecision, uninvoiced, capMismatch, negativeMargin, paymentReview },
  };
}

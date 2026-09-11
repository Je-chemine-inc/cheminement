/**
 * The scheduled organization-billing pass (spec 002, phase 4). Hourly; every
 * step is safe to repeat:
 *
 *   1. Monthly organizations: draft last month's statement (Montréal time)
 *      once. Existing drafts are rebuilt so they stay current until sent.
 *   2. Per-session organizations: one draft per closed session; sent at once
 *      where the organization asked for that (auto-send, off by default) —
 *      through the same consent gate as a manual send.
 *   3. One review email for drafts nobody was told about yet, claimed per
 *      draft before sending and given back if the email fails.
 *   4. Sent invoices past their due date become "overdue".
 *
 * Does nothing at all while the organization-billing switch is off.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Organization from "@/models/Organization";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import { isOrganizationBillingEnabled } from "@/lib/session-payer-plan";
import { previousPeriodKey } from "@/lib/organization-invoice-lines";
import {
  billableSessionsFilter,
  draftForSession,
  draftStatement,
  issueAndSend,
  refreshDraft,
  unbilledSummary,
} from "@/lib/organization-invoice";
import { sendAdminOrganizationInvoicesReview } from "@/lib/notifications";

export type OrganizationBillingRunResult = {
  skipped?: "switch_off";
  statementsDrafted: number;
  sessionDrafts: number;
  draftsRefreshed: number;
  autoSent: number;
  autoSendRefused: number;
  reviewAlerts: number;
  markedOverdue: number;
};

export async function runOrganizationBilling(
  now: Date = new Date(),
): Promise<OrganizationBillingRunResult> {
  const result: OrganizationBillingRunResult = {
    statementsDrafted: 0,
    sessionDrafts: 0,
    draftsRefreshed: 0,
    autoSent: 0,
    autoSendRefused: 0,
    reviewAlerts: 0,
    markedOverdue: 0,
  };
  await connectToDatabase();
  if (!(await isOrganizationBillingEnabled())) return { ...result, skipped: "switch_off" };

  // Keep drafts current until someone sends them.
  const drafts = await OrganizationInvoice.find({ status: "draft" }).select("_id").lean();
  for (const d of drafts) {
    const r = await refreshDraft(String(d._id)).catch(() => null);
    if (r?.ok) result.draftsRefreshed += 1;
  }

  const owing = await unbilledSummary();
  const orgs = await Organization.find({
    _id: { $in: owing.map((o) => new mongoose.Types.ObjectId(o.organizationId)) },
  })
    .select("billingCycle autoSendPerSession")
    .lean();
  const period = previousPeriodKey(now);

  for (const org of orgs) {
    const orgId = String(org._id);
    if (org.billingCycle === "monthly") {
      const key = `statement:${orgId}:${period}`;
      if (!(await OrganizationInvoice.exists({ draftKey: key }))) {
        const r = await draftStatement(orgId, period);
        if (r?.ok) result.statementsDrafted += 1;
      }
      continue;
    }

    const sessions = await Appointment.find(billableSessionsFilter(orgId)).select("_id").lean();
    for (const s of sessions) {
      const key = `session:${String(s._id)}`;
      let draftId: string | null = null;
      const existing = await OrganizationInvoice.findOne({ draftKey: key }).select("_id status").lean();
      if (existing) {
        if (existing.status !== "draft") continue;
        draftId = String(existing._id);
      } else {
        const r = await draftForSession(String(s._id));
        if (!r?.ok) continue;
        result.sessionDrafts += 1;
        draftId = String(r.invoice._id);
      }
      if (org.autoSendPerSession && draftId) {
        const sent = await issueAndSend({ invoiceId: draftId, byUserId: null, now });
        if (sent.ok) result.autoSent += 1;
        else {
          result.autoSendRefused += 1;
          console.warn(`[organization-billing] auto-send refused for ${draftId}: ${sent.code}`);
        }
      }
    }
  }

  // One review email for the drafts nobody has been told about.
  const unannounced = await OrganizationInvoice.find({
    status: "draft",
    reviewAlertSentAt: { $exists: false },
  })
    .select("_id organizationId kind periodKey lines totalCents")
    .lean();
  const claimed: typeof unannounced = [];
  for (const d of unannounced) {
    const c = await OrganizationInvoice.updateOne(
      { _id: d._id, status: "draft", reviewAlertSentAt: { $exists: false } },
      { $set: { reviewAlertSentAt: now } },
    );
    if (c.modifiedCount === 1) claimed.push(d);
  }
  if (claimed.length > 0) {
    const names = await Organization.find({
      _id: { $in: claimed.map((d) => d.organizationId) },
    })
      .select("name")
      .lean();
    const nameOf = new Map(names.map((n) => [String(n._id), n.name]));
    const sent = await sendAdminOrganizationInvoicesReview({
      items: claimed.map((d) => ({
        organizationName: nameOf.get(String(d.organizationId)) ?? "",
        kind: d.kind,
        periodKey: d.periodKey ?? null,
        sessions: d.lines.length,
        totalCents: d.totalCents,
      })),
    }).catch(() => false);
    if (sent) result.reviewAlerts = claimed.length;
    else {
      await OrganizationInvoice.updateMany(
        { _id: { $in: claimed.map((d) => d._id) } },
        { $unset: { reviewAlertSentAt: 1 } },
      );
    }
  }

  const overdue = await OrganizationInvoice.updateMany(
    { status: "sent", dueAt: { $lt: now } },
    { $set: { status: "overdue" } },
  );
  result.markedOverdue = overdue.modifiedCount;
  return result;
}

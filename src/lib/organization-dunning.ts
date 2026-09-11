/**
 * Chasing an organization's unpaid invoice (spec 002, phase 5). Run by the
 * hourly organization-billing pass:
 *
 *   due date      → reminder to the organization
 *   due + 14 days → second reminder
 *   due + 30 days → the team is alerted; nothing more is sent automatically
 *
 * Each step is stamped on the invoice BEFORE its email goes out (a conditional
 * write, so two runs can't both send) and the stamp is given back if nothing
 * could be sent. A reminder names the invoice number and the balance only: no
 * patient, no PDF, so it discloses nothing the invoice did not.
 *
 * Reminders go out on weekdays, 8 h – 18 h in Montréal; the team alert any time.
 */
import connectToDatabase from "@/lib/mongodb";
import Organization from "@/models/Organization";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import {
  AWAITING_PAYMENT_STATUSES,
  ensurePayToken,
  isAwaitingPayment,
  organizationPayUrl,
} from "@/lib/organization-invoice-pay-link";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import {
  sendAdminOrganizationInvoicesOverdue,
  sendOrganizationPaymentReminderEmail,
} from "@/lib/notifications";

const DAY_MS = 86_400_000;
export const FOLLOW_UP_AFTER_DAYS = 14;
export const TEAM_ALERT_AFTER_DAYS = 30;

export type DunningFacts = {
  status: string;
  balanceCents: number;
  dueAt?: Date | null;
  disputed?: boolean;
  /** A bank debit on its way: the organization is paying — no reminder. */
  pendingDebit?: { paymentIntentId?: string } | null;
  reminders?: { dueSentAt?: Date; followUpSentAt?: Date; overdueAlertSentAt?: Date } | null;
};

export type DunningStep = {
  reminder: "due" | "follow_up" | null;
  teamAlert: boolean;
  daysLate: number;
};

/**
 * What is owed to this invoice now. At most one reminder per run: an invoice
 * that is already two weeks late (the switch was off, the cron was down) gets
 * the second reminder, not both at once.
 */
export function dunningStepFor(inv: DunningFacts, now: Date): DunningStep {
  const none: DunningStep = { reminder: null, teamAlert: false, daysLate: 0 };
  if (
    !isAwaitingPayment(inv.status) ||
    inv.balanceCents <= 0 ||
    !inv.dueAt ||
    inv.disputed ||
    inv.pendingDebit?.paymentIntentId
  ) {
    return none;
  }
  const late = now.getTime() - new Date(inv.dueAt).getTime();
  if (late < 0) return none;
  const daysLate = Math.floor(late / DAY_MS);
  const r = inv.reminders ?? {};
  const reminder =
    daysLate >= FOLLOW_UP_AFTER_DAYS
      ? r.followUpSentAt ? null : "follow_up"
      : r.dueSentAt ? null : "due";
  return {
    reminder,
    teamAlert: daysLate >= TEAM_ALERT_AFTER_DAYS && !r.overdueAlertSentAt,
    daysLate,
  };
}

/** Weekdays, 8 h – 18 h, Montréal time. */
export function isReminderHour(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return !["Sat", "Sun"].includes(weekday) && hour >= 8 && hour < 18;
}

export type DunningRunResult = {
  reminders: number;
  followUps: number;
  reminderFailures: number;
  teamAlerts: number;
};

export async function runOrganizationDunning(now: Date = new Date()): Promise<DunningRunResult> {
  const result: DunningRunResult = { reminders: 0, followUps: 0, reminderFailures: 0, teamAlerts: 0 };
  await connectToDatabase();
  const candidates = await OrganizationInvoice.find({
    status: { $in: AWAITING_PAYMENT_STATUSES },
    balanceCents: { $gt: 0 },
    dueAt: { $lte: now },
    disputed: { $ne: true },
    "pendingDebit.paymentIntentId": { $exists: false },
    $or: [
      { "reminders.dueSentAt": { $exists: false } },
      { "reminders.followUpSentAt": { $exists: false } },
      { "reminders.overdueAlertSentAt": { $exists: false } },
    ],
  })
    .select("organizationId number status balanceCents dueAt disputed pendingDebit reminders billTo payToken")
    .lean();
  if (candidates.length === 0) return result;

  const sendReminders = isReminderHour(now);
  const interacEmail = sendReminders ? await getInteracDepositEmail().catch(() => "") : "";
  const late: Array<{ inv: (typeof candidates)[number]; daysLate: number }> = [];

  for (const inv of candidates) {
    const step = dunningStepFor(inv, now);
    if (step.teamAlert) late.push({ inv, daysLate: step.daysLate });
    if (!step.reminder || !sendReminders) continue;

    // Claim the step. The second reminder also stamps the first if it never
    // went out, so it can't follow on the next run.
    const stamps: Record<string, Date> =
      step.reminder === "follow_up"
        ? {
            "reminders.followUpSentAt": now,
            ...(inv.reminders?.dueSentAt ? {} : { "reminders.dueSentAt": now }),
          }
        : { "reminders.dueSentAt": now };
    const claimKey = step.reminder === "follow_up" ? "reminders.followUpSentAt" : "reminders.dueSentAt";
    const claim = await OrganizationInvoice.updateOne(
      {
        _id: inv._id,
        status: { $in: AWAITING_PAYMENT_STATUSES },
        balanceCents: { $gt: 0 },
        disputed: { $ne: true },
        // A debit that started between the read and now: no reminder after all.
        "pendingDebit.paymentIntentId": { $exists: false },
        [claimKey]: { $exists: false },
      },
      { $set: stamps },
    );
    if (claim.modifiedCount !== 1) continue;

    const org = await Organization.findById(inv.organizationId).select("name language billingEmails").lean();
    const lang = org?.language === "en" ? "en" : "fr";
    const token = inv.payToken ?? (await ensurePayToken(inv._id));
    const emails = inv.billTo?.emails?.length ? inv.billTo.emails : (org?.billingEmails ?? []);
    const reached: string[] = [];
    for (const to of emails) {
      const ok = await sendOrganizationPaymentReminderEmail({
        to,
        stage: step.reminder,
        organizationName: org?.name ?? inv.billTo?.name ?? "",
        number: inv.number ?? "",
        balanceCents: inv.balanceCents,
        dueAt: inv.dueAt ?? null,
        payUrl: token ? organizationPayUrl(token, lang) : null,
        interacEmail: interacEmail || null,
        locale: lang,
      }).catch(() => false);
      if (ok) reached.push(to);
    }
    if (reached.length > 0) {
      await OrganizationInvoice.updateOne(
        { _id: inv._id },
        { $push: { sendLog: { at: now, to: reached, kind: "reminder" } } },
      );
      if (step.reminder === "follow_up") result.followUps += 1;
      else result.reminders += 1;
    } else {
      await OrganizationInvoice.updateOne(
        { _id: inv._id },
        { $unset: Object.fromEntries(Object.keys(stamps).map((k) => [k, 1])) },
      );
      result.reminderFailures += 1;
    }
  }

  // One team email for every invoice that crossed 30 days, each claimed first.
  const claimed: typeof late = [];
  for (const item of late) {
    const c = await OrganizationInvoice.updateOne(
      { _id: item.inv._id, "reminders.overdueAlertSentAt": { $exists: false } },
      { $set: { "reminders.overdueAlertSentAt": now } },
    );
    if (c.modifiedCount === 1) claimed.push(item);
  }
  if (claimed.length > 0) {
    const orgs = await Organization.find({ _id: { $in: claimed.map((c) => c.inv.organizationId) } })
      .select("name")
      .lean();
    const nameOf = new Map(orgs.map((o) => [String(o._id), o.name]));
    const sent = await sendAdminOrganizationInvoicesOverdue({
      items: claimed.map(({ inv, daysLate }) => ({
        organizationName: nameOf.get(String(inv.organizationId)) ?? inv.billTo?.name ?? "",
        number: inv.number ?? "—",
        balanceCents: inv.balanceCents,
        daysLate,
      })),
    }).catch(() => false);
    if (sent) result.teamAlerts = claimed.length;
    else {
      await OrganizationInvoice.updateMany(
        { _id: { $in: claimed.map((c) => c.inv._id) } },
        { $unset: { "reminders.overdueAlertSentAt": 1 } },
      );
    }
  }
  return result;
}

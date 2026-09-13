import "server-only";
import connectToDatabase from "@/lib/mongodb";
import ContentEntry from "@/models/ContentEntry";
import ResourceEntitlement from "@/models/ResourceEntitlement";
import { productByline, reconcileProductLiveStatus } from "@/lib/products";
import { WEBINAR_REMINDERS, webinarReminderDue, webinarReminderKey } from "@/lib/product-rules";
import { sendProductWebinarReminderEmail } from "@/lib/notifications";

/**
 * The products job (spec 003 phase 5), every ten minutes from the VPS cron and
 * off dashboard traffic (`triggerDueProductJobs`): it first puts right any
 * product whose stored status disagrees with its professional's account, then
 * reminds a webinar's buyers the day before and an hour before.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Reminders one run may send; the rest go out on the next run. */
export const MAX_WEBINAR_REMINDERS_PER_RUN = 200;

type WebinarRow = {
  slug: string;
  locale: "fr" | "en";
  title: string;
  ownerProfessionalId: unknown;
  webinar?: { startsAt?: Date; durationMinutes?: number };
  webinarAccess?: { joinUrl?: string };
};

type PurchaseRow = {
  _id: unknown;
  userId?: unknown;
  buyerEmail: string;
  buyerName?: string;
  locale: "fr" | "en";
  accessToken?: string;
  paidAt?: Date;
  webinarRemindersSent?: string[];
};

export interface WebinarReminderReport {
  remindersSent: number;
  remindersFailed: number;
}

function appUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}

/**
 * Remind the buyers of every webinar starting within the next day.
 *
 * A reminder is claimed on its purchase (`webinarRemindersSent`) before the
 * email goes out, so two runs never send it twice, and given back when the
 * email fails, to be tried again on the next run. Nobody is reminded of a
 * webinar without a room link or whose professional's account is not active,
 * and no purchase refunded, disputed, or a guest's whose link was revoked is
 * reminded. The email links to the webinar's page, where the room link is —
 * never to the room — so a refund or a new room link is honoured.
 */
export async function sendDueWebinarReminders(now: Date = new Date()): Promise<WebinarReminderReport> {
  await connectToDatabase();
  const report: WebinarReminderReport = { remindersSent: 0, remindersFailed: 0 };
  const earliest = Math.max(...WEBINAR_REMINDERS.map((reminder) => reminder.hoursBefore));
  const rows = await ContentEntry.find({
    kind: "resource",
    productType: "webinar",
    ownerProfessionalId: { $exists: true },
    "webinar.startsAt": { $gt: now, $lte: new Date(now.getTime() + earliest * HOUR_MS) },
  })
    .select("slug locale title ownerProfessionalId webinar webinarAccess")
    .lean<WebinarRow[]>();

  const bySlug = new Map<string, WebinarRow[]>();
  for (const row of rows) bySlug.set(row.slug, [...(bySlug.get(row.slug) ?? []), row]);

  for (const [slug, pair] of bySlug) {
    const fr = pair.find((row) => row.locale === "fr") ?? pair[0];
    const startsAt = fr.webinar?.startsAt ? new Date(fr.webinar.startsAt) : null;
    if (!startsAt || !fr.webinarAccess?.joinUrl) continue;
    // Null unless the professional's account is active.
    const byline = await productByline(String(fr.ownerProfessionalId));
    if (!byline) continue;

    const purchases = await ResourceEntitlement.find({ slug, status: "paid", disputed: { $ne: true } })
      .select("userId buyerEmail buyerName locale accessToken paidAt webinarRemindersSent")
      .lean<PurchaseRow[]>();
    for (const purchase of purchases) {
      if (report.remindersSent + report.remindersFailed >= MAX_WEBINAR_REMINDERS_PER_RUN) return report;
      const reminder = webinarReminderDue({ startsAt, paidAt: purchase.paidAt ?? null, now });
      if (!reminder) continue;
      const key = webinarReminderKey(reminder, startsAt);
      if (purchase.webinarRemindersSent?.includes(key)) continue;
      // A guest reaches the webinar only through their emailed link.
      if (!purchase.userId && !purchase.accessToken) continue;

      const claimed = await ResourceEntitlement.updateOne(
        { _id: purchase._id, status: "paid", disputed: { $ne: true }, webinarRemindersSent: { $ne: key } },
        { $addToSet: { webinarRemindersSent: key } },
      );
      if (claimed.modifiedCount !== 1) continue;

      const row = pair.find((candidate) => candidate.locale === purchase.locale) ?? fr;
      const path = purchase.userId ? `/book/${slug}` : `/book/${slug}?token=${purchase.accessToken}`;
      const sent = await sendProductWebinarReminderEmail({
        buyerEmail: purchase.buyerEmail,
        buyerName: purchase.buyerName,
        productTitle: row.title,
        professionalName: byline.name,
        startsAt,
        durationMinutes: fr.webinar?.durationMinutes ?? null,
        accessUrl: appUrl(path),
        personalLink: !purchase.userId,
        reminder,
        locale: purchase.locale,
      }).catch((error: unknown) => {
        console.error("[product-jobs] webinar reminder failed:", error);
        return false;
      });
      if (sent) {
        report.remindersSent += 1;
      } else {
        report.remindersFailed += 1;
        await ResourceEntitlement.updateOne({ _id: purchase._id }, { $pull: { webinarRemindersSent: key } });
      }
    }
  }
  return report;
}

export async function runProductJobs(
  now: Date = new Date(),
): Promise<{ statusCorrected: number } & WebinarReminderReport> {
  const statusCorrected = await reconcileProductLiveStatus();
  return { statusCorrected, ...(await sendDueWebinarReminders(now)) };
}

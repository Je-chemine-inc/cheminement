/**
 * ONE-TIME backfill — run ONCE at (or just before) the first deploy that ships
 * the post-meeting payment reminder.
 *
 * Sets `postMeetingPaymentReminderSent = true` on every pre-existing
 * completed / no-show appointment so the reminder cron's first run does NOT
 * retroactively dun historical clients. Idempotent: the `$ne: true` filter
 * makes re-runs no-ops. Pairs with the 14-day date floor in
 * src/lib/payment-guarantee-reminders.ts (the floor is the durable safety net;
 * this backfill is the hard guarantee against the historical blast).
 *
 * Usage:  MONGODB_URI="<prod uri>" npx tsx scripts/backfill-post-meeting-reminder-flag.ts
 */
import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");

  await mongoose.connect(uri);
  const res = await mongoose.connection
    .collection("appointments")
    .updateMany(
      {
        status: { $in: ["completed", "no-show"] },
        postMeetingPaymentReminderSent: { $ne: true },
      },
      { $set: { postMeetingPaymentReminderSent: true } },
    );

  console.log(
    `Backfill complete: matched ${res.matchedCount}, modified ${res.modifiedCount}`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

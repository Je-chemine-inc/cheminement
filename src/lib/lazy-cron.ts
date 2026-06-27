import connectToDatabase from "@/lib/mongodb";
import CronRun from "@/models/CronRun";
import { runProposalTimeouts } from "@/lib/proposal-timeout";
import { runPaymentReminders } from "@/lib/payment-reminders";
import { runAppointmentReminders } from "@/lib/appointment-reminders";

/**
 * "Lazy cron": advance the matching cascade off normal authenticated traffic
 * (admin queue / pro proposals polls) instead of an external scheduler. The
 * cascade's 24h/12h proposal timeouts (Pro 1 → expire → Pro 2 → expire →
 * general pool) only need to fire roughly hourly, so piggy-backing on the
 * frequent dashboard polls is enough — no GitHub Actions / Vercel Pro required.
 *
 * Safety:
 *  - DB heartbeat (CronRun) throttles the real job to once per THROTTLE_MS, and
 *    the atomic claim guarantees a single winner across serverless instances.
 *  - A cheap per-instance guard avoids hitting the DB on every single poll.
 *  - Never throws — call it fire-and-forget from an after() in the route.
 *  - runProposalTimeouts is itself idempotent (atomic per-dossier claim), so a
 *    double-fire is harmless.
 */

const CASCADE_KEY = "proposal-timeouts";
// The cascade advance runs at most this often, no matter how many polls arrive.
const THROTTLE_MS = 10 * 60 * 1000; // 10 minutes
// Per-warm-instance short-circuit so a busy instance doesn't query the DB on
// every poll; the CronRun doc remains the cross-instance source of truth.
const LOCAL_GUARD_MS = 60 * 1000;
let lastLocalCheck = 0;

export async function triggerDueCascadeCron(): Promise<void> {
  const now = Date.now();
  if (now - lastLocalCheck < LOCAL_GUARD_MS) return;
  lastLocalCheck = now;
  try {
    await connectToDatabase();
    // Ensure the heartbeat exists (epoch-0 default so the very first claim fires).
    await CronRun.updateOne(
      { key: CASCADE_KEY },
      { $setOnInsert: { key: CASCADE_KEY, lastRunAt: new Date(0) } },
      { upsert: true },
    );
    // Atomically claim the run ONLY if the window has elapsed. One instance
    // flips lastRunAt → the rest see the fresh value and no-op (claimed === null).
    const claimed = await CronRun.findOneAndUpdate(
      { key: CASCADE_KEY, lastRunAt: { $lt: new Date(now - THROTTLE_MS) } },
      { $set: { lastRunAt: new Date(now) } },
    );
    if (!claimed) return;
    await runProposalTimeouts();
  } catch (err) {
    console.error("[lazy-cron] cascade trigger failed:", err);
  }
}

// Post-session invoice dunning (H+12 / H+36 reminders, H+48 → overdue + alert).
// The windows are coarse ("le lendemain matin"), so a 30-min lazy throttle off
// dashboard traffic — plus the daily Vercel cron baseline — is plenty.
const PAYMENT_REMINDERS_KEY = "payment-reminders";
const PAYMENT_REMINDERS_THROTTLE_MS = 30 * 60 * 1000; // 30 minutes
let lastPaymentLocalCheck = 0;

export async function triggerDuePaymentReminders(): Promise<void> {
  const now = Date.now();
  if (now - lastPaymentLocalCheck < LOCAL_GUARD_MS) return;
  lastPaymentLocalCheck = now;
  try {
    await connectToDatabase();
    await CronRun.updateOne(
      { key: PAYMENT_REMINDERS_KEY },
      { $setOnInsert: { key: PAYMENT_REMINDERS_KEY, lastRunAt: new Date(0) } },
      { upsert: true },
    );
    const claimed = await CronRun.findOneAndUpdate(
      {
        key: PAYMENT_REMINDERS_KEY,
        lastRunAt: { $lt: new Date(now - PAYMENT_REMINDERS_THROTTLE_MS) },
      },
      { $set: { lastRunAt: new Date(now) } },
    );
    if (!claimed) return;
    await runPaymentReminders();
  } catch (err) {
    console.error("[lazy-cron] payment reminders trigger failed:", err);
  }
}

// Pre-appointment reminders (H-72 with cancel/reschedule, H-48 without). On
// Vercel Hobby the daily /api/cron/appointment-reminders is unreliable (only 2
// of the 5 declared crons actually run), so drive it off dashboard traffic too.
// The windows are 24h/48h wide and the job dedupes via per-appointment flags, so
// a ~30-min lazy cadence catches every appointment exactly once.
const APPOINTMENT_REMINDERS_KEY = "appointment-reminders";
const APPOINTMENT_REMINDERS_THROTTLE_MS = 30 * 60 * 1000; // 30 minutes
let lastAppointmentLocalCheck = 0;

export async function triggerDueAppointmentReminders(): Promise<void> {
  const now = Date.now();
  if (now - lastAppointmentLocalCheck < LOCAL_GUARD_MS) return;
  lastAppointmentLocalCheck = now;
  try {
    await connectToDatabase();
    await CronRun.updateOne(
      { key: APPOINTMENT_REMINDERS_KEY },
      { $setOnInsert: { key: APPOINTMENT_REMINDERS_KEY, lastRunAt: new Date(0) } },
      { upsert: true },
    );
    const claimed = await CronRun.findOneAndUpdate(
      {
        key: APPOINTMENT_REMINDERS_KEY,
        lastRunAt: { $lt: new Date(now - APPOINTMENT_REMINDERS_THROTTLE_MS) },
      },
      { $set: { lastRunAt: new Date(now) } },
    );
    if (!claimed) return;
    await runAppointmentReminders();
  } catch (err) {
    console.error("[lazy-cron] appointment reminders trigger failed:", err);
  }
}

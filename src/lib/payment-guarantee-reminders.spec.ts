import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression pins for "le système me fait plusieurs rappels pour la même
 * situation" (2026-09-11).
 *
 * The admin "Aucun paiement — séance passée" alert had no repeat limit. For a
 * client with a card on file the client-side flag is never set, so the session
 * stayed a candidate on every run — and the runner moved from a daily Vercel
 * cron to an hourly system cron. Production received 18 identical alerts for
 * one client in 18 hours, and the 14-day lookback would have allowed ~336.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 10, 17, 30); // first alert of the real incident

const h = vi.hoisted(() => ({
  apt: null as Record<string, unknown> | null,
  user: null as Record<string, unknown> | null,
  adminSendResult: true,
  adminAlert: vi.fn(),
  clientNudge: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

// A thenable that tolerates any .populate/.limit/.sort chain.
function query(docs: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["populate", "limit", "sort", "select", "lean"]) q[m] = () => q;
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(docs).then(res, rej);
  return q;
}

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));

vi.mock("@/models/Appointment", () => ({
  default: {
    // Only the post-meeting query (completed / no-show) returns the session;
    // the day1 / day2 / 48h stages see nothing.
    find: vi.fn((filter: { status?: { $in?: string[] } }) =>
      query(filter?.status?.$in?.includes("completed") && h.apt ? [h.apt] : []),
    ),
    findByIdAndUpdate: vi.fn(
      async (_id: unknown, update: { $set: Record<string, unknown> }) => {
        h.updates.push(update.$set);
        // Persist, so consecutive runs see what the previous one wrote.
        Object.assign(h.apt ?? {}, update.$set);
      },
    ),
  },
}));

vi.mock("@/models/User", () => ({
  default: { findById: vi.fn(async () => h.user) },
}));

vi.mock("@/lib/client-portal-urls", () => ({
  resolveBillingUrl: vi.fn(async () => "https://www.jechemine.ca/client/billing"),
}));

vi.mock("@/lib/notifications", () => ({
  sendPaymentGuaranteeDay1Reminder: vi.fn(async () => true),
  sendPaymentGuaranteeDay2Reminder: vi.fn(async () => true),
  sendPaymentGuarantee48hClientReminder: vi.fn(async () => true),
  sendPaymentGuarantee48hProfessionalAlert: vi.fn(async () => true),
  sendPostMeetingPaymentReminder: (...a: unknown[]) => h.clientNudge(...a),
  sendAdminNoPaymentBeforeMeetingAlert: (...a: unknown[]) => h.adminAlert(...a),
}));

import { runPaymentGuaranteeReminders } from "@/lib/payment-guarantee-reminders";

function unpaidSession(extra: Record<string, unknown> = {}) {
  return {
    _id: "apt-elorie",
    status: "completed",
    date: new Date(T0 - 2 * DAY),
    time: "10:00",
    bookingFor: "self",
    clientId: {
      _id: { toString: () => "user-elorie" },
      firstName: "Élorie",
      lastName: "B",
      email: "elorie@example.com",
      language: "fr",
    },
    payment: { status: "pending" },
    ...extra,
  };
}

beforeEach(() => {
  h.updates = [];
  h.adminSendResult = true;
  h.adminAlert.mockReset().mockImplementation(async () => h.adminSendResult);
  h.clientNudge.mockReset().mockImplementation(async () => true);
  // The incident case: card on file ("green") but the fee was never collected.
  h.user = { status: "active", paymentGuaranteeStatus: "green" };
  h.apt = unpaidSession();
});

describe("post-meeting admin alert — once a day, not every run", () => {
  it("replays the incident: 18 hourly runs send ONE alert, not 18", async () => {
    for (let i = 0; i < 18; i++) {
      await runPaymentGuaranteeReminders(T0 + i * HOUR);
    }
    expect(h.adminAlert).toHaveBeenCalledTimes(1);
  });

  it("keeps the daily pressure while the fee stays unreconciled", async () => {
    // Three days of hourly runs → one alert per day.
    for (let i = 0; i < 72; i++) {
      await runPaymentGuaranteeReminders(T0 + i * HOUR);
    }
    expect(h.adminAlert).toHaveBeenCalledTimes(3);
  });

  it("records when it sent, so the next run knows", async () => {
    await runPaymentGuaranteeReminders(T0);
    expect(h.updates).toContainEqual({
      postMeetingAdminAlertSentAt: new Date(T0),
    });
  });

  it("does not fire again an hour later", async () => {
    h.apt = unpaidSession({ postMeetingAdminAlertSentAt: new Date(T0) });
    await runPaymentGuaranteeReminders(T0 + HOUR);
    expect(h.adminAlert).not.toHaveBeenCalled();
  });

  it("fires again a day later", async () => {
    h.apt = unpaidSession({ postMeetingAdminAlertSentAt: new Date(T0) });
    await runPaymentGuaranteeReminders(T0 + DAY);
    expect(h.adminAlert).toHaveBeenCalledTimes(1);
  });

  it("tolerates cron jitter instead of slipping the alert by an hour", async () => {
    // Today's run started 3 seconds earlier than yesterday's.
    h.apt = unpaidSession({ postMeetingAdminAlertSentAt: new Date(T0 + 3000) });
    await runPaymentGuaranteeReminders(T0 + DAY);
    expect(h.adminAlert).toHaveBeenCalledTimes(1);
  });

  it("retries on the next run when the send failed, rather than waiting a day", async () => {
    h.adminSendResult = false; // SMTP down
    await runPaymentGuaranteeReminders(T0);
    expect(h.updates).not.toContainEqual(
      expect.objectContaining({ postMeetingAdminAlertSentAt: expect.anything() }),
    );

    h.adminSendResult = true;
    await runPaymentGuaranteeReminders(T0 + HOUR);
    expect(h.adminAlert).toHaveBeenCalledTimes(2);
  });

  it("never nudges a client who already has a card on file", async () => {
    for (let i = 0; i < 5; i++) {
      await runPaymentGuaranteeReminders(T0 + i * HOUR);
    }
    expect(h.clientNudge).not.toHaveBeenCalled();
  });

  it("still nudges a client with no guarantee, and alerts the admin once", async () => {
    h.user = { status: "active", paymentGuaranteeStatus: "none" };
    await runPaymentGuaranteeReminders(T0);
    expect(h.clientNudge).toHaveBeenCalledTimes(1);
    expect(h.adminAlert).toHaveBeenCalledTimes(1);
    expect(h.updates).toContainEqual({ postMeetingPaymentReminderSent: true });
  });

  it("stays silent once the fee is paid", async () => {
    h.apt = unpaidSession({ payment: { status: "paid" } });
    await runPaymentGuaranteeReminders(T0);
    expect(h.adminAlert).not.toHaveBeenCalled();
    expect(h.clientNudge).not.toHaveBeenCalled();
  });
});

/**
 * The products job (spec 003 phase 5): who gets a webinar reminder, when and
 * with which link; each reminder claimed before its email and given back on a
 * failure; and the status upkeep running first. The reminder rules are the
 * real ones; the database, the products module and the emails are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PRO = "0123456789abcdef01234567";
const SLUG = "apprivoiser-son-anxiete";
const STARTS = new Date("2026-10-01T23:00:00.000Z");
const HOUR = 3_600_000;
const LONG_AGO = new Date("2026-09-01T12:00:00.000Z");
const TOKEN = "a".repeat(64);

const h = vi.hoisted(() => ({
  webinars: [] as unknown[],
  purchases: [] as unknown[],
  entryFind: vi.fn(),
  entFind: vi.fn(),
  entUpdateOne: vi.fn(),
  productByline: vi.fn(),
  reconcile: vi.fn(),
  send: vi.fn(),
}));

const chain = (result: unknown) => {
  const query = { select: () => query, lean: async () => result };
  return query;
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/ContentEntry", () => ({ default: { find: h.entryFind } }));
vi.mock("@/models/ResourceEntitlement", () => ({ default: { find: h.entFind, updateOne: h.entUpdateOne } }));
vi.mock("@/lib/products", () => ({ productByline: h.productByline, reconcileProductLiveStatus: h.reconcile }));
vi.mock("@/lib/articles", () => ({ reconcileArticleLiveStatus: vi.fn(async () => 0) }));
vi.mock("@/lib/notifications", () => ({ sendProductWebinarReminderEmail: h.send }));

import { MAX_WEBINAR_REMINDERS_PER_RUN, runProductJobs, sendDueWebinarReminders } from "@/lib/product-jobs";

const webinarRow = (locale: "fr" | "en", over: Record<string, unknown> = {}) => ({
  slug: SLUG,
  locale,
  title: locale === "fr" ? "Apprivoiser son anxiété" : "Taming anxiety",
  ownerProfessionalId: PRO,
  webinar: { startsAt: STARTS, durationMinutes: 90 },
  webinarAccess: { joinUrl: "https://zoom.us/j/123" },
  ...over,
});

const member = { _id: "e1", userId: "u1", buyerEmail: "membre@example.com", buyerName: "Alex", locale: "fr", paidAt: LONG_AGO };
const guest = { _id: "e2", buyerEmail: "guest@example.com", locale: "en", accessToken: TOKEN, paidAt: LONG_AGO };

const at = (hoursBefore: number) => new Date(STARTS.getTime() - hoursBefore * HOUR);
const dayKey = `day:${STARTS.toISOString()}`;

let previousUrl: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  previousUrl = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = "https://www.jechemine.ca";
  h.webinars = [webinarRow("fr"), webinarRow("en")];
  h.purchases = [member, guest];
  h.entryFind.mockImplementation(() => chain(h.webinars));
  h.entFind.mockImplementation(() => chain(h.purchases));
  h.entUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  h.productByline.mockResolvedValue({ name: "Léa Sassi", pageUrl: null });
  h.reconcile.mockResolvedValue(0);
  h.send.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (previousUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = previousUrl;
});

describe("sendDueWebinarReminders", () => {
  it("looks only at professionals' webinars starting within a day, and at paid, undisputed purchases", async () => {
    const now = at(20);
    await sendDueWebinarReminders(now);
    expect(h.entryFind.mock.calls[0][0]).toEqual({
      kind: "resource",
      productType: "webinar",
      ownerProfessionalId: { $exists: true },
      "webinar.startsAt": { $gt: now, $lte: new Date(now.getTime() + 24 * HOUR) },
    });
    expect(h.entFind.mock.calls[0][0]).toEqual({ slug: SLUG, status: "paid", disputed: { $ne: true } });
    expect(h.productByline).toHaveBeenCalledWith(PRO);
  });

  it("sends the day-before reminder to each buyer, in their language, with their own link", async () => {
    expect(await sendDueWebinarReminders(at(20))).toEqual({ remindersSent: 2, remindersFailed: 0 });
    expect(h.send).toHaveBeenCalledWith({
      buyerEmail: "membre@example.com",
      buyerName: "Alex",
      productTitle: "Apprivoiser son anxiété",
      professionalName: "Léa Sassi",
      startsAt: STARTS,
      durationMinutes: 90,
      accessUrl: `https://www.jechemine.ca/book/${SLUG}`,
      personalLink: false,
      reminder: "day",
      locale: "fr",
    });
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerEmail: "guest@example.com",
        productTitle: "Taming anxiety",
        accessUrl: `https://www.jechemine.ca/book/${SLUG}?token=${TOKEN}`,
        personalLink: true,
        reminder: "day",
        locale: "en",
      }),
    );
  });

  it("claims each reminder on its purchase before the email goes out", async () => {
    await sendDueWebinarReminders(at(0.5));
    const hourKey = `hour:${STARTS.toISOString()}`;
    expect(h.entUpdateOne).toHaveBeenNthCalledWith(
      1,
      { _id: "e1", status: "paid", disputed: { $ne: true }, webinarRemindersSent: { $ne: hourKey } },
      { $addToSet: { webinarRemindersSent: hourKey } },
    );
    expect(h.entUpdateOne.mock.invocationCallOrder[0]).toBeLessThan(h.send.mock.invocationCallOrder[0]);
    expect(h.send.mock.calls[0][0]).toMatchObject({ reminder: "hour" });
  });

  it("sends nothing another run already claimed, nor a reminder already recorded", async () => {
    h.entUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    h.purchases = [member, { ...guest, webinarRemindersSent: [dayKey] }];
    await sendDueWebinarReminders(at(20));
    expect(h.entUpdateOne).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("reminds again when the webinar moved, since the key carries the date", async () => {
    const weekEarlier = new Date(STARTS.getTime() - 7 * 24 * HOUR).toISOString();
    h.purchases = [{ ...member, webinarRemindersSent: [`day:${weekEarlier}`] }];
    await sendDueWebinarReminders(at(20));
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("gives the claim back when the email fails or throws, to try again on the next run", async () => {
    h.send.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("smtp down"));
    expect(await sendDueWebinarReminders(at(20))).toEqual({ remindersSent: 0, remindersFailed: 2 });
    expect(h.entUpdateOne).toHaveBeenCalledWith({ _id: "e1" }, { $pull: { webinarRemindersSent: dayKey } });
    expect(h.entUpdateOne).toHaveBeenCalledWith({ _id: "e2" }, { $pull: { webinarRemindersSent: dayKey } });
  });

  it("skips a purchase made inside the window, and a guest whose link was revoked", async () => {
    h.purchases = [
      { ...member, paidAt: at(10) },
      { ...guest, accessToken: undefined },
    ];
    await sendDueWebinarReminders(at(5));
    expect(h.entUpdateOne).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("reminds nobody when the professional's account is not active or the webinar has no room link", async () => {
    h.productByline.mockResolvedValue(null);
    await sendDueWebinarReminders(at(20));
    expect(h.entFind).not.toHaveBeenCalled();

    h.productByline.mockResolvedValue({ name: "Léa Sassi", pageUrl: null });
    h.webinars = [webinarRow("fr", { webinarAccess: {} }), webinarRow("en", { webinarAccess: {} })];
    await sendDueWebinarReminders(at(20));
    expect(h.entFind).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it(`sends at most ${MAX_WEBINAR_REMINDERS_PER_RUN} reminders in one run`, async () => {
    h.purchases = Array.from({ length: MAX_WEBINAR_REMINDERS_PER_RUN + 5 }, (_, n) => ({
      ...member,
      _id: `e${n}`,
      userId: `u${n}`,
    }));
    const report = await sendDueWebinarReminders(at(20));
    expect(report.remindersSent).toBe(MAX_WEBINAR_REMINDERS_PER_RUN);
    expect(h.send).toHaveBeenCalledTimes(MAX_WEBINAR_REMINDERS_PER_RUN);
  });
});

describe("runProductJobs", () => {
  it("puts product statuses right first, then sends the reminders", async () => {
    h.reconcile.mockResolvedValue(2);
    expect(await runProductJobs(at(20))).toEqual({ statusCorrected: 2, remindersSent: 2, remindersFailed: 0 });
    expect(h.reconcile.mock.invocationCallOrder[0]).toBeLessThan(h.entryFind.mock.invocationCallOrder[0]);
  });
});

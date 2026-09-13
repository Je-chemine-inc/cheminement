import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

const PRO = "0123456789abcdef01234567";
const ENTRY = "0123456789abcdef0123eeee";
const HOLD = "0123456789abcdef0123cccc";
const APPT = "0123456789abcdef0123aaaa";

type Update = [Record<string, unknown>, Record<string, Record<string, unknown>>];

const h = vi.hoisted(() => ({
  enabled: true,
  order: [] as string[],
  finds: [] as Record<string, unknown>[],
  findResults: [] as unknown[],
  contact: null as Record<string, unknown> | null,
  updates: [] as [Record<string, unknown>, Record<string, Record<string, unknown>>][],
  modified: [] as number[],
  exists: true,
  distinct: [] as string[],
  page: { slug: "sassi" } as { slug: string } | null,
  bookable: null as Record<string, unknown> | null,
  slotsCalls: [] as unknown[][],
  hold: { ok: true, holdId: "0123456789abcdef0123cccc" } as { ok: boolean; holdId?: string },
  holdCalls: [] as Record<string, unknown>[],
  releases: [] as unknown[][],
  request: null as Record<string, unknown> | null,
  emails: [] as [string, Record<string, unknown>][],
  sms: [] as [string, string][],
  directFails: false,
  directCalls: 0,
  purges: 0,
}));

const chain = (result: unknown) => {
  const query = {
    sort: () => query,
    select: () => query,
    limit: () => query,
    lean: async () => result,
  };
  return query;
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/models/WaitlistEntry", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.finds.push(filter);
      return chain(h.findResults.length > 0 ? h.findResults.shift() : []);
    },
    findOne: () => chain(h.contact),
    updateOne: async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      h.order.push("claim");
      h.updates.push([filter, update]);
      return { modifiedCount: h.modified.length > 0 ? h.modified.shift() : 1 };
    },
    exists: async () => h.exists,
    distinct: async () => h.distinct,
  },
}));
vi.mock("@/models/ShowcasePage", () => ({ default: { findOne: () => chain(h.page) } }));
vi.mock("@/models/Appointment", () => ({ default: { findOne: () => chain(h.request) } }));
vi.mock("@/lib/showcase-booking", () => ({
  loadBookableShowcase: async () => h.bookable,
  listShowcaseSlots: async (...args: unknown[]) => {
    h.slotsCalls.push(args);
    return {
      service: args[1],
      available: true,
      durationMinutes: 50,
      price: 130,
      // Monday 14 September 2026 from 09:00 in Montréal.
      days: [
        { day: "2026-09-14", slots: ["10:00", "11:30"] },
        { day: "2026-09-15", slots: ["09:00"] },
      ],
      nextFrom: null,
    };
  },
}));
vi.mock("@/lib/slot-holds", () => ({
  acquireSlotHold: async (input: Record<string, unknown>) => {
    h.order.push("hold");
    h.holdCalls.push(input);
    return h.hold;
  },
  releaseSlotHold: async (...args: unknown[]) => {
    h.releases.push(args);
    return true;
  },
}));
vi.mock("@/lib/showcase-hosts", () => ({
  absoluteShowcaseUrl: (city: string, path: string) => `https://psy${city}.jechemine.ca${path}`,
}));
vi.mock("@/lib/direct-request", () => ({
  runDirectRequestTimeouts: async () => {
    h.directCalls++;
    if (h.directFails) throw new Error("down");
    return { expired: 2 };
  },
}));
vi.mock("@/lib/data-lifecycle", () => ({
  purgeClosedWaitlistEntries: async () => {
    h.purges++;
    return 4;
  },
}));
vi.mock("@/lib/sms", () => ({
  sendSms: async (to: string, body: string) => {
    h.sms.push([to, body]);
  },
}));
vi.mock("@/lib/notifications", () => ({
  sendWaitlistOfferEmail: async (data: Record<string, unknown>) => {
    h.emails.push(["offer", data]);
    return true;
  },
  sendWaitlistRemovedEmail: async (data: Record<string, unknown>) => {
    h.emails.push(["removed", data]);
    return true;
  },
}));

import {
  expireWaitlistEntries,
  expireWaitlistOffers,
  notifySlotFreed,
  offerFreeSlotsForProfessional,
  recoverStaleWaitlistClaims,
  runWaitlistOffers,
} from "@/lib/waitlist-offers";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const now = new Date("2026-09-14T13:00:00Z");

const queueRow = (overrides: Record<string, unknown> = {}) => ({
  _id: ENTRY,
  service: "standard",
  preferredPeriods: [],
  preferredDays: [],
  offers: [],
  ...overrides,
});

const contact = (overrides: Record<string, unknown> = {}) => ({
  _id: ENTRY,
  firstName: "Amel",
  email: "amel@example.com",
  phone: "438 555-0189",
  locale: "fr",
  smsConsent: { given: true },
  professionalName: "Dre Nadia Sassi",
  showcaseSlug: "sassi",
  cityKey: "mascouche",
  ...overrides,
});

beforeEach(() => {
  process.env.NEXTAUTH_URL = "https://www.jechemine.ca";
  h.enabled = true;
  h.order = [];
  h.finds = [];
  h.findResults = [];
  h.contact = contact();
  h.updates = [];
  h.modified = [];
  h.exists = true;
  h.distinct = [];
  h.page = { slug: "sassi" };
  h.bookable = {
    professionalId: PRO,
    slug: "sassi",
    cityKey: "mascouche",
    displayName: "Dre Nadia Sassi",
    services: { standard: { offered: true, durationMinutes: 50, price: 130 }, quick: { offered: false, durationMinutes: 30, price: 70 } },
  };
  h.slotsCalls = [];
  h.hold = { ok: true, holdId: HOLD };
  h.holdCalls = [];
  h.releases = [];
  h.request = null;
  h.emails = [];
  h.sms = [];
  h.directFails = false;
  h.directCalls = 0;
  h.purges = 0;
});

describe("offerFreeSlotsForProfessional", () => {
  it("holds the first time far enough ahead, then claims the person, then writes to them", async () => {
    h.findResults = [[queueRow()]];
    expect(await offerFreeSlotsForProfessional(PRO, now)).toEqual({ offered: 1 });

    // 10:00 is less than 2 h 15 from 09:00: too close to be requested once claimed.
    expect(h.holdCalls).toEqual([
      {
        professionalId: PRO,
        dayKey: "2026-09-14",
        time: "11:30",
        startsAt: new Date("2026-09-14T15:30:00Z"),
        durationMinutes: 50,
        kind: "waitlist_offer",
        expiresAt: new Date("2026-09-14T13:15:00Z"),
        waitlistEntryId: ENTRY,
        now,
      },
    ]);
    expect(h.order).toEqual(["hold", "claim"]);

    const [filter, update] = h.updates[0] as Update;
    expect(filter).toEqual({ _id: ENTRY, status: "active" });
    expect(update.$set).toEqual({ status: "offered", isOpen: true });
    const offer = update.$push.offers as Record<string, unknown>;
    expect(offer).toMatchObject({ dayKey: "2026-09-14", time: "11:30", outcome: "pending", channels: ["email", "sms"] });

    const [kind, email] = h.emails[0];
    expect(kind).toBe("offer");
    const token = String(email.claimUrl).split("t=")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Only the hash is stored; the link carries the token.
    expect(offer.tokenHash).toBe(sha256(token));
    expect(email).toMatchObject({ firstName: "Amel", email: "amel@example.com", dayKey: "2026-09-14", time: "11:30", locale: "fr" });

    const [to, body] = h.sms[0];
    expect(to).toBe("438 555-0189");
    expect(body.endsWith(`https://www.jechemine.ca/la/${token}`)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(160);
  });

  it("texts only a person who consented to it and gave a number", async () => {
    h.findResults = [[queueRow()]];
    h.contact = contact({ smsConsent: { given: false } });
    await offerFreeSlotsForProfessional(PRO, now);
    expect(h.sms).toEqual([]);
    expect(((h.updates[0] as Update)[1].$push.offers as Record<string, unknown>).channels).toEqual(["email"]);

    h.findResults = [[queueRow()]];
    h.updates = [];
    h.contact = contact({ phone: null });
    await offerFreeSlotsForProfessional(PRO, now);
    expect(h.sms).toEqual([]);
  });

  it("never offers a person the same time twice", async () => {
    h.findResults = [[queueRow({ offers: [{ dayKey: "2026-09-14", time: "11:30" }] })]];
    await offerFreeSlotsForProfessional(PRO, now);
    expect(h.holdCalls[0]).toMatchObject({ dayKey: "2026-09-15", time: "09:00" });
  });

  it("gives the time back when the person was taken meanwhile, and writes to no one", async () => {
    h.findResults = [[queueRow()]];
    h.modified = [0];
    expect(await offerFreeSlotsForProfessional(PRO, now)).toEqual({ offered: 0 });
    expect(h.releases).toEqual([[HOLD, { waitlistEntryId: ENTRY, kind: "waitlist_offer" }]]);
    expect(h.emails).toEqual([]);
    expect(h.sms).toEqual([]);
  });

  it("claims no one when another offer or request holds the time first", async () => {
    h.findResults = [[queueRow()]];
    h.hold = { ok: false };
    expect(await offerFreeSlotsForProfessional(PRO, now)).toEqual({ offered: 0 });
    expect(h.updates).toEqual([]);
    expect(h.emails).toEqual([]);
  });

  it("offers nothing while the pages are off, without a published page, or for a closed consultation", async () => {
    h.enabled = false;
    h.findResults = [[queueRow()]];
    await offerFreeSlotsForProfessional(PRO, now);
    expect(h.finds).toEqual([]);
    h.enabled = true;
    h.findResults = [[queueRow()]];
    h.page = null;
    await offerFreeSlotsForProfessional(PRO, now);
    h.page = { slug: "sassi" };
    h.findResults = [[queueRow({ service: "quick" })]];
    await offerFreeSlotsForProfessional(PRO, now);
    expect(h.holdCalls).toEqual([]);
    expect(h.slotsCalls).toEqual([]);
  });

  it("does not even look for times when nobody waits", async () => {
    h.exists = false;
    await notifySlotFreed(PRO);
    expect(h.finds).toEqual([]);
  });
});

describe("expireWaitlistOffers", () => {
  const offered = (missedOffers: number) => ({
    ...contact(),
    missedOffers,
    offers: [
      { tokenHash: "old", holdId: "0123456789abcdef0123ffff", outcome: "expired", expiresAt: new Date("2026-09-10T00:00:00Z") },
      { tokenHash: "live", holdId: HOLD, outcome: "pending", expiresAt: new Date("2026-09-14T12:59:00Z") },
    ],
  });

  it("frees the time and keeps the person's place, counting a miss", async () => {
    h.findResults = [[offered(0)]];
    expect(await expireWaitlistOffers(now)).toEqual({ expired: 1, removed: 0 });
    const [filter, update] = h.updates[0] as Update;
    expect(filter).toEqual({ _id: ENTRY, status: "offered", offers: { $elemMatch: { tokenHash: "live", outcome: "pending" } } });
    expect(update.$set).toEqual({ "offers.$.outcome": "expired", status: "active", isOpen: true });
    expect(update.$inc).toEqual({ missedOffers: 1 });
    expect(h.releases).toEqual([[HOLD, { waitlistEntryId: ENTRY, kind: "waitlist_offer" }]]);
    expect(h.emails).toEqual([]);
  });

  it("ends the place at the third miss and tells the person", async () => {
    h.findResults = [[offered(2)]];
    expect(await expireWaitlistOffers(now)).toEqual({ expired: 1, removed: 1 });
    const [, update] = h.updates[0] as Update;
    expect(update.$set).toEqual({
      "offers.$.outcome": "expired",
      status: "expired",
      isOpen: false,
      removedReason: "missed",
      closedAt: now,
    });
    expect(h.emails).toEqual([
      [
        "removed",
        {
          firstName: "Amel",
          email: "amel@example.com",
          professionalName: "Dre Nadia Sassi",
          reason: "missed",
          pageUrl: "https://psymascouche.jechemine.ca/sassi",
          locale: "fr",
        },
      ],
    ]);
  });

  it("leaves an offer another run or a claim already settled", async () => {
    h.findResults = [[offered(0)]];
    h.modified = [0];
    expect(await expireWaitlistOffers(now)).toEqual({ expired: 0, removed: 0 });
    expect(h.releases).toEqual([]);
  });
});

describe("recoverStaleWaitlistClaims", () => {
  const stuck = () => ({
    _id: ENTRY,
    offers: [{ tokenHash: "live", holdId: HOLD, outcome: "claiming", claimingAt: new Date("2026-09-14T12:40:00Z") }],
  });

  it("marks the entry converted when its request was saved", async () => {
    h.findResults = [[stuck()]];
    h.request = { _id: APPT, clientId: "client-1" };
    expect(await recoverStaleWaitlistClaims(now)).toEqual({ recovered: 1 });
    const [, update] = h.updates[0] as Update;
    expect(update.$set).toMatchObject({
      "offers.$.outcome": "claimed",
      "offers.$.appointmentId": APPT,
      status: "converted",
      isOpen: false,
      userId: "client-1",
    });
    expect(h.releases).toEqual([]);
  });

  it("gives the person their place back, without a miss, when no request was saved", async () => {
    h.findResults = [[stuck()]];
    expect(await recoverStaleWaitlistClaims(now)).toEqual({ recovered: 1 });
    const [, update] = h.updates[0] as Update;
    expect(update.$set).toEqual({ "offers.$.outcome": "slot_lost", status: "active", isOpen: true });
    expect(update.$inc).toBeUndefined();
    expect(h.releases).toEqual([[HOLD, { waitlistEntryId: ENTRY, kind: "waitlist_offer" }]]);
  });
});

describe("expireWaitlistEntries", () => {
  it("ends places 90 days old and tells the person", async () => {
    h.findResults = [[contact()]];
    expect(await expireWaitlistEntries(now)).toEqual({ expired: 1 });
    expect(h.finds[0]).toEqual({ status: "active", expiresAt: { $lte: now } });
    expect((h.updates[0] as Update)[1].$set).toEqual({ status: "expired", isOpen: false, removedReason: "expired", closedAt: now });
    expect(h.emails[0][1]).toMatchObject({ reason: "expired" });
  });
});

describe("runWaitlistOffers", () => {
  it("keeps expiring while the pages are off, but offers nothing", async () => {
    h.enabled = false;
    h.distinct = [PRO];
    const result = await runWaitlistOffers(now);
    expect(result).toMatchObject({ directExpired: 2, purged: 4, offered: 0 });
    expect(h.directCalls).toBe(1);
    expect(h.purges).toBe(1);
    expect(h.holdCalls).toEqual([]);
  });

  it("runs every step even when one fails", async () => {
    h.directFails = true;
    h.distinct = [PRO];
    h.findResults = [[], [], [], [queueRow()]];
    const result = await runWaitlistOffers(now);
    expect(result.directExpired).toBe(0);
    expect(h.purges).toBe(1);
    expect(result.offered).toBe(1);
  });
});

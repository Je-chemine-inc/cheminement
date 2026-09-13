import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

const PRO = "0123456789abcdef01234567";
const ENTRY = "0123456789abcdef0123eeee";
const HOLD = "0123456789abcdef0123cccc";
const USER = "0123456789abcdef0123dddd";
const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";

const h = vi.hoisted(() => ({
  enabled: true,
  bookable: null as Record<string, unknown> | null,
  validMotifs: new Set<string>(["Anxiété", "Stress"]),
  exists: false,
  existsCalls: [] as Record<string, unknown>[],
  count: 0,
  creates: [] as Record<string, unknown>[],
  createError: null as unknown,
  fau: [] as unknown[],
  fauCalls: [] as [Record<string, unknown>, Record<string, Record<string, unknown>>, Record<string, unknown>][],
  findOne: null as Record<string, unknown> | null,
  findResults: [] as unknown[],
  updates: [] as [Record<string, unknown>, Record<string, Record<string, unknown>>][],
  releases: [] as unknown[][],
  removals: [] as unknown[][],
  page: { slug: "sassi-2" } as { slug: string } | null,
  prepared: null as Record<string, unknown> | null,
  prepareCalls: [] as Record<string, unknown>[],
  attaches: [] as unknown[][],
  abandons: 0,
  appointments: [] as Record<string, unknown>[],
  saveFails: false,
  existingUser: null as Record<string, unknown> | null,
  users: [] as Record<string, unknown>[],
}));

const chain = (result: unknown) => {
  const query = { sort: () => query, select: () => query, limit: () => query, lean: async () => result };
  return query;
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/showcase-booking", () => ({ loadBookableShowcase: async () => h.bookable }));
vi.mock("@/lib/motifs", () => ({ getValidMotifLabels: async () => h.validMotifs }));
vi.mock("@/lib/showcase-hosts", () => ({
  absoluteShowcaseUrl: (city: string, path: string) => `https://psy${city}.jechemine.ca${path}`,
}));
vi.mock("@/lib/showcase-cities", () => ({ findShowcaseCity: () => ({ name: "Mascouche" }) }));
vi.mock("@/lib/slot-holds", () => ({
  releaseSlotHold: async (...args: unknown[]) => {
    h.releases.push(args);
    return true;
  },
}));
vi.mock("@/lib/waitlist-offers", () => ({
  notifyWaitlistRemoved: async (...args: unknown[]) => {
    h.removals.push(args);
  },
}));
vi.mock("@/lib/direct-request", () => ({
  prepareDirectRequest: async (input: Record<string, unknown>) => {
    h.prepareCalls.push(input);
    return h.prepared;
  },
  attachDirectRequest: async (...args: unknown[]) => {
    h.attaches.push(args);
  },
  abandonDirectRequest: async () => {
    h.abandons++;
  },
}));
vi.mock("@/models/WaitlistEntry", () => ({
  default: {
    exists: async (filter: Record<string, unknown>) => {
      h.existsCalls.push(filter);
      return h.exists;
    },
    countDocuments: async () => h.count,
    create: async (fields: Record<string, unknown>) => {
      if (h.createError) throw h.createError;
      h.creates.push(fields);
      return { _id: ENTRY, ...fields };
    },
    findOneAndUpdate: (
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
      options: Record<string, unknown>,
    ) => {
      h.fauCalls.push([filter, update, options]);
      return { lean: async () => (h.fau.length > 0 ? h.fau.shift() : null) };
    },
    findOne: () => chain(h.findOne),
    find: () => chain(h.findResults.length > 0 ? h.findResults.shift() : []),
    updateOne: async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      h.updates.push([filter, update]);
      return { modifiedCount: 1 };
    },
  },
}));
vi.mock("@/models/ShowcasePage", () => ({ default: { findOne: () => chain(h.page) } }));
vi.mock("@/models/Appointment", () => ({
  default: class {
    _id = "0123456789abcdef0123aaaa";
    constructor(fields: Record<string, unknown>) {
      h.appointments.push(fields);
    }
    async save() {
      if (h.saveFails) throw new Error("save failed");
    }
  },
}));
vi.mock("@/models/User", () => ({
  default: Object.assign(
    class {
      _id = USER;
      constructor(fields: Record<string, unknown>) {
        h.users.push(fields);
      }
      async save() {}
    },
    { findOne: async () => h.existingUser },
  ),
}));

import {
  claimWaitlistOffer,
  joinWaitlist,
  leaveWaitlist,
  listAdminWaitlist,
  listProfessionalWaitlist,
  readWaitlistOffer,
  removeWaitlistEntry,
} from "@/lib/waitlist-entries";
import { WAITLIST_CONSENT_VERSION, type WaitlistJoinInput } from "@/lib/waitlist-rules";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const now = new Date("2026-09-14T13:00:00Z");

const form = (overrides: Partial<WaitlistJoinInput> = {}): WaitlistJoinInput => ({
  firstName: "Amel",
  lastName: "Sassi",
  email: "amel@example.com",
  phone: "438 555-0189",
  locale: "fr",
  service: "standard",
  modality: "video",
  motifs: ["Anxiété"],
  periods: ["morning"],
  days: [],
  smsConsent: true,
  ...overrides,
});

const offeredEntry = (offer: Record<string, unknown> = {}) => ({
  _id: ENTRY,
  professionalId: PRO,
  professionalName: "Dre Nadia Sassi",
  showcaseSlug: "sassi",
  cityKey: "mascouche",
  firstName: "Amel",
  lastName: "Sassi",
  email: "amel@example.com",
  phone: "438 555-0189",
  locale: "fr",
  service: "standard",
  modality: "in-person",
  motifs: ["Anxiété"],
  status: "offered",
  offers: [
    {
      tokenHash: sha256(TOKEN),
      holdId: HOLD,
      dayKey: "2026-09-16",
      time: "10:00",
      durationMinutes: 50,
      sentAt: new Date("2026-09-14T12:55:00Z"),
      expiresAt: new Date("2026-09-14T13:10:00Z"),
      outcome: "pending",
      ...offer,
    },
  ],
});

beforeEach(() => {
  process.env.NEXTAUTH_URL = "https://www.jechemine.ca";
  h.enabled = true;
  h.bookable = {
    professionalId: PRO,
    slug: "sassi",
    cityKey: "mascouche",
    displayName: "Dre Nadia Sassi",
    services: { standard: { offered: true, durationMinutes: 50, price: 130 }, quick: { offered: false, durationMinutes: 30, price: null } },
  };
  h.exists = false;
  h.existsCalls = [];
  h.count = 0;
  h.creates = [];
  h.createError = null;
  h.fau = [];
  h.fauCalls = [];
  h.findOne = null;
  h.findResults = [];
  h.updates = [];
  h.releases = [];
  h.removals = [];
  h.page = { slug: "sassi-2" };
  h.prepared = {
    ok: true,
    holdId: HOLD,
    professionalId: PRO,
    pricing: { sessionPrice: 130, platformFee: 30, professionalPayout: 100 },
    fields: {
      status: "pending",
      routingStatus: "proposed",
      directRequest: {
        professionalName: "Dre Nadia Sassi",
        respondBy: new Date("2026-09-15T13:00:00Z"),
        source: "waitlist",
      },
    },
  };
  h.prepareCalls = [];
  h.attaches = [];
  h.abandons = 0;
  h.appointments = [];
  h.saveFails = false;
  h.existingUser = { _id: USER };
  h.users = [];
});

describe("joinWaitlist", () => {
  const join = (overrides: Partial<WaitlistJoinInput> = {}) =>
    joinWaitlist({ slug: "sassi", form: form(overrides), ip: "203.0.113.9", now });

  it("does nothing while the pages are off or the page is not published", async () => {
    h.enabled = false;
    expect(await join()).toEqual({ ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" });
    h.enabled = true;
    h.bookable = null;
    expect(await join()).toEqual({ ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" });
    expect(h.existsCalls).toEqual([]);
  });

  it("accepts only reasons from the list", async () => {
    expect(await join({ motifs: ["Anxiété", "Inventé"] })).toEqual({ ok: false, status: 400, code: "INVALID_MOTIFS" });
    expect(h.creates).toEqual([]);
  });

  it("answers the same for someone already waiting, and writes nothing", async () => {
    h.exists = true;
    expect(await join()).toEqual({ ok: true, created: false, professionalId: PRO });
    expect(h.existsCalls[0]).toEqual({ professionalId: PRO, email: "amel@example.com", isOpen: true });
    expect(h.creates).toEqual([]);
  });

  it("refuses a 51st person", async () => {
    h.count = 50;
    expect(await join()).toEqual({ ok: false, status: 409, code: "WAITLIST_FULL" });
    expect(h.creates).toEqual([]);
  });

  it("records the place with the consent, a hashed leave link and a 90-day end", async () => {
    const result = await join();
    if (!result.ok || !result.created) throw new Error("expected a new entry");
    const token = result.leaveUrl.split("t=")[1];
    expect(result.leaveUrl).toBe(`https://www.jechemine.ca/liste-attente/quitter?t=${token}`);
    expect(result.pageUrl).toBe("https://psymascouche.jechemine.ca/sassi");
    expect(h.creates[0]).toMatchObject({
      professionalId: PRO,
      showcaseSlug: "sassi",
      professionalName: "Dre Nadia Sassi",
      email: "amel@example.com",
      phone: "438 555-0189",
      consent: { at: now, version: WAITLIST_CONSENT_VERSION, ip: "203.0.113.9" },
      smsConsent: { given: true, at: now, version: WAITLIST_CONSENT_VERSION },
      status: "active",
      isOpen: true,
      missedOffers: 0,
      leaveTokenHash: sha256(token),
      expiresAt: new Date("2026-12-13T13:00:00Z"),
    });
    expect(JSON.stringify(h.creates[0])).not.toContain(token);
  });

  it("stores no phone and no text consent when none was given", async () => {
    await join({ phone: null, smsConsent: false });
    expect(h.creates[0]).not.toHaveProperty("phone");
    expect(h.creates[0].smsConsent).toEqual({ given: false });
  });

  it("treats a join racing another one as already waiting", async () => {
    h.createError = { code: 11000 };
    expect(await join()).toEqual({ ok: true, created: false, professionalId: PRO });
  });
});

describe("leaving and removal", () => {
  const closing = () => ({
    _id: ENTRY,
    professionalId: PRO,
    firstName: "Amel",
    email: "amel@example.com",
    professionalName: "Dre Nadia Sassi",
    showcaseSlug: "sassi",
    cityKey: "mascouche",
    offers: [
      { holdId: "0123456789abcdef0123ffff", outcome: "expired" },
      { holdId: HOLD, outcome: "pending" },
    ],
  });

  it("reads nothing for a link that cannot be a leave link", async () => {
    expect(await leaveWaitlist("nope", now)).toEqual({ ok: false });
    expect(h.fauCalls).toEqual([]);
  });

  it("closes the entry, withdraws an offer still out and frees its time", async () => {
    const token = "a".repeat(64);
    h.fau = [closing()];
    expect(await leaveWaitlist(token, now)).toEqual({ ok: true, professionalId: PRO, freedTime: true });
    const [filter, update, options] = h.fauCalls[0];
    expect(filter).toEqual({
      leaveTokenHash: sha256(token),
      isOpen: true,
      offers: { $not: { $elemMatch: { outcome: "claiming" } } },
    });
    expect(update.$set).toEqual({ status: "left", isOpen: false, closedAt: now, "offers.$[out].outcome": "withdrawn" });
    expect(options).toEqual({ new: false, arrayFilters: [{ "out.outcome": "pending" }] });
    expect(h.releases).toEqual([[HOLD, { waitlistEntryId: ENTRY, kind: "waitlist_offer" }]]);
    expect(h.removals).toEqual([]);
  });

  it("lets a professional remove only from their own list, and tells the person", async () => {
    h.fau = [closing()];
    expect(await removeWaitlistEntry({ entryId: ENTRY, by: "professional", professionalId: PRO, now })).toEqual({
      ok: true,
      professionalId: PRO,
      freedTime: true,
    });
    expect(h.fauCalls[0][0]).toMatchObject({ _id: ENTRY, professionalId: PRO });
    expect(h.fauCalls[0][1].$set).toMatchObject({ status: "removed", removedReason: "professional" });
    expect(h.removals[0][1]).toBe("professional");

    expect(await removeWaitlistEntry({ entryId: ENTRY, by: "professional", now })).toEqual({ ok: false });
    expect(await removeWaitlistEntry({ entryId: ENTRY, by: "admin", now })).toEqual({ ok: false });
    expect(h.removals).toHaveLength(1);
  });
});

describe("readWaitlistOffer", () => {
  it("tells an unknown, a used and a lapsed link apart", async () => {
    expect(await readWaitlistOffer("short", now)).toEqual({ ok: false, code: "OFFER_INVALID" });
    h.findOne = null;
    expect(await readWaitlistOffer(TOKEN, now)).toEqual({ ok: false, code: "OFFER_INVALID" });
    h.findOne = offeredEntry({ outcome: "claiming" });
    expect(await readWaitlistOffer(TOKEN, now)).toEqual({ ok: false, code: "OFFER_CLAIMED" });
    h.findOne = offeredEntry({ outcome: "claimed" });
    expect(await readWaitlistOffer(TOKEN, now)).toEqual({ ok: false, code: "OFFER_CLAIMED" });
    h.findOne = offeredEntry({ expiresAt: new Date("2026-09-14T13:00:00Z") });
    expect(await readWaitlistOffer(TOKEN, now)).toEqual({ ok: false, code: "OFFER_EXPIRED" });
  });

  it("shows the time, the price and the page, never the token's hash", async () => {
    h.findOne = offeredEntry();
    const result = await readWaitlistOffer(TOKEN, now);
    expect(result).toEqual({
      ok: true,
      offer: {
        professionalName: "Dre Nadia Sassi",
        service: "standard",
        dayKey: "2026-09-16",
        time: "10:00",
        durationMinutes: 50,
        expiresAt: "2026-09-14T13:10:00.000Z",
        price: 130,
        pageUrl: "https://psymascouche.jechemine.ca/sassi",
      },
    });
    expect(JSON.stringify(result)).not.toContain(sha256(TOKEN));
  });
});

describe("claimWaitlistOffer", () => {
  it("claims only a live, pending offer, in one step", async () => {
    h.fau = [offeredEntry({ outcome: "claiming" })];
    await claimWaitlistOffer(TOKEN, now);
    const [filter, update] = h.fauCalls[0];
    expect(filter).toEqual({
      status: "offered",
      offers: { $elemMatch: { tokenHash: sha256(TOKEN), outcome: "pending", expiresAt: { $gt: now } } },
    });
    expect(update.$set).toEqual({ "offers.$.outcome": "claiming", "offers.$.claimingAt": now });
  });

  it("says why when the claim is lost, without touching anything", async () => {
    expect(await claimWaitlistOffer("short", now)).toEqual({ ok: false, status: 410, code: "OFFER_INVALID" });
    h.findOne = offeredEntry({ outcome: "claimed" });
    expect(await claimWaitlistOffer(TOKEN, now)).toEqual({ ok: false, status: 410, code: "OFFER_CLAIMED" });
    h.enabled = false;
    expect(await claimWaitlistOffer(TOKEN, now)).toEqual({ ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" });
    expect(h.prepareCalls).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("turns the offer into a request to the professional, from the page's current address", async () => {
    h.fau = [offeredEntry({ outcome: "claiming" })];
    const result = await claimWaitlistOffer(TOKEN, now);
    expect(result).toEqual({
      ok: true,
      appointmentId: "0123456789abcdef0123aaaa",
      professionalName: "Dre Nadia Sassi",
      dayKey: "2026-09-16",
      time: "10:00",
      respondBy: new Date("2026-09-15T13:00:00Z"),
    });
    expect(h.prepareCalls).toEqual([
      {
        intent: { slug: "sassi-2", service: "standard", date: "2026-09-16", time: "10:00" },
        therapyType: "solo",
        now,
        waitlist: { entryId: ENTRY, holdId: HOLD },
      },
    ]);
    expect(h.appointments[0]).toMatchObject({
      clientId: USER,
      type: "in-person",
      bookingFor: "self",
      needs: ["Anxiété"],
      payment: { price: 130, platformFee: 30, professionalPayout: 100, status: "pending", method: "card" },
      routingStatus: "proposed",
      directRequest: { source: "waitlist" },
    });
    expect(h.attaches).toEqual([[h.prepared, "0123456789abcdef0123aaaa"]]);
    const [filter, update] = h.updates[0];
    expect(filter).toEqual({ _id: ENTRY, offers: { $elemMatch: { tokenHash: sha256(TOKEN), outcome: "claiming" } } });
    expect(update.$set).toEqual({
      "offers.$.outcome": "claimed",
      "offers.$.appointmentId": "0123456789abcdef0123aaaa",
      status: "converted",
      isOpen: false,
      closedAt: now,
      userId: USER,
    });
    expect(h.releases).toEqual([]);
  });

  it("creates a prospect account for a person without one", async () => {
    h.existingUser = null;
    h.fau = [offeredEntry({ outcome: "claiming" })];
    await claimWaitlistOffer(TOKEN, now);
    expect(h.users[0]).toMatchObject({
      email: "amel@example.com",
      firstName: "Amel",
      lastName: "Sassi",
      phone: "438 555-0189",
      location: "Mascouche",
      role: "prospect",
      language: "fr",
    });
  });

  it("gives the person their place back, without a miss, when the time can no longer be requested", async () => {
    h.fau = [offeredEntry({ outcome: "claiming" })];
    h.prepared = { ok: false, status: 409, code: "SLOT_TAKEN" };
    expect(await claimWaitlistOffer(TOKEN, now)).toEqual({ ok: false, status: 409, code: "OFFER_UNAVAILABLE" });
    expect(h.appointments).toEqual([]);
    const [, update] = h.updates[0];
    expect(update.$set).toEqual({ "offers.$.outcome": "slot_lost", status: "active", isOpen: true });
    expect(update.$inc).toBeUndefined();
    expect(h.releases).toEqual([[HOLD, { waitlistEntryId: ENTRY, kind: "waitlist_offer" }]]);

    h.fau = [offeredEntry({ outcome: "claiming" })];
    h.page = null;
    h.prepareCalls = [];
    expect(await claimWaitlistOffer(TOKEN, now)).toEqual({ ok: false, status: 409, code: "OFFER_UNAVAILABLE" });
    expect(h.prepareCalls).toEqual([]);
  });

  it("frees everything when the request cannot be saved", async () => {
    h.fau = [offeredEntry({ outcome: "claiming" })];
    h.saveFails = true;
    await expect(claimWaitlistOffer(TOKEN, now)).rejects.toThrow("save failed");
    expect(h.abandons).toBe(1);
    expect(h.updates[0][1].$set).toMatchObject({ "offers.$.outcome": "slot_lost" });
    expect(h.attaches).toEqual([]);
  });
});

describe("lists", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    _id: ENTRY,
    professionalId: PRO,
    professionalName: "Dre Nadia Sassi",
    showcaseSlug: "sassi",
    cityKey: "mascouche",
    firstName: "Amel",
    lastName: "sassi",
    email: "amel@example.com",
    phone: "438 555-0189",
    locale: "fr",
    service: "standard",
    modality: "video",
    motifs: [],
    preferredPeriods: ["morning"],
    preferredDays: [],
    consent: { at: now, version: WAITLIST_CONSENT_VERSION },
    smsConsent: { given: true },
    status: "offered",
    isOpen: true,
    missedOffers: 1,
    expiresAt: new Date("2026-12-13T13:00:00Z"),
    createdAt: now,
    offers: [{ dayKey: "2026-09-16", time: "10:00", sentAt: now, expiresAt: new Date("2026-09-14T13:15:00Z"), outcome: "pending", channels: ["email"] }],
    ...overrides,
  });

  it("shows a professional first names and initials in queue order, never contact details", async () => {
    h.findResults = [[row(), row({ _id: "0123456789abcdef0123ffff", firstName: "Luc", lastName: "Roy", offers: [] })]];
    const rows = await listProfessionalWaitlist(PRO);
    expect(rows.map((item) => [item.position, item.name, item.offer])).toEqual([
      [1, "Amel S.", { dayKey: "2026-09-16", time: "10:00", expiresAt: "2026-09-14T13:15:00.000Z" }],
      [2, "Luc R.", null],
    ]);
    expect(JSON.stringify(rows)).not.toContain("amel@example.com");
    expect(JSON.stringify(rows)).not.toContain("555-0189");
  });

  it("hides contact details from an admin without the patients permission", async () => {
    h.findResults = [[row()], [{ _id: ENTRY, professionalId: PRO }]];
    const [hidden] = await listAdminWaitlist({ scope: "open", showContact: false });
    expect(hidden).toMatchObject({ email: null, phone: null, position: 1, smsConsent: true });
    h.findResults = [[row()], [{ _id: ENTRY, professionalId: PRO }]];
    const [shown] = await listAdminWaitlist({ scope: "open", showContact: true });
    expect(shown).toMatchObject({ email: "amel@example.com", phone: "438 555-0189" });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

const PRO = "0123456789abcdef01234567";
const OTHER = "0123456789abcdef0123bbbb";
const APPT = "0123456789abcdef0123aaaa";
const HOLD = "0123456789abcdef0123cccc";

const h = vi.hoisted(() => ({
  enabled: true,
  bookable: null as Record<string, unknown> | null,
  slotFree: true,
  slotFreeArgs: [] as unknown[][],
  convert: true,
  converts: [] as Record<string, unknown>[],
  hold:{ ok: true, holdId: "0123456789abcdef0123cccc" } as { ok: boolean; holdId?: string; code?: string },
  holdCalls: [] as Record<string, unknown>[],
  pricingCalls: [] as unknown[][],
  releases: [] as unknown[][],
  current: null as Record<string, unknown> | null,
  claimed: null as Record<string, unknown> | null,
  claims: [] as [Record<string, unknown>, Record<string, Record<string, unknown>>][],
  due: [] as { _id: string }[],
  populated: null as Record<string, unknown> | null,
  professional: null as Record<string, unknown> | null,
  emails: [] as [string, Record<string, unknown>][],
  waitlistUpdates: [] as [Record<string, unknown>, Record<string, unknown>][],
  waitlistModified: 1,
  waitlistThrows: null as unknown,
  waitlistOpen: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/showcase-booking", () => ({
  loadBookableShowcase: async () => h.bookable,
  isShowcaseSlotFree: async (...args: unknown[]) => {
    h.slotFreeArgs.push(args);
    return h.slotFree;
  },
}));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: async (...args: unknown[]) => {
    h.pricingCalls.push(args);
    return { sessionPrice: 130, platformFee: 30, professionalPayout: 100, currency: "CAD", source: "professional", rateClamped: false };
  },
}));
vi.mock("@/lib/slot-holds", () => ({
  acquireSlotHold: async (input: Record<string, unknown>) => {
    h.holdCalls.push(input);
    return h.hold;
  },
  attachSlotHoldToAppointment: async () => true,
  convertOfferHoldToRequest: async (input: Record<string, unknown>) => {
    h.converts.push(input);
    return h.convert;
  },
  releaseSlotHold: async (...args: unknown[]) => {
    h.releases.push(args);
    return true;
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => ({
      select: () => ({ lean: async () => h.current }),
      populate: async () => h.populated,
    }),
    findOneAndUpdate: (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      h.claims.push([filter, update]);
      return Object.assign(Promise.resolve(h.claimed), { select: () => Promise.resolve(h.claimed) });
    },
    find: () => ({ select: () => ({ limit: () => ({ lean: async () => h.due }) }) }),
  },
}));
vi.mock("@/models/WaitlistEntry", () => ({
  default: {
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      h.waitlistUpdates.push([filter, update]);
      if (h.waitlistThrows) throw h.waitlistThrows;
      return { modifiedCount: h.waitlistModified };
    },
    exists: async () => (h.waitlistOpen ? { _id: "entry" } : null),
  },
}));
vi.mock("@/models/User", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => h.professional }) }) },
}));
vi.mock("@/lib/guardian-utils", () => ({
  resolveAppointmentRecipient: (
    _appointment: unknown,
    client: { firstName?: string; lastName?: string; email: string; language?: string },
  ) => ({ name: `${client.firstName} ${client.lastName}`, email: client.email, language: client.language ?? "fr" }),
}));
vi.mock("@/lib/notifications", () => {
  const record = (name: string) => async (data: Record<string, unknown>) => {
    h.emails.push([name, data]);
    return true;
  };
  return {
    sendDirectRequestReceivedEmail: record("received"),
    sendDirectRequestConfirmationEmail: record("confirmation"),
    sendDirectRequestUnavailableEmail: record("unavailable"),
    sendAdminDirectRequestReturnedAlert: record("admin"),
  };
});

import {
  abandonDirectRequest,
  notifyDirectRequestCreated,
  notifyDirectRequestReleased,
  prepareDirectRequest,
  releaseDirectRequest,
  rerouteDirectRequest,
  runDirectRequestTimeouts,
} from "@/lib/direct-request";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// Monday 14 September 2026, 09:00 in Montréal.
const now = new Date("2026-09-14T13:00:00Z");
const intent = { slug: "sassi", service: "standard" as const, date: "2026-09-16", time: "10:00" };
const bookable = () => ({
  pageId: "page-1",
  professionalId: PRO,
  slug: "sassi",
  cityKey: "mascouche",
  displayName: "Dre Amel Sassi",
  availability: null,
  services: {
    standard: { offered: true, durationMinutes: 50, price: 130 },
    quick: { offered: true, durationMinutes: 30, price: 70 },
  },
});

beforeEach(() => {
  h.enabled = true;
  h.bookable = bookable();
  h.slotFree = true;
  h.slotFreeArgs = [];
  h.convert = true;
  h.converts = [];
  h.hold = { ok: true, holdId: HOLD };
  h.holdCalls = [];
  h.pricingCalls = [];
  h.releases = [];
  h.current = null;
  h.claimed = null;
  h.claims = [];
  h.due = [];
  h.populated = null;
  h.professional = null;
  h.emails = [];
  h.waitlistUpdates = [];
  h.waitlistModified = 1;
  h.waitlistThrows = null;
  h.waitlistOpen = false;
});

describe("prepareDirectRequest", () => {
  it("holds the slot for as long as the professional has to answer, and proposes the request to them alone", async () => {
    const result = await prepareDirectRequest({ intent, therapyType: "couple", now });
    if (!result.ok) throw new Error("expected a prepared request");
    const startsAt = new Date("2026-09-16T14:00:00Z");
    const respondBy = new Date("2026-09-15T13:00:00Z");
    expect(h.holdCalls).toEqual([
      { professionalId: PRO, dayKey: "2026-09-16", time: "10:00", startsAt, durationMinutes: 50, kind: "direct_request", expiresAt: respondBy, now },
    ]);
    expect(h.pricingCalls).toEqual([[PRO, "couple", { quick: false }]]);
    expect(result.fields).toMatchObject({
      status: "pending",
      routingStatus: "proposed",
      proposedAt: now,
      date: new Date("2026-09-16T12:00:00Z"),
      time: "10:00",
      duration: 50,
      therapyType: "couple",
      directRequest: {
        showcaseSlug: "sassi",
        cityKey: "mascouche",
        service: "standard",
        source: "showcase",
        dayKey: "2026-09-16",
        time: "10:00",
        startsAt,
        professionalName: "Dre Amel Sassi",
        respondBy,
        state: "pending",
      },
    });
    expect(result.fields.proposedTo.map(String)).toEqual([PRO]);
    expect(String(result.fields.directRequest.holdId)).toBe(HOLD);
    // Never assigned up front: the accept claim relies on professionalId being empty.
    expect(result.fields).not.toHaveProperty("professionalId");
    expect(result.fields).not.toHaveProperty("isEmergency");
  });

  it("books a quick consultation as a solo emergency request with a 12-hour answer", async () => {
    const result = await prepareDirectRequest({ intent: { ...intent, service: "quick" }, therapyType: "couple", now });
    if (!result.ok) throw new Error("expected a prepared request");
    expect(result.fields).toMatchObject({ therapyType: "solo", isEmergency: true, duration: 30 });
    expect(h.pricingCalls).toEqual([[PRO, "solo", { quick: true }]]);
    expect(h.holdCalls[0]).toMatchObject({ durationMinutes: 30, expiresAt: new Date("2026-09-15T01:00:00Z") });
  });

  it("refuses without holding anything when the pages are off, the page is gone, the consultation closed or the time taken", async () => {
    const run = () => prepareDirectRequest({ intent, therapyType: "solo", now });
    h.enabled = false;
    expect(await run()).toEqual({ ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" });
    h.enabled = true;
    h.bookable = null;
    expect(await run()).toEqual({ ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" });
    const closed = bookable();
    closed.services.standard.offered = false;
    h.bookable = closed;
    expect(await run()).toEqual({ ok: false, status: 409, code: "SERVICE_UNAVAILABLE" });
    h.bookable = bookable();
    h.slotFree = false;
    expect(await run()).toEqual({ ok: false, status: 409, code: "SLOT_TAKEN" });
    expect(h.holdCalls).toEqual([]);
  });

  it("turns a claimed waitlist offer's hold into the request's hold instead of taking a new one", async () => {
    const ENTRY = "0123456789abcdef0123dddd";
    const result = await prepareDirectRequest({ intent, therapyType: "solo", now, waitlist: { entryId: ENTRY, holdId: HOLD } });
    if (!result.ok) throw new Error("expected a prepared request");
    expect(h.holdCalls).toEqual([]);
    expect(h.converts).toEqual([
      { holdId: HOLD, waitlistEntryId: ENTRY, expiresAt: new Date("2026-09-15T13:00:00Z"), now },
    ]);
    // The offer's own hold never makes its time look taken.
    expect(h.slotFreeArgs[0][5]).toEqual({ exceptHoldId: HOLD });
    expect(result.fields.directRequest.source).toBe("waitlist");
    expect(String(result.fields.directRequest.waitlistEntryId)).toBe(ENTRY);
    expect(String(result.fields.directRequest.holdId)).toBe(HOLD);
  });

  it("refuses a waitlist claim whose offer hold is no longer live", async () => {
    h.convert = false;
    const waitlist = { entryId: "0123456789abcdef0123dddd", holdId: HOLD };
    expect(await prepareDirectRequest({ intent, therapyType: "solo", now, waitlist })).toEqual({
      ok: false,
      status: 409,
      code: "SLOT_TAKEN",
    });
    expect(h.holdCalls).toEqual([]);
  });

  it("loses cleanly to a request that held the slot first", async () => {
    h.hold = { ok: false, code: "SLOT_TAKEN" };
    expect(await prepareDirectRequest({ intent, therapyType: "solo", now })).toEqual({ ok: false, status: 409, code: "SLOT_TAKEN" });
  });

  it("gives the slot back when the request cannot be saved", async () => {
    const result = await prepareDirectRequest({ intent, therapyType: "solo", now });
    if (!result.ok) throw new Error("expected a prepared request");
    await abandonDirectRequest(result);
    expect(h.releases).toEqual([[HOLD]]);
  });
});

describe("releaseDirectRequest", () => {
  beforeEach(() => {
    h.current = { directRequest: { state: "pending", professionalId: PRO, holdId: HOLD } };
    h.claimed = { _id: APPT };
  });

  it("returns a declined request to the admin queue, frees the slot and issues a reroute link", async () => {
    const released = await releaseDirectRequest({
      appointmentId: APPT,
      outcome: "declined",
      professionalId: PRO,
      reason: "not_a_fit",
      note: " Hors de mon champ ",
      now,
    });
    const token = released?.rerouteToken ?? "";
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const [filter, update] = h.claims[0];
    expect(filter).toMatchObject({ _id: APPT, status: "pending", professionalId: null, "directRequest.state": "pending" });
    expect(String(filter["directRequest.professionalId"])).toBe(PRO);
    expect(update.$set).toEqual({
      routingStatus: "awaiting_admin",
      "directRequest.state": "declined",
      "directRequest.answeredAt": now,
      "directRequest.declineReason": "not_a_fit",
      "directRequest.declineNote": "Hors de mon champ",
      "directRequest.rerouteTokenHash": sha256(token),
      "directRequest.rerouteTokenExpiresAt": new Date("2026-09-28T13:00:00Z"),
    });
    expect(update.$unset).toEqual({ date: "", time: "", proposedTo: "", proposedAt: "" });
    expect(String(update.$addToSet.refusedBy)).toBe(PRO);
    expect(h.releases).toEqual([[HOLD, { appointmentId: APPT }]]);
  });

  it("keeps the client open to that professional when only the time did not suit", async () => {
    await releaseDirectRequest({ appointmentId: APPT, outcome: "declined", professionalId: PRO, reason: "slot_unavailable", now });
    expect(h.claims[0][1].$addToSet).toBeUndefined();
  });

  it("lets only the professional asked decline", async () => {
    expect(
      await releaseDirectRequest({ appointmentId: APPT, outcome: "declined", professionalId: OTHER, reason: "other", now }),
    ).toBeNull();
    expect(h.claims).toEqual([]);
    expect(h.releases).toEqual([]);
  });

  it("expires only past the deadline, and does not propose the client to that professional again", async () => {
    await releaseDirectRequest({ appointmentId: APPT, outcome: "expired", now });
    const [filter, update] = h.claims[0];
    expect(filter["directRequest.respondBy"]).toEqual({ $lte: now });
    expect(update.$set["directRequest.state"]).toBe("expired");
    expect(String(update.$addToSet.refusedBy)).toBe(PRO);
  });

  it("cancels a withdrawn request, with no link to send", async () => {
    const released = await releaseDirectRequest({ appointmentId: APPT, outcome: "withdrawn", now });
    expect(released?.rerouteToken).toBeNull();
    const [, update] = h.claims[0];
    expect(update.$set).toMatchObject({ status: "cancelled", cancelledBy: "client", "directRequest.state": "withdrawn" });
    expect(update.$unset).toEqual({ proposedTo: "", proposedAt: "" });
    expect(h.releases).toEqual([[HOLD, { appointmentId: APPT }]]);
  });

  it("puts a person who came from the waitlist back at their place when the professional declines", async () => {
    const ENTRY = "0123456789abcdef0123eeee";
    h.current = { directRequest: { state: "pending", professionalId: PRO, holdId: HOLD, source: "waitlist", waitlistEntryId: ENTRY } };
    const released = await releaseDirectRequest({ appointmentId: APPT, outcome: "declined", professionalId: PRO, reason: "slot_unavailable", now });
    expect(released?.backOnWaitlist).toBe(true);
    expect(h.waitlistUpdates).toEqual([
      [
        { _id: ENTRY, status: "converted", expiresAt: { $gt: now } },
        { $set: { status: "active", isOpen: true }, $unset: { closedAt: "" } },
      ],
    ]);

    // The place would have ended by now, or the person already joined again: no place back, no error.
    h.waitlistUpdates = [];
    h.waitlistModified = 0;
    expect((await releaseDirectRequest({ appointmentId: APPT, outcome: "declined", professionalId: PRO, now }))?.backOnWaitlist).toBe(false);
    h.waitlistThrows = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    expect((await releaseDirectRequest({ appointmentId: APPT, outcome: "declined", professionalId: PRO, now }))?.backOnWaitlist).toBe(false);
  });

  it("leaves the waitlist alone when the request came from the page, expired, or was withdrawn", async () => {
    await releaseDirectRequest({ appointmentId: APPT, outcome: "declined", professionalId: PRO, now });
    h.current = { directRequest: { state: "pending", professionalId: PRO, holdId: HOLD, source: "waitlist", waitlistEntryId: "e" } };
    await releaseDirectRequest({ appointmentId: APPT, outcome: "expired", now });
    await releaseDirectRequest({ appointmentId: APPT, outcome: "withdrawn", now });
    expect(h.waitlistUpdates).toEqual([]);
  });

  it("does nothing when another outcome won the race, or the request is no longer pending", async () => {
    h.claimed = null;
    expect(await releaseDirectRequest({ appointmentId: APPT, outcome: "expired", now })).toBeNull();
    expect(h.releases).toEqual([]);

    h.current = { directRequest: { state: "accepted", professionalId: PRO, holdId: HOLD } };
    h.claims = [];
    expect(await releaseDirectRequest({ appointmentId: APPT, outcome: "withdrawn", now })).toBeNull();
    expect(h.claims).toEqual([]);
    expect(await releaseDirectRequest({ appointmentId: "../x", outcome: "withdrawn", now })).toBeNull();
  });
});

describe("the emails", () => {
  const request = {
    professionalId: PRO,
    professionalName: "Dre Amel Sassi",
    showcaseSlug: "sassi",
    cityKey: "mascouche",
    service: "standard",
    dayKey: "2026-09-16",
    time: "10:00",
    respondBy: new Date("2026-09-15T13:00:00Z"),
  };
  const client = { firstName: "Julie", lastName: "Tremblay", email: "julie@x.ca", language: "en" };

  it("tells the professional who asked by first name and initial, and confirms to the client", async () => {
    h.populated = { _id: APPT, bookingFor: "self", clientId: client, directRequest: { ...request, state: "pending" } };
    h.professional = { firstName: "Amel", lastName: "Sassi", email: "pro@x.ca", language: "fr" };
    await notifyDirectRequestCreated(APPT);
    expect(h.emails).toEqual([
      [
        "received",
        expect.objectContaining({ professionalEmail: "pro@x.ca", professionalName: "Amel Sassi", clientName: "Julie T.", locale: "fr", dayKey: "2026-09-16", time: "10:00" }),
      ],
      [
        "confirmation",
        expect.objectContaining({ clientEmail: "julie@x.ca", professionalName: "Dre Amel Sassi", locale: "en", respondBy: request.respondBy }),
      ],
    ]);
  });

  it("offers another time on the page and Je chemine's matching after a decline, and alerts the team", async () => {
    const token = "ab".repeat(32);
    h.populated = {
      _id: APPT,
      bookingFor: "self",
      clientId: client,
      directRequest: { ...request, state: "declined", declineReason: "not_a_fit", declineNote: "Hors champ" },
    };
    await notifyDirectRequestReleased(APPT, token);
    expect(h.emails).toEqual([
      [
        "unavailable",
        expect.objectContaining({
          outcome: "declined",
          clientEmail: "julie@x.ca",
          pageUrl: "https://www.jechemine.ca/sassi",
          rerouteUrl: expect.stringMatching(new RegExp(`/demande-directe/rejumeler\\?t=${token}$`)),
        }),
      ],
      ["admin", expect.objectContaining({ outcome: "declined", reason: "not_a_fit", note: "Hors champ", clientName: "Julie Tremblay" })],
    ]);
  });

  it("tells a person back on the waitlist that they keep their place", async () => {
    h.populated = {
      _id: APPT,
      bookingFor: "self",
      clientId: client,
      directRequest: { ...request, state: "declined", source: "waitlist", waitlistEntryId: "0123456789abcdef0123eeee" },
    };
    h.waitlistOpen = true;
    await notifyDirectRequestReleased(APPT, "ab".repeat(32));
    expect(h.emails[0]).toEqual(["unavailable", expect.objectContaining({ outcome: "declined", backOnWaitlist: true })]);

    h.emails = [];
    h.waitlistOpen = false;
    await notifyDirectRequestReleased(APPT, "ab".repeat(32));
    expect(h.emails[0]).toEqual(["unavailable", expect.objectContaining({ backOnWaitlist: false })]);
  });

  it("sends nothing for a withdrawn request", async () => {
    h.populated = { _id: APPT, clientId: client, directRequest: { ...request, state: "withdrawn" } };
    await notifyDirectRequestReleased(APPT, null);
    await notifyDirectRequestReleased(APPT, "ab".repeat(32));
    expect(h.emails).toEqual([]);
  });
});

describe("runDirectRequestTimeouts", () => {
  it("expires the pending requests past their deadline, counting only the ones it claimed", async () => {
    h.due = [{ _id: APPT }, { _id: OTHER }];
    h.current = { directRequest: { state: "pending", professionalId: PRO, holdId: HOLD } };
    h.claimed = { _id: APPT };
    expect(await runDirectRequestTimeouts(now)).toEqual({ expired: 2 });
    expect(h.claims.map(([filter]) => filter._id)).toEqual([APPT, OTHER]);

    h.claimed = null;
    expect(await runDirectRequestTimeouts(now)).toEqual({ expired: 0 });
  });
});

describe("rerouteDirectRequest", () => {
  const token = "cd".repeat(32);

  it("hands a declined or expired request back to matching, once, by the link's hash", async () => {
    h.claimed = { _id: APPT };
    expect(await rerouteDirectRequest(token, now)).toEqual({ ok: true, appointmentId: APPT });
    const [filter, update] = h.claims[0];
    expect(filter).toEqual({
      "directRequest.rerouteTokenHash": sha256(token),
      "directRequest.rerouteTokenExpiresAt": { $gt: now },
      "directRequest.state": { $in: ["declined", "expired"] },
      status: "pending",
      routingStatus: "awaiting_admin",
      professionalId: null,
    });
    expect(update).toEqual({
      $set: { "directRequest.state": "rerouted", routingStatus: "pending" },
      $unset: { "directRequest.rerouteTokenHash": "", "directRequest.rerouteTokenExpiresAt": "" },
    });
  });

  it("refuses a malformed, expired or spent link", async () => {
    expect(await rerouteDirectRequest("nope", now)).toEqual({ ok: false });
    expect(h.claims).toEqual([]);
    h.claimed = null;
    expect(await rerouteDirectRequest(token, now)).toEqual({ ok: false });
  });
});

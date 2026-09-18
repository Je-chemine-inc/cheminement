import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const chain = (value: () => unknown) => {
    const query = { select: () => query, lean: async () => value() };
    return query;
  };
  return {
    chain,
    page: null as Record<string, unknown> | null,
    user: null as Record<string, unknown> | null,
    profile: null as Record<string, unknown> | null,
    busy: [] as { startsAt: Date; endsAt: Date }[],
    pricingCalls: [] as unknown[][],
    occupancyCalls: [] as Record<string, unknown>[],
    userFilters: [] as Record<string, unknown>[],
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/ShowcasePage", () => ({ default: { findOne: () => h.chain(() => h.page) } }));
vi.mock("@/models/User", () => ({
  default: {
    findOne: (filter: Record<string, unknown>) => {
      h.userFilters.push(filter);
      return h.chain(() => h.user);
    },
  },
}));
vi.mock("@/models/Profile", () => ({ default: { findOne: () => h.chain(() => h.profile) } }));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: async (...args: unknown[]) => {
    h.pricingCalls.push(args);
    return { sessionPrice: (args[2] as { quick?: boolean } | undefined)?.quick ? 70 : 130 };
  },
}));
vi.mock("@/lib/slot-occupancy", () => ({
  loadOccupiedIntervals: async (input: Record<string, unknown>) => {
    h.occupancyCalls.push(input);
    return h.busy;
  },
}));

import { isShowcaseSlotFree, listShowcaseSlots, loadBookableShowcase } from "@/lib/showcase-booking";

const PRO = "0123456789abcdef01234567";
// Monday 14 September 2026, 09:00 in Montréal.
const now = new Date("2026-09-14T13:00:00Z");
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => ({
  day,
  isWorkDay: true,
  startTime: "09:00",
  endTime: "12:00",
}));
const availability = { days: weekdays, sessionDurationMinutes: 60, breakDurationMinutes: 15 };
const publishedPage = {
  _id: "page-1",
  userId: PRO,
  slug: "sassi",
  cityKey: "mascouche",
  services: { standard: true, quick: true },
  published: { displayName: "Dre Amel Sassi" },
};

beforeEach(() => {
  h.page = { ...publishedPage };
  h.user = { _id: PRO, firstName: "Amel", lastName: "Sassi" };
  h.profile = {
    availability,
    availabilityConfirmedAt: new Date("2026-09-01T12:00:00Z"),
    acceptingNewClients: true,
    acceptingEmergencyConsultations: true,
    quickConsultation: { durationMinutes: 30 },
  };
  h.busy = [];
  h.pricingCalls = [];
  h.occupancyCalls = [];
  h.userFilters = [];
});

const bookable = async () => (await loadBookableShowcase("sassi"))!;

describe("loadBookableShowcase", () => {
  it("describes a published page of an active professional", async () => {
    expect(await loadBookableShowcase("sassi")).toEqual({
      pageId: "page-1",
      professionalId: PRO,
      slug: "sassi",
      cityKey: "mascouche",
      displayName: "Dre Amel Sassi",
      availability,
      services: {
        standard: { offered: true, durationMinutes: 60, price: 130 },
        quick: { offered: true, durationMinutes: 30, price: 70 },
      },
    });
    expect(h.userFilters[0]).toEqual({ _id: PRO, role: "professional", status: "active" });
    expect(h.pricingCalls).toEqual([
      [PRO, "solo"],
      [PRO, "solo", { quick: true }],
    ]);
  });

  it("is null for a malformed slug, an unpublished page, an inactive professional or a city outside the registry", async () => {
    expect(await loadBookableShowcase("../x")).toBeNull();
    h.page = null;
    expect(await loadBookableShowcase("sassi")).toBeNull();
    h.page = { ...publishedPage, published: undefined };
    expect(await loadBookableShowcase("sassi")).toBeNull();
    h.page = { ...publishedPage, cityKey: "atlantis" };
    expect(await loadBookableShowcase("sassi")).toBeNull();
    h.page = { ...publishedPage };
    h.user = null;
    expect(await loadBookableShowcase("sassi")).toBeNull();
  });

  it("closes a consultation the page or the professional does not offer", async () => {
    h.page = { ...publishedPage, services: { standard: true, quick: false } };
    h.profile = { ...h.profile!, acceptingNewClients: false };
    const closed = await bookable();
    expect(closed.services.standard.offered).toBe(false);
    expect(closed.services.quick.offered).toBe(false);
  });
});

describe("listShowcaseSlots", () => {
  it("lists two weeks from today, only days with a free time, nothing sooner than two hours", async () => {
    const res = await listShowcaseSlots(await bookable(), "standard", null, now);
    expect(res).toMatchObject({ service: "standard", available: true, durationMinutes: 60, price: 130, nextFrom: "2026-09-28" });
    // Monday's 09:00 and 10:15 are too soon; the weekends have no hours.
    expect(res.days.map((day) => day.day)).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
    expect(res.days[0]).toEqual({ day: "2026-09-15", slots: ["09:00", "10:15"] });
    expect(h.occupancyCalls[0]).toMatchObject({ professionalId: PRO, fromDay: "2026-09-14", toDay: "2026-09-27" });
  });

  it("continues from the next window and stops at six weeks", async () => {
    const last = await listShowcaseSlots(await bookable(), "standard", "2026-10-12", now);
    expect(h.occupancyCalls[0]).toMatchObject({ fromDay: "2026-10-12", toDay: "2026-10-25" });
    expect(last.nextFrom).toBeNull();

    const beyond = await listShowcaseSlots(await bookable(), "standard", "2026-10-26", now);
    expect(beyond).toMatchObject({ available: true, days: [], nextFrom: null });
    expect(h.occupancyCalls).toHaveLength(1);
  });

  it("never starts before today", async () => {
    await listShowcaseSlots(await bookable(), "standard", "2026-09-01", now);
    expect(h.occupancyCalls[0]).toMatchObject({ fromDay: "2026-09-14" });
  });

  it("checks overlaps with the consultation's own length", async () => {
    h.busy = [{ startsAt: new Date("2026-09-15T14:45:00Z"), endsAt: new Date("2026-09-15T15:45:00Z") }]; // Tuesday 10:45
    const quick = await listShowcaseSlots(await bookable(), "quick", null, now);
    expect(quick.days[0]).toEqual({ day: "2026-09-15", slots: ["09:00", "10:15"] });
    const standard = await listShowcaseSlots(await bookable(), "standard", null, now);
    expect(standard.days[0]).toEqual({ day: "2026-09-15", slots: ["09:00"] });
  });

  it("reads nothing for a consultation that is closed", async () => {
    h.page = { ...publishedPage, services: { standard: true, quick: false } };
    expect(await listShowcaseSlots(await bookable(), "quick", null, now)).toEqual({
      service: "quick",
      available: false,
      durationMinutes: 30,
      price: 70,
      days: [],
      nextFrom: null,
    });
    expect(h.occupancyCalls).toEqual([]);
  });
});

describe("isShowcaseSlotFree", () => {
  it("accepts a time the page would offer, and nothing else", async () => {
    const page = await bookable();
    expect(await isShowcaseSlotFree(page, "standard", "2026-09-15", "09:00", now)).toBe(true);
    expect(await isShowcaseSlotFree(page, "standard", "2026-09-15", "09:30", now)).toBe(false); // off the grid
    expect(await isShowcaseSlotFree(page, "standard", "2026-09-14", "10:15", now)).toBe(false); // too soon
    expect(await isShowcaseSlotFree(page, "standard", "2026-09-19", "09:00", now)).toBe(false); // Saturday
    expect(await isShowcaseSlotFree(page, "standard", "2026-10-26", "09:00", now)).toBe(false); // past six weeks
    expect(await isShowcaseSlotFree(page, "standard", "2026-09-15", "9:00", now)).toBe(false); // not HH:mm
    h.busy = [{ startsAt: new Date("2026-09-15T13:00:00Z"), endsAt: new Date("2026-09-15T14:00:00Z") }];
    expect(await isShowcaseSlotFree(page, "standard", "2026-09-15", "09:00", now)).toBe(false); // taken
  });
});

/**
 * Phase 3b: a page offers times only on hours the professional saved herself. In production 5 of
 * the 6 active professionals still carried the signup default, Monday–Friday 9:00–17:00.
 */
describe("hours the professional never confirmed", () => {
  beforeEach(() => {
    h.profile = { ...(h.profile as Record<string, unknown>), availabilityConfirmedAt: undefined };
  });

  it("offer no time on the page, even with the service switched on", async () => {
    const bookable = (await loadBookableShowcase("sassi"))!;
    expect(bookable.services.standard.offered).toBe(true);
    const slots = await listShowcaseSlots(bookable, "standard", null, now);
    expect(slots.days).toEqual([]);
  });

  it("cannot be booked through the intake either", async () => {
    const bookable = (await loadBookableShowcase("sassi"))!;
    expect(await isShowcaseSlotFree(bookable, "standard", "2026-09-15", "09:00", now)).toBe(false);
  });

  it("start offering times the moment she confirms them", async () => {
    h.profile = { ...(h.profile as Record<string, unknown>), availabilityConfirmedAt: new Date("2026-09-18T12:00:00Z") };
    const bookable = (await loadBookableShowcase("sassi"))!;
    const slots = await listShowcaseSlots(bookable, "standard", null, now);
    expect(slots.days.length).toBeGreaterThan(0);
  });
});

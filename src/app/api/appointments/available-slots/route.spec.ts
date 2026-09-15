import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The schedule modal's free times. Pins the access rule (it used to answer
 * anyone with a professional's id), and that busy time — sessions stored at
 * UTC noon, overlaps, held requests — really leaves the grid.
 */

const PRO = "0123456789abcdef01234567";
const OTHER_PRO = "0123456789abcdef0123bbbb";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
  professional: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  busy: [] as { startsAt: Date; endsAt: Date }[],
  userFilters: [] as Record<string, unknown>[],
  occupancyCalls: [] as Record<string, unknown>[],
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => h.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock("@/models/User", () => ({
  default: {
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      h.userFilters.push(filter);
      return h.professional;
    }),
  },
}));
vi.mock("@/models/Profile", () => ({ default: { findOne: vi.fn(async () => h.profile) } }));
vi.mock("@/models/PlatformSettings", () => ({
  default: { findOne: vi.fn(async () => ({ defaultPricing: { solo: 120, couple: 150, group: 80 } })) },
}));
vi.mock("@/lib/slot-occupancy", () => ({
  loadOccupiedIntervals: vi.fn(async (input: Record<string, unknown>) => {
    h.occupancyCalls.push(input);
    return h.busy;
  }),
}));

import { GET } from "@/app/api/appointments/available-slots/route";

// Monday 16 September 2030, far enough ahead that "now" never removes a time.
const MONDAY = "2030-09-16";

const call = async (query: string) => {
  const res = await GET(new NextRequest(`http://localhost/api/appointments/available-slots?${query}`));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  h.session = { user: { id: PRO, role: "professional" } };
  h.professional = { _id: PRO, firstName: "Amel", lastName: "Sassi" };
  h.profile = {
    availability: {
      days: [{ day: "Monday", isWorkDay: true, startTime: "09:00", endTime: "13:00" }],
      sessionDurationMinutes: 60,
      breakDurationMinutes: 15,
    },
    pricing: { individualSession: 150 },
    sessionTypes: ["Individual"],
  };
  h.busy = [];
  h.userFilters = [];
  h.occupancyCalls = [];
});

describe("who may read a grid", () => {
  it("refuses anonymous visitors and clients, even with a professional's id", async () => {
    h.session = null;
    expect((await call(`date=${MONDAY}&professionalId=${PRO}`)).status).toBe(401);
    h.session = { user: { id: "c1", role: "client" } };
    expect((await call(`date=${MONDAY}&professionalId=${PRO}`)).status).toBe(403);
    expect(h.userFilters).toEqual([]);
  });

  it("keeps a professional to their own grid", async () => {
    expect((await call(`date=${MONDAY}&professionalId=${OTHER_PRO}`)).status).toBe(403);
    expect((await call(`date=${MONDAY}`)).status).toBe(200);
    expect(h.userFilters[0]).toMatchObject({ _id: PRO });
  });

  it("lets an admin name the professional, and only then", async () => {
    h.session = { user: { id: "admin-1", role: "admin" } };
    expect((await call(`date=${MONDAY}`)).status).toBe(400);
    expect((await call(`date=${MONDAY}&professionalId=${OTHER_PRO}`)).status).toBe(200);
    expect(h.userFilters[0]).toMatchObject({ _id: OTHER_PRO });
  });

  it("refuses a date that is not a calendar day", async () => {
    expect((await call("date=2030-02-30")).status).toBe(400);
    expect((await call("date=16/09/2030")).status).toBe(400);
  });
});

describe("the grid", () => {
  it("answers in the shape the proposals page reads", async () => {
    const { status, body } = await call(`date=${MONDAY}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      date: MONDAY,
      dayOfWeek: "Monday",
      available: true,
      slots: [
        { time: "09:00", duration: 60, available: true },
        { time: "10:15", duration: 60, available: true },
        { time: "11:30", duration: 60, available: true },
      ],
      professionalInfo: { name: "Amel Sassi", sessionDuration: 60 },
      workingHours: { start: "09:00", end: "13:00" },
    });
    expect(h.occupancyCalls[0]).toMatchObject({ professionalId: PRO, fromDay: MONDAY, toDay: MONDAY });
  });

  it("removes every time that overlaps something busy", async () => {
    // 09:30-10:30 in Montréal: off the grid, it overlaps both 09:00 and 10:15.
    h.busy = [{ startsAt: new Date("2030-09-16T13:30:00Z"), endsAt: new Date("2030-09-16T14:30:00Z") }];
    const { body } = await call(`date=${MONDAY}`);
    expect(body.slots.map((slot: { time: string }) => slot.time)).toEqual(["11:30"]);
  });

  it("says so on a day the professional does not work", async () => {
    const { body } = await call("date=2030-09-17");
    expect(body).toMatchObject({ dayOfWeek: "Tuesday", available: false, slots: [] });
    expect(h.occupancyCalls).toEqual([]);
  });
});

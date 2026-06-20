/**
 * Section 3: the admin "Assigner un professionnel" dropdown can re-route a
 * pending request to AUTOMATIC matching (mode:"auto" → re-run the matcher) or to
 * the public GENERAL POOL (mode:"general" → routingStatus general, self-assign),
 * in addition to proposing to one specific professional.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const REQ_ID = "a4a4a4a4a4a4a4a4a4a4a4a4";
const ADMIN_ID = "d4d4d4d4d4d4d4d4d4d4d4d4";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const route = vi.fn().mockResolvedValue({
    success: true,
    matches: [{ professionalId: "p1", score: 100, reasons: [] }],
    routingStatus: "proposed",
  });
  const findByIdAndUpdate = vi.fn().mockResolvedValue({});
  const sendPro = vi.fn().mockResolvedValue(true);
  const store: { appointment: Record<string, unknown>; admin: unknown } = {
    appointment: {},
    admin: { permissions: { manageUsers: true } },
  };
  const makeQuery = (result: unknown) => ({
    populate() {
      return this;
    },
    select() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });
  return { getServerSession, route, findByIdAndUpdate, sendPro, store, makeQuery };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  after: (fn: () => void) => {
    void fn;
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi
    .fn()
    .mockResolvedValue({ sessionPrice: 120, platformFee: 12, professionalPayout: 108 }),
}));
vi.mock("@/lib/notifications", () => ({
  sendProfessionalNotification: h.sendPro,
}));
vi.mock("@/lib/guardian-utils", () => ({
  resolveAppointmentRecipient: () => ({
    name: "Alex",
    email: "c@x.co",
    language: "fr",
  }),
}));
vi.mock("@/lib/appointment-routing", () => ({
  routeAppointmentToProfessionals: h.route,
}));
vi.mock("@/models/Admin", () => ({
  default: { findOne: () => Promise.resolve(h.store.admin) },
}));
vi.mock("@/models/User", () => ({
  default: { findOne: () => Promise.resolve(null), find: () => h.makeQuery([]) },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => h.makeQuery(h.store.appointment),
    findByIdAndUpdate: h.findByIdAndUpdate,
  },
}));

import { POST as assignPOST } from "@/app/api/admin/service-requests/[id]/assign/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (body: Record<string, unknown>): Res => {
  h.getServerSession.mockResolvedValueOnce({
    user: { id: ADMIN_ID, role: "admin" },
  });
  return assignPOST(
    { json: async () => body } as never,
    { params: Promise.resolve({ id: REQ_ID }) },
  ) as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.admin = { permissions: { manageUsers: true } };
  h.store.appointment = {
    _id: REQ_ID,
    status: "pending",
    routingStatus: "proposed",
    therapyType: "solo",
    professionalId: null,
  };
});

describe("POST assign — mode:general (pool)", () => {
  it("sets routingStatus general and unsets the pro", async () => {
    const res = await call({ mode: "general" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "general", routingStatus: "general" });
    const update = h.findByIdAndUpdate.mock.calls[0][1] as Record<
      string,
      Record<string, unknown>
    >;
    expect(update.$set.routingStatus).toBe("general");
    expect(update.$unset).toHaveProperty("professionalId");
    expect(h.route).not.toHaveBeenCalled();
    // No professional is emailed when a request is sent to the general pool —
    // pros are notified only on a targeted proposal (client feedback §3).
    expect(h.sendPro).not.toHaveBeenCalled();
  });
});

describe("POST assign — mode:auto (re-match)", () => {
  it("resets to pending then re-runs the matcher", async () => {
    const res = await call({ mode: "auto" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "auto", routingStatus: "proposed" });
    const update = h.findByIdAndUpdate.mock.calls[0][1] as Record<
      string,
      Record<string, unknown>
    >;
    expect(update.$set.routingStatus).toBe("pending");
    // A manual re-launch retries EVERY pro — refusedBy is cleared (feedback §4).
    expect(update.$set.refusedBy).toEqual([]);
    expect(h.route).toHaveBeenCalledWith(REQ_ID);
  });

  it("rejects re-routing a non-pending request (409)", async () => {
    h.store.appointment.status = "scheduled";
    const res = await call({ mode: "auto" });
    expect(res.status).toBe(409);
    expect(h.route).not.toHaveBeenCalled();
  });
});

describe("POST assign — guards", () => {
  it("requires a professionalId when no mode is given", async () => {
    const res = await call({});
    expect(res.status).toBe(400);
  });
});

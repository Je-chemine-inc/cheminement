import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO = "0123456789abcdef01234567";
const OTHER = "0123456789abcdef0123bbbb";
const APPT = "0123456789abcdef0123aaaa";
const HOLD = "0123456789abcdef0123cccc";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
  appointment: null as Record<string, unknown> | null,
  accepted: null as Record<string, unknown> | null,
  claims: [] as [Record<string, unknown>, Record<string, Record<string, unknown>>][],
  collision: null as { kind: string } | null,
  collisionCalls: [] as Record<string, unknown>[],
  location: null as string | null,
  pricingCalls: [] as unknown[][],
  releases: [] as unknown[][],
  provisioned: [] as unknown[][],
  confirmations: [] as Record<string, unknown>[],
  freshClient: { role: "client", status: "inactive" },
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: () => {},
}));
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => ({ populate: async () => h.appointment }),
    findOneAndUpdate: (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      h.claims.push([filter, update]);
      return { populate: async () => h.accepted };
    },
  },
}));
vi.mock("@/models/User", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => h.freshClient }) }) },
}));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: async (...args: unknown[]) => {
    h.pricingCalls.push(args);
    return { sessionPrice: 80, platformFee: 20, professionalPayout: 60 };
  },
}));
vi.mock("@/lib/slot-occupancy", () => ({
  findSlotCollision: async (input: Record<string, unknown>) => {
    h.collisionCalls.push(input);
    return h.collision;
  },
  slotCollisionError: (collision: { kind: string }) => ({
    error: "collision",
    code: collision.kind === "hold" ? "SLOT_HELD" : "SLOT_CONFLICT",
  }),
}));
vi.mock("@/lib/slot-holds", () => ({
  releaseSlotHold: async (...args: unknown[]) => {
    h.releases.push(args);
    return true;
  },
}));
vi.mock("@/lib/provision-guest-as-client", () => ({
  provisionGuestAsClient: async (...args: unknown[]) => {
    h.provisioned.push(args);
    return { promoted: true };
  },
}));
vi.mock("@/lib/first-appointment-confirmation", () => ({
  resolveFirstAppointmentLocation: async () => h.location,
  queueFirstAppointmentConfirmation: async (input: Record<string, unknown>) => {
    h.confirmations.push(input);
  },
}));

import { POST } from "@/app/api/appointments/[id]/accept-direct/route";

type Res = { status: number; body: Record<string, unknown> };
const call = (body: unknown = {}, id = APPT) =>
  POST({ json: async () => body } as never, { params: Promise.resolve({ id }) } as never) as unknown as Promise<Res>;

const request = (over: Record<string, unknown> = {}) => ({
  state: "pending",
  professionalId: { toString: () => PRO },
  service: "quick",
  dayKey: "2030-09-16",
  time: "10:00",
  respondBy: new Date(Date.now() + 60 * 60 * 1000),
  holdId: HOLD,
  ...over,
});

beforeEach(() => {
  h.session = { user: { id: PRO, role: "professional" } };
  h.appointment = {
    _id: APPT,
    status: "pending",
    type: "video",
    therapyType: "solo",
    duration: 30,
    clientId: { _id: "c1", role: "prospect" },
    directRequest: request(),
  };
  h.accepted = {
    _id: APPT,
    status: "scheduled",
    issueType: "Anxiété",
    date: new Date("2030-09-16T12:00:00Z"),
    time: "10:00",
    duration: 30,
    type: "video",
    clientId: { _id: "c1", role: "prospect", status: "active" },
  };
  h.claims = [];
  h.collision = null;
  h.collisionCalls = [];
  h.location = null;
  h.pricingCalls = [];
  h.releases = [];
  h.provisioned = [];
  h.confirmations = [];
  h.freshClient = { role: "client", status: "inactive" };
});

describe("POST /api/appointments/[id]/accept-direct", () => {
  it("accepts and schedules in one claim, frees the hold and sends the first-appointment confirmation", async () => {
    const res = await call();
    expect(res.status).toBe(200);

    const [filter, update] = h.claims[0];
    expect(filter).toMatchObject({
      _id: APPT,
      status: "pending",
      professionalId: null,
      routingStatus: "proposed",
      "directRequest.state": "pending",
    });
    expect(filter["directRequest.respondBy"]).toEqual({ $gt: expect.any(Date) });
    expect(update.$set).toMatchObject({
      professionalId: PRO,
      routingStatus: "accepted",
      status: "scheduled",
      awaitingPaymentGuarantee: true,
      type: "video",
      "payment.price": 80,
      "payment.platformFee": 20,
      "payment.professionalPayout": 60,
      "directRequest.state": "accepted",
    });
    expect(update.$unset).toEqual({ proposedTo: "", proposedAt: "" });
    // The quick consultation is priced at the professional's quick rate.
    expect(h.pricingCalls).toEqual([[PRO, "solo", { quick: true }]]);
    expect(h.collisionCalls[0]).toMatchObject({
      professionalId: PRO,
      dayKey: "2030-09-16",
      time: "10:00",
      durationMinutes: 30,
      exceptAppointmentId: APPT,
    });
    expect(h.releases).toEqual([[HOLD, { appointmentId: APPT }]]);
    // A prospect gets an account to claim, and the email sees its fresh state.
    expect(h.provisioned).toEqual([["c1", { issueType: "Anxiété", activate: false }]]);
    expect(h.confirmations).toHaveLength(1);
    expect(h.confirmations[0]).toMatchObject({ professionalId: PRO, appointment: h.accepted });
    expect(h.accepted!.clientId).toMatchObject({ role: "client", status: "inactive" });
  });

  it("refuses anyone but a professional, and hides another professional's request", async () => {
    h.session = { user: { id: "c1", role: "client" } };
    expect((await call()).status).toBe(401);
    h.session = { user: { id: PRO, role: "professional" } };
    h.appointment!.directRequest = request({ professionalId: { toString: () => OTHER } });
    expect((await call()).status).toBe(404);
    expect(h.claims).toEqual([]);
  });

  it("refuses a request no longer pending, or past its deadline", async () => {
    h.appointment!.directRequest = request({ state: "withdrawn" });
    expect(await call()).toMatchObject({ status: 409, body: { code: "DIRECT_REQUEST_CLOSED" } });
    h.appointment!.directRequest = request({ respondBy: new Date(Date.now() - 1000) });
    expect(await call()).toMatchObject({ status: 409, body: { code: "DIRECT_REQUEST_EXPIRED" } });
    expect(h.claims).toEqual([]);
  });

  it("refuses a time that now collides with a session", async () => {
    h.collision = { kind: "session" };
    expect(await call()).toMatchObject({ status: 409, body: { code: "SLOT_CONFLICT" } });
    expect(h.claims).toEqual([]);
  });

  it("asks where an in-person session happens, and records it", async () => {
    expect(await call({ type: "in-person" })).toMatchObject({ status: 400, body: { code: "OFFICE_ADDRESS_REQUIRED" } });
    expect(h.claims).toEqual([]);
    h.location = "12 rue Principale, Mascouche";
    await call({ type: "in-person" });
    expect(h.claims[0][1].$set).toMatchObject({ type: "in-person", location: "12 rue Principale, Mascouche" });
  });

  it("loses cleanly when a withdrawal or the deadline won the race", async () => {
    h.accepted = null;
    expect(await call()).toMatchObject({ status: 409, body: { code: "DIRECT_REQUEST_CLOSED" } });
    expect(h.releases).toEqual([]);
    expect(h.confirmations).toEqual([]);
  });
});

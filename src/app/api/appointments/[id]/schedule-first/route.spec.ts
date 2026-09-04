/**
 * Regression: confirming a client's FIRST appointment captured no address.
 *
 * This route always accepted `location`, but the professional's scheduling modal
 * only ever posted `{ date, time }`. So an in-person first session was confirmed
 * with nothing recorded about where it happens — and since the professional's
 * office address is a brand-new field that is empty for everyone, the
 * confirmation and the reminders had only the platform's own footer address to
 * show. Later appointments were unaffected: the other scheduling paths do
 * collect a location.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PRO_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  appointment: {} as Record<string, unknown>,
  profile: null as Record<string, unknown> | null,
  profileUpdates: [] as Array<Record<string, unknown>>,
  saved: 0,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  after: () => {},
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi.fn().mockResolvedValue({
    sessionPrice: 175,
    platformFee: 25,
    professionalPayout: 150,
  }),
}));
vi.mock("@/lib/notifications", () => ({
  sendGuestPaymentConfirmation: vi.fn().mockResolvedValue(true),
  sendPaymentInvitation: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/guardian-utils", () => ({
  resolveAppointmentRecipient: () => ({
    email: "client@example.com",
    name: "Client",
    language: "fr",
    isLovedOne: false,
  }),
}));
vi.mock("@/lib/client-portal-urls", () => ({
  resolveBillingUrl: vi.fn().mockResolvedValue("https://example.test/pay"),
}));
vi.mock("@/lib/interac-reference", () => ({
  resolveInteracReferenceCode: () => "INT-TEST-000001",
  buildInteracReferenceCode: () => "INT-TEST-000001",
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => ({
      select: () => ({
        lean: async () => ({ firstName: "Pro", lastName: "Name", email: "pro@x.ca" }),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ firstName: "Pro", lastName: "Name", email: "pro@x.ca" }).then(r),
      }),
    }),
  },
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: async () => h.profile }) }),
    updateOne: async (filter: unknown, update: Record<string, unknown>) => {
      h.profileUpdates.push(update);
      return { acknowledged: true };
    },
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => ({
      populate: async () => Object.assign(h.appointment, { save: async () => { h.saved++; } }),
    }),
    findOne: vi.fn().mockResolvedValue(null),
  },
}));

import { POST } from "@/app/api/appointments/[id]/schedule-first/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (body: unknown): Res =>
  POST({ json: async () => body } as never, {
    params: Promise.resolve({ id: APPT_ID }),
  } as never) as unknown as Res;

const FUTURE = "2027-03-15";

beforeEach(() => {
  vi.clearAllMocks();
  h.profile = null;
  h.profileUpdates.length = 0;
  h.saved = 0;
  h.getServerSession.mockResolvedValue({
    user: { id: PRO_ID, role: "professional" },
  });
  h.appointment = {
    _id: APPT_ID,
    professionalId: { toString: () => PRO_ID },
    clientId: { _id: "c1", firstName: "A", lastName: "B", email: "c@x.ca", role: "client", status: "active" },
    type: "in-person",
    therapyType: "solo",
    status: "pending",
    routingStatus: "accepted",
    payment: { price: 0, status: "pending" },
  };
});

describe("first appointment — in-person requires an address", () => {
  it("refuses to confirm with no address anywhere", async () => {
    const res = await call({ date: FUTURE, time: "10:00" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFICE_ADDRESS_REQUIRED");
    // Nothing is scheduled: the client is never told about a session whose
    // location nobody can state.
    expect(h.saved).toBe(0);
    expect(h.appointment.status).toBe("pending");
  });

  it("accepts the address typed at confirmation", async () => {
    const res = await call({
      date: FUTURE,
      time: "10:00",
      location: "1250 rue Sainte-Catherine Ouest, Montréal",
    });

    expect(res.status).toBe(200);
    expect(h.appointment.location).toBe("1250 rue Sainte-Catherine Ouest, Montréal");
    expect(h.appointment.status).toBe("scheduled");
  });

  it("falls back to the professional's saved office address", async () => {
    h.profile = { officeAddress: { street: "12 rue Principale", city: "Gatineau" } };

    const res = await call({ date: FUTURE, time: "10:00" });

    expect(res.status).toBe(200);
    expect(String(h.appointment.location)).toContain("12 rue Principale");
    expect(String(h.appointment.location)).toContain("Gatineau");
  });

  it("remembers a typed address as the default office when asked", async () => {
    h.profile = { officeAddress: {} };

    await call({
      date: FUTURE,
      time: "10:00",
      location: "40 boul. Curé-Labelle",
      saveAsDefaultOffice: true,
    });

    expect(h.profileUpdates).toHaveLength(1);
    expect(h.profileUpdates[0]).toMatchObject({
      $set: { "officeAddress.street": "40 boul. Curé-Labelle" },
    });
  });

  it("never overwrites an office address the professional already set", async () => {
    h.profile = { officeAddress: { street: "Existing address" } };

    await call({
      date: FUTURE,
      time: "10:00",
      location: "Somewhere else today",
      saveAsDefaultOffice: true,
    });

    expect(h.profileUpdates).toHaveLength(0);
  });

  it("does not ask for an address for a video session", async () => {
    h.appointment.type = "video";

    const res = await call({ date: FUTURE, time: "10:00" });

    expect(res.status).toBe(200);
    expect(h.appointment.location).toBeUndefined();
  });

  it("keeps an address the appointment already carried", async () => {
    h.appointment.location = "Already known clinic";

    const res = await call({ date: FUTURE, time: "10:00" });

    expect(res.status).toBe(200);
    expect(h.appointment.location).toBe("Already known clinic");
  });
});

/**
 * A returning client asks their current professional for another session:
 * POST /api/appointments/request-with-current-pro. The request took the
 * model's "card" default whatever the client's arrangement, so an Interac
 * client's session read "card" (JC-2026-000014).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT_ID = "c1c1c1c1c1c1c1c1c1c1c1c1";
const PRO_ID = "b1b1b1b1b1b1b1b1b1b1b1b1";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  store: {
    client: {} as Record<string, unknown> | null,
    lastSaved: undefined as Record<string, unknown> | undefined,
  },
}));

// A query that honours `.select("a b c")`, so a field the route forgets to
// load is really missing — as it would be from MongoDB.
const chain = (value: unknown) => {
  let projected = value;
  const q = {
    select: (fields: string) => {
      if (value && typeof value === "object") {
        const keep = fields.split(/\s+/);
        projected = Object.fromEntries(
          Object.entries(value).filter(([k]) => keep.includes(k)),
        );
      }
      return q;
    },
    sort: () => q,
    lean: () => Promise.resolve(projected),
  };
  return q;
};

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: () => undefined,
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi
    .fn()
    .mockResolvedValue({ sessionPrice: 175, platformFee: 25, professionalPayout: 150 }),
}));
vi.mock("@/lib/notifications", () => ({ sendProfessionalNotification: vi.fn().mockResolvedValue(true) }));
vi.mock("@/models/User", () => ({
  default: {
    findOne: () => chain({ firstName: "Nathalie", lastName: "Pro", email: "pro@example.com" }),
    findById: () => chain(h.store.client),
  },
}));
vi.mock("@/models/Profile", () => ({ default: { findOne: () => chain({ availability: { sessionDurationMinutes: 50 } }) } }));
vi.mock("@/models/Appointment", () => {
  class Appointment {
    _id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    save = vi.fn().mockResolvedValue(undefined);
    constructor(data: Record<string, unknown>) {
      Object.assign(this, data);
      h.store.lastSaved = { ...data };
    }
    // The client's last matched session (the current professional), then the
    // double-booking check.
    static findOne = (filter: Record<string, unknown>) =>
      "clientId" in filter
        ? chain({ professionalId: PRO_ID, needs: [], therapyType: "solo" })
        : Promise.resolve(null);
  }
  return { default: Appointment };
});

import { POST } from "@/app/api/appointments/request-with-current-pro/route";

const request = async () => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: CLIENT_ID, role: "client" } });
  return (await POST({
    json: async () => ({ date: "2099-02-20", time: "10:00", type: "video" }),
  } as never)) as unknown as { status: number; body: Record<string, unknown> };
};
const savedMethod = () => (h.store.lastSaved?.payment as { method?: string } | undefined)?.method;

beforeEach(() => {
  vi.clearAllMocks();
  h.store.lastSaved = undefined;
  h.store.client = { firstName: "Élorie", lastName: "B", email: "c@example.com", phoneVerifiedAt: new Date() };
});

describe("POST /api/appointments/request-with-current-pro — the client's way of paying", () => {
  it("an Interac client with no card asks for an Interac session", async () => {
    h.store.client = { ...h.store.client, paymentGuaranteeStatus: "green", paymentGuaranteeSource: "interac_trust", preferredPaymentMethod: "interac" };
    const res = await request();
    expect(res.status).toBe(200);
    expect(savedMethod()).toBe("transfer");
  });

  it("a client with a card on file asks for a card session", async () => {
    h.store.client = { ...h.store.client, paymentGuaranteeStatus: "green", paymentGuaranteeSource: "stripe", preferredPaymentMethod: "card" };
    await request();
    expect(savedMethod()).toBe("card");
  });
});

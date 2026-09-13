/**
 * Professional booking: POST /api/professional/appointments.
 *
 * Regression (JC-2026-000014): a session a professional booked for an Interac
 * client — admin-approved arrangement, never gave a card — was stored with
 * the model's "card" default. Closure then looked for a card that did not
 * exist, and the admin billing screen showed « Carte validée ».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO_ID = "b1b1b1b1b1b1b1b1b1b1b1b1";
const CLIENT_ID = "c1c1c1c1c1c1c1c1c1c1c1c1";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  conflictFindOne: vi.fn(),
  store: {
    client: {} as Record<string, unknown> | null,
    professional: {} as Record<string, unknown> | null,
    lastSaved: undefined as Record<string, unknown> | undefined,
  },
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: () => undefined,
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// No showcase request holds a time in these cases (spec 003).
vi.mock("@/lib/slot-occupancy", () => ({
  findSlotCollision: vi.fn(async () => null),
  slotCollisionError: () => ({ error: "held", code: "SLOT_HELD" }),
}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi
    .fn()
    .mockResolvedValue({ sessionPrice: 175, platformFee: 25, professionalPayout: 150 }),
}));
vi.mock("@/lib/motifs", () => ({ getValidMotifLabels: vi.fn().mockResolvedValue(new Set<string>()) }));
vi.mock("@/lib/notifications", () => ({ sendAppointmentConfirmation: vi.fn().mockResolvedValue(true) }));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => Promise.resolve(h.store.client),
    findOne: () => Promise.resolve(h.store.professional),
  },
}));
vi.mock("@/models/Profile", () => ({
  default: { findOne: () => Promise.resolve({ availability: { sessionDurationMinutes: 50 } }) },
}));
vi.mock("@/models/Appointment", () => {
  class Appointment {
    _id = { toString: () => "aaaaaaaaaaaaaaaaaaaaaaaa" };
    status = "scheduled";
    save = vi.fn().mockResolvedValue(undefined);
    constructor(data: Record<string, unknown>) {
      Object.assign(this, data);
      h.store.lastSaved = { ...data };
    }
    static findOne = h.conflictFindOne;
  }
  return { default: Appointment };
});

import { POST } from "@/app/api/professional/appointments/route";

type Res = { status: number; body: Record<string, unknown> };
const book = async (role = "professional") => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: PRO_ID, role } });
  return (await POST({
    json: async () => ({ clientId: CLIENT_ID, date: "2099-02-20", time: "10:00", type: "video" }),
  } as never)) as unknown as Res;
};
const savedPayment = () => h.store.lastSaved?.payment as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  h.conflictFindOne.mockResolvedValue(null);
  h.store.lastSaved = undefined;
  h.store.professional = { _id: PRO_ID, role: "professional", firstName: "Nathalie", lastName: "Pro", email: "pro@example.com" };
  h.store.client = { _id: CLIENT_ID, role: "client", firstName: "Élorie", lastName: "B", email: "c@example.com" };
});

describe("POST /api/professional/appointments", () => {
  it("is refused to anyone but a professional", async () => {
    const res = await book("client");
    expect(res.status).toBe(401);
    expect(h.store.lastSaved).toBeUndefined();
  });

  it("the reported case: an approved Interac client is booked as Interac, not card", async () => {
    h.store.client = {
      ...h.store.client,
      paymentGuaranteeStatus: "green",
      paymentGuaranteeSource: "interac_trust",
      preferredPaymentMethod: "interac",
    };
    const res = await book();
    expect(res.status).toBe(201);
    expect(savedPayment()).toMatchObject({ method: "transfer", price: 175, status: "pending" });
  });

  it("a client whose Interac request awaits approval is booked as Interac", async () => {
    h.store.client = { ...h.store.client, paymentGuaranteeStatus: "pending_admin", preferredPaymentMethod: "interac" };
    await book();
    expect(savedPayment()?.method).toBe("transfer");
  });

  it("a client with a card on file is booked on the card", async () => {
    h.store.client = {
      ...h.store.client,
      paymentGuaranteeStatus: "green",
      paymentGuaranteeSource: "stripe",
      preferredPaymentMethod: "card",
    };
    await book();
    expect(savedPayment()?.method).toBe("card");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/appointments passed the WHOLE request body to `new Appointment(data)`.
 * A client could book with `payment: { status: "paid" }`: closure then skipped
 * the charge as already settled and emailed an official receipt for a session
 * that was never paid. Pins that only booking-intake fields reach the document.
 */

const h = vi.hoisted(() => ({
  saved: [] as Record<string, unknown>[],
  session: { user: { id: "prospect-1", role: "prospect" } },
  saveError: null as Error | null,
  prepared: null as Record<string, unknown> | null,
  prepareCalls: [] as Record<string, unknown>[],
  attached: [] as unknown[][],
  abandoned: [] as unknown[],
  notified: [] as string[],
  routed: [] as string[],
  adminAlerts: 0,
}));

// A thenable that tolerates any .select/.lean/.populate/.sort/.limit chain.
function query(value: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "lean", "populate", "sort", "limit"]) q[m] = () => q;
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(value).then(res, rej);
  return q;
}

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  // Side effects run at once so the tests can see which ones were queued.
  after: (fn: () => unknown) => {
    Promise.resolve().then(fn).catch(() => undefined);
  },
}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => h.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/motifs", () => ({
  getValidMotifLabels: vi.fn(async () => new Set(["Anxiété"])),
}));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi.fn(async () => ({
    sessionPrice: 120,
    platformFee: 12,
    professionalPayout: 108,
  })),
}));
vi.mock("@/lib/notifications", () => ({
  sendAppointmentConfirmation: vi.fn(async () => true),
  sendProfessionalNotification: vi.fn(async () => true),
  sendServiceRequestOnboardingEmail: vi.fn(async () => true),
  sendReferralConfirmationEmail: vi.fn(async () => true),
  sendAdminNewServiceRequestAlert: vi.fn(async () => {
    h.adminAlerts++;
  }),
  sendCancellationNotification: vi.fn(async () => true),
}));
vi.mock("@/lib/appointment-routing", () => ({
  routeAppointmentToProfessionals: vi.fn(async (id: string) => {
    h.routed.push(id);
  }),
}));
vi.mock("@/lib/direct-request", () => ({
  prepareDirectRequest: vi.fn(async (input: Record<string, unknown>) => {
    h.prepareCalls.push(input);
    return h.prepared;
  }),
  attachDirectRequest: vi.fn(async (...args: unknown[]) => {
    h.attached.push(args);
  }),
  abandonDirectRequest: vi.fn(async (prepared: unknown) => {
    h.abandoned.push(prepared);
  }),
  notifyDirectRequestCreated: vi.fn(async (id: string) => {
    h.notified.push(id);
  }),
}));
vi.mock("@/lib/service-request-recipient", () => ({
  resolveServiceRequestRecipient: () => ({
    toEmail: "prospect@example.com",
    toName: "Pat",
    recipientKind: "requester",
  }),
}));
vi.mock("@/lib/referral-patient-account", () => ({
  backfillReferrerContact: vi.fn(),
  findOrCreateReferralPatient: vi.fn(),
  isValidEmail: () => true,
  resolveReferralPatientIdentity: vi.fn(),
}));
vi.mock("@/lib/guardian-utils", () => ({
  linkGuardian: vi.fn(),
  isMinor: () => false,
  isUnder14: () => false,
  resolveAppointmentRecipient: () => ({
    email: "prospect@example.com",
    name: "Pat",
    language: "fr",
  }),
}));
vi.mock("@/lib/redact-payment", () => ({
  redactPaymentForProfessionalAll: (x: unknown) => x,
}));
vi.mock("@/models/Profile", () => ({
  default: { findOne: vi.fn(() => query(null)) },
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: vi.fn(() =>
      query({
        _id: "prospect-1",
        firstName: "Pat",
        lastName: "P",
        email: "prospect@example.com",
        preferredPaymentMethod: "interac",
        save: vi.fn(async () => undefined),
      }),
    ),
    findOne: vi.fn(() => query(null)),
  },
}));
vi.mock("@/models/Appointment", () => {
  class MockAppointment {
    _id = { toString: () => "apt-new" };
    constructor(doc: Record<string, unknown>) {
      Object.assign(this, doc);
      h.saved.push(doc);
    }
    save = vi.fn(async () => {
      if (h.saveError) throw h.saveError;
      return this;
    });
    static countDocuments = vi.fn(async () => 0);
    static find = vi.fn(() => query([]));
    static findOne = vi.fn(() => query(null));
    // The route re-reads what it just created before responding.
    static findById = vi.fn(() =>
      query(h.saved.length ? { _id: "apt-new", ...h.saved[h.saved.length - 1] } : null),
    );
    static findByIdAndUpdate = vi.fn(async () => null);
  }
  return { default: MockAppointment };
});

import { POST } from "@/app/api/appointments/route";

type Res = Promise<{ status: number; body: unknown }>;
const book = (body: unknown): Res =>
  POST({ json: async () => body } as never) as unknown as Res;

/** Lets the queued after() side effects run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const intake = {
  type: "video",
  therapyType: "solo",
  needs: ["Anxiété"],
  bookingFor: "self",
  notificationLocale: "fr",
  preferredPaymentMethod: "card",
};

beforeEach(() => {
  h.saved.length = 0;
  h.saveError = null;
  h.prepared = null;
  h.prepareCalls = [];
  h.attached = [];
  h.abandoned = [];
  h.notified = [];
  h.routed = [];
  h.adminAlerts = 0;
});

describe("POST /api/appointments — only intake reaches the appointment", () => {
  it("ignores a forged payment block, so a booking can't arrive already paid", async () => {
    const res = await book({
      ...intake,
      payment: { status: "paid", price: 1, method: "manual" },
    });
    expect(res.status).toBeLessThan(300);
    expect(h.saved).toHaveLength(1);
    const apt = h.saved[0];
    const payment = (apt.payment ?? {}) as Record<string, unknown>;
    expect(payment.status).toBeUndefined();
    expect(payment.price).toBeUndefined();
    expect(payment.method).not.toBe("manual");
  });

  it("ignores forged state, invoice and closure fields", async () => {
    await book({
      ...intake,
      status: "completed",
      invoiceNumber: "JC-2026-999999",
      sessionCompletedAt: "2026-09-01T12:00:00Z",
      sessionOutcome: "completed",
      fiscalReceiptIssuedAt: "2026-09-01T12:00:00Z",
      cascadeAttempts: 99,
    });
    const apt = h.saved[0];
    expect(apt.status).toBe("pending"); // set by the route's request flow
    for (const forged of [
      "invoiceNumber",
      "sessionCompletedAt",
      "sessionOutcome",
      "fiscalReceiptIssuedAt",
      "cascadeAttempts",
    ]) {
      expect(apt).not.toHaveProperty(forged);
    }
  });

  it("still books the client for themself with the intake they sent", async () => {
    const res = await book(intake);
    expect(res.status).toBeLessThan(300);
    const apt = h.saved[0];
    expect(apt.clientId).toBe("prospect-1");
    expect(apt.needs).toEqual(["Anxiété"]);
    expect(apt.type).toBe("video");
    expect(apt.bookingFor).toBe("self");
  });

  it("maps a real client-chosen payment method, never 'manual'", async () => {
    await book({ ...intake, paymentMethod: "transfer" });
    expect((h.saved[0].payment as Record<string, unknown>).method).toBe("transfer");

    h.saved.length = 0;
    await book({ ...intake, paymentMethod: "manual" });
    const payment = (h.saved[0].payment ?? {}) as Record<string, unknown>;
    expect(payment.method).toBeUndefined();
  });

  it("never lets a client attach a professional or a time straight in", async () => {
    await book({ ...intake, professionalId: "pro-1", date: "2030-10-01", time: "10:00" });
    const apt = h.saved[0];
    expect(apt).not.toHaveProperty("professionalId");
    expect(apt).not.toHaveProperty("time");
    expect(apt.routingStatus).toBe("pending");
  });
});

describe("POST /api/appointments — a time chosen on a showcase page (spec 003)", () => {
  const direct = { slug: "sassi", service: "standard", date: "2030-09-16", time: "10:00" };
  const prepared = () => ({
    ok: true,
    holdId: "hold-1",
    professionalId: "pro-1",
    pricing: { sessionPrice: 130, platformFee: 30, professionalPayout: 100 },
    fields: {
      status: "pending",
      routingStatus: "proposed",
      proposedTo: ["pro-1"],
      date: new Date("2030-09-16T12:00:00Z"),
      time: "10:00",
      duration: 50,
      therapyType: "solo",
      directRequest: { state: "pending", holdId: "hold-1" },
    },
  });

  it("refuses a malformed request without holding anything", async () => {
    const res = await book({ ...intake, direct: { ...direct, time: "ten" } });
    expect(res).toMatchObject({ status: 400, body: { code: "INVALID_DIRECT_REQUEST" } });
    expect(h.prepareCalls).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it("passes on why the time cannot be requested", async () => {
    h.prepared = { ok: false, status: 409, code: "SLOT_TAKEN" };
    const res = await book({ ...intake, direct });
    expect(res).toMatchObject({ status: 409, body: { code: "SLOT_TAKEN" } });
    expect(h.saved).toEqual([]);
  });

  it("saves the request proposed to that professional, priced, attached to its hold, and never matched", async () => {
    h.prepared = prepared();
    const res = await book({ ...intake, therapyType: "couple", direct, changeProfessional: true, emergency: true });
    await settle();

    expect(res.status).toBe(201);
    expect(h.prepareCalls).toEqual([{ intent: direct, therapyType: "couple" }]);
    const apt = h.saved[0];
    expect(apt).toMatchObject({
      status: "pending",
      routingStatus: "proposed",
      time: "10:00",
      duration: 50,
      therapyType: "solo",
      directRequest: { state: "pending" },
      payment: { price: 130, platformFee: 30, professionalPayout: 100, status: "pending" },
    });
    // A direct request is never a "change of professional".
    expect(apt).not.toHaveProperty("changeProfessional");
    expect(h.attached).toEqual([[h.prepared, "apt-new"]]);
    expect(h.routed).toEqual([]);
    expect(h.adminAlerts).toBe(0);
    expect(h.notified).toEqual(["apt-new"]);
  });

  it("gives the slot back when the request cannot be saved", async () => {
    h.prepared = prepared();
    h.saveError = new Error("write failed");
    const res = await book({ ...intake, direct });
    expect(res.status).toBe(500);
    expect(h.abandoned).toEqual([h.prepared]);
    expect(h.attached).toEqual([]);
  });

  it("still routes and alerts for an ordinary request", async () => {
    await book(intake);
    await settle();
    expect(h.routed).toEqual(["apt-new"]);
    expect(h.adminAlerts).toBe(1);
    expect(h.notified).toEqual([]);
  });
});

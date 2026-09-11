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
  // Side effects are not under test; never let them fail the request.
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
  sendAdminNewServiceRequestAlert: vi.fn(async () => undefined),
  sendCancellationNotification: vi.fn(async () => true),
}));
vi.mock("@/lib/appointment-routing", () => ({
  routeAppointmentToProfessionals: vi.fn(async () => undefined),
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
    save = vi.fn(async () => this);
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
});

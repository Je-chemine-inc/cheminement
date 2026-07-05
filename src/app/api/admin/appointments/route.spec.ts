/**
 * Admin substitution booking: POST /api/admin/appointments.
 * Pins the guard (admin + manageUsers) and — the regression this file exists
 * for — that the client + professional notifications are scheduled through
 * next/server `after()`. A bare fire-and-forget Promise.all is killed on Vercel
 * when the response returns, before Gmail SMTP finishes, so the client never
 * receives the confirmation for the newly-booked appointment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_ID = "d1d1d1d1d1d1d1d1d1d1d1d1";
const CLIENT_ID = "c1c1c1c1c1c1c1c1c1c1c1c1";
const PRO_ID = "b1b1b1b1b1b1b1b1b1b1b1b1";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const sendConfirmation = vi.fn().mockResolvedValue(true);
  const sendProNotification = vi.fn().mockResolvedValue(true);
  const afterSpy = vi.fn();
  const conflictFindOne = vi.fn();
  const store: {
    admin: unknown;
    client: unknown;
    professional: unknown;
    lastSaved?: Record<string, unknown>;
  } = { admin: { permissions: { manageUsers: true } }, client: {}, professional: {} };
  return {
    getServerSession,
    sendConfirmation,
    sendProNotification,
    afterSpy,
    conflictFindOne,
    store,
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  // Record that the send was scheduled through after(), then run it so the
  // notification spies observe the call.
  after: (fn: () => void) => {
    h.afterSpy();
    fn();
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
    .mockResolvedValue({ sessionPrice: 100, platformFee: 20, professionalPayout: 80 }),
}));
vi.mock("@/lib/motifs", () => ({
  getValidMotifLabels: vi.fn().mockResolvedValue(new Set<string>()),
}));
vi.mock("@/lib/appointment-date", () => ({
  parseAppointmentDate: (s: string) => new Date(`${s}T12:00:00.000Z`),
}));
vi.mock("@/lib/notifications", () => ({
  sendAppointmentConfirmation: h.sendConfirmation,
  sendProfessionalNotification: h.sendProNotification,
}));
vi.mock("@/models/Admin", () => ({
  default: { findOne: () => Promise.resolve(h.store.admin) },
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => Promise.resolve(h.store.client),
    findOne: () => Promise.resolve(h.store.professional),
  },
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: () =>
      Promise.resolve({ availability: { sessionDurationMinutes: 50 } }),
  },
}));
vi.mock("@/models/Appointment", () => {
  class Appointment {
    _id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    save = vi.fn().mockResolvedValue(undefined);
    constructor(data: Record<string, unknown>) {
      Object.assign(this, data);
      h.store.lastSaved = { ...data };
    }
    static findOne = h.conflictFindOne;
  }
  return { default: Appointment };
});

import { POST as adminPOST } from "@/app/api/admin/appointments/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const callPost = (
  body: Record<string, unknown>,
  role = "admin",
  userId = ADMIN_ID,
): Res => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return adminPOST({ json: async () => body } as never) as unknown as Res;
};

const validBody = () => ({
  clientId: CLIENT_ID,
  professionalId: PRO_ID,
  date: "2099-02-20",
  time: "10:00",
  type: "video",
});

beforeEach(() => {
  vi.clearAllMocks();
  h.store.admin = { permissions: { manageUsers: true } };
  h.store.client = {
    _id: CLIENT_ID,
    role: "client",
    firstName: "Alex",
    lastName: "Client",
    email: "client@example.com",
    language: "fr",
  };
  h.store.professional = {
    _id: PRO_ID,
    role: "professional",
    firstName: "Dr",
    lastName: "Pro",
    email: "pro@example.com",
  };
  h.conflictFindOne.mockResolvedValue(null);
});

describe("POST /api/admin/appointments — guards", () => {
  it("rejects a non-admin (401)", async () => {
    const res = await callPost(validBody(), "professional", PRO_ID);
    expect(res.status).toBe(401);
    expect(h.afterSpy).not.toHaveBeenCalled();
  });

  it("rejects an admin without manageUsers (403)", async () => {
    h.store.admin = { permissions: { manageBilling: true } };
    const res = await callPost(validBody());
    expect(res.status).toBe(403);
  });

  it("rejects a double-booking conflict (409) without notifying", async () => {
    h.conflictFindOne.mockResolvedValueOnce({ _id: "other" });
    const res = await callPost(validBody());
    expect(res.status).toBe(409);
    expect(h.sendConfirmation).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/appointments — notifications survive on Vercel", () => {
  it("schedules the client + pro notifications through after()", async () => {
    const res = await callPost(validBody());
    expect(res.status).toBe(201);
    // The regression: sends MUST be wrapped in after() so Vercel keeps the
    // function alive until Gmail SMTP completes.
    expect(h.afterSpy).toHaveBeenCalledTimes(1);
    expect(h.sendConfirmation).toHaveBeenCalledTimes(1);
    expect(h.sendProNotification).toHaveBeenCalledTimes(1);
    expect(h.sendConfirmation.mock.calls[0][0]).toMatchObject({
      clientEmail: "client@example.com",
      locale: "fr",
    });
  });
});

/**
 * Manual invoice/receipt generator (admin-only). Pins the auth gate, input
 * validation, and the two exit actions:
 *  - "request" → appointment left pending (payment-request pipeline)
 *  - "paid"    → appointment marked paid + method "manual" (receipt pipeline)
 * plus the re-bill guard (already-issued receipt → 409).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO = "b3b3b3b3b3b3b3b3b3b3b3b3";
const CLIENT = "c3c3c3c3c3c3c3c3c3c3c3c3";
const APT = "f1f1f1f1f1f1f1f1f1f1f1f1";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const userFindById = vi.fn();
  const userFindOne = vi.fn();
  const aptFindById = vi.fn();
  const runSideEffects = vi.fn().mockResolvedValue(undefined);
  const saved: Record<string, unknown>[] = [];
  const store: {
    admin: Record<string, unknown> | null;
    existingApt: Record<string, unknown> | null;
  } = { admin: null, existingApt: null };
  return {
    getServerSession,
    userFindById,
    userFindOne,
    aptFindById,
    runSideEffects,
    saved,
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
  after: (fn: () => void) => {
    fn();
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/Admin", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(h.store.admin) }) }),
  },
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: (...a: unknown[]) => h.userFindById(...a),
    findOne: (...a: unknown[]) => h.userFindOne(...a),
  },
}));
vi.mock("@/models/Appointment", () => {
  function Appointment(this: Record<string, unknown>, data: Record<string, unknown>) {
    Object.assign(this, data);
    this._id = "apt_new";
    this.save = vi.fn().mockResolvedValue(undefined);
    h.saved.push(this);
  }
  (Appointment as unknown as { findById: unknown }).findById = (...a: unknown[]) =>
    h.aptFindById(...a);
  return { default: Appointment };
});
vi.mock("@/lib/stripe", () => ({
  calculatePlatformFee: (p: number) => p * 0.2,
  calculateProfessionalPayout: (p: number) => p * 0.8,
}));
vi.mock("@/lib/session-post-closure", () => ({
  runSessionClosureSideEffects: h.runSideEffects,
}));

import { POST as manualInvoicePOST } from "@/app/api/admin/manual-invoice/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (body: unknown, session: unknown = { user: { id: "adm", role: "admin" } }): Res => {
  h.getServerSession.mockResolvedValueOnce(session);
  return manualInvoicePOST({ json: async () => body } as never) as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.admin = null; // no granular record → allowed for a session admin
  h.store.existingApt = null;
  h.saved.length = 0;
  h.userFindById.mockResolvedValue({ role: "client" });
  h.userFindOne.mockResolvedValue({ _id: PRO, role: "professional", firstName: "Sam", lastName: "Pro" });
  h.aptFindById.mockImplementation(() => Promise.resolve(h.store.existingApt));
});

const base = {
  professionalId: PRO,
  clientId: CLIENT,
  date: "2026-07-14",
  time: "09:00",
  amount: 150,
};

describe("POST /api/admin/manual-invoice", () => {
  it("rejects a non-admin (401)", async () => {
    const res = await call({ ...base, action: "request" }, { user: { id: "x", role: "client" } });
    expect(res.status).toBe(401);
    expect(h.runSideEffects).not.toHaveBeenCalled();
  });

  it("400 on an invalid action", async () => {
    const res = await call({ ...base, action: "nope" });
    expect(res.status).toBe(400);
  });

  it("400 on a non-positive amount", async () => {
    const res = await call({ ...base, amount: 0, action: "request" });
    expect(res.status).toBe(400);
  });

  it("'request' creates a pending appointment and runs the pipeline (201)", async () => {
    const res = await call({ ...base, action: "request" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true });
    const apt = h.saved[0];
    expect((apt.payment as Record<string, unknown>).status).toBe("pending");
    expect((apt.payment as Record<string, unknown>).price).toBe(150);
    expect(h.runSideEffects).toHaveBeenCalledWith("apt_new");
  });

  it("'paid' marks the appointment paid with method 'manual' (201)", async () => {
    const res = await call({ ...base, amount: 250, action: "paid" });
    expect(res.status).toBe(201);
    const apt = h.saved[0];
    const payment = apt.payment as Record<string, unknown>;
    expect(payment.status).toBe("paid");
    expect(payment.method).toBe("manual");
    expect(payment.paidAt).toBeInstanceOf(Date);
    expect(h.runSideEffects).toHaveBeenCalledWith("apt_new");
  });

  it("refuses to re-bill an appointment whose receipt was already issued (409)", async () => {
    h.store.existingApt = {
      _id: APT,
      professionalId: { toString: () => PRO },
      fiscalReceiptIssuedAt: new Date(),
      payment: {},
    };
    const res = await call({ ...base, appointmentId: APT, action: "paid" });
    expect(res.status).toBe(409);
    expect(h.runSideEffects).not.toHaveBeenCalled();
  });
});

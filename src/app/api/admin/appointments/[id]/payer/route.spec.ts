/**
 * Spec 002 — the two admin payer actions. Pins the gate (active admin with
 * manageBilling — no other permission opens it), body validation, and that a
 * pre-closure choice cannot land on a closed session (it would silently not
 * apply: closure already ran).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APT_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";
const ADMIN_ID = "d1d1d1d1d1d1d1d1d1d1d1d1";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  permissions: { manageBilling: true } as Record<string, boolean> | null,
  reassign: vi.fn(),
  updateOne: vi.fn(),
  exists: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-rbac", () => ({
  getActiveAdminPermissions: vi.fn(async () => h.permissions),
}));
vi.mock("@/lib/session-payer-reassign", () => ({
  PAYER_DECISIONS: ["organization", "client", "external"],
  reassignSessionPayer: h.reassign,
}));
vi.mock("@/models/Appointment", () => ({
  default: { updateOne: h.updateOne, exists: h.exists },
}));

import { POST } from "./route";
import { PUT } from "../billing-override/route";

const req = (body: unknown) =>
  ({ json: async () => body }) as unknown as Parameters<typeof POST>[0];
const ctx = (id = APT_ID) => ({ params: Promise.resolve({ id }) });
type Res = { status: number; body: Record<string, unknown> };

beforeEach(() => {
  h.getServerSession.mockResolvedValue({ user: { id: ADMIN_ID, isAdmin: true, role: "admin" } });
  h.permissions = { manageBilling: true };
  h.reassign.mockReset();
  h.updateOne.mockReset();
  h.exists.mockReset();
});

describe.each([
  ["POST /payer", (b: unknown) => POST(req(b), ctx())],
  ["PUT /billing-override", (b: unknown) => PUT(req(b), ctx())],
])("%s — gate", (_name, call) => {
  it("401 without an admin session", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: "u1", isAdmin: false, role: "client" } });
    expect(((await call({ payer: "client" })) as unknown as Res).status).toBe(401);
    expect(h.reassign).not.toHaveBeenCalled();
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("403 for an admin without manageBilling, even with every other permission", async () => {
    h.permissions = { manageUsers: true, manageContent: true, manageBilling: false };
    expect(((await call({ payer: "client" })) as unknown as Res).status).toBe(403);
    expect(h.reassign).not.toHaveBeenCalled();
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("403 for a deactivated admin (no active Admin row)", async () => {
    h.permissions = null;
    expect(((await call({ payer: "client" })) as unknown as Res).status).toBe(403);
  });

  it("400 for an unknown payer", async () => {
    expect(((await call({ payer: "insurer" })) as unknown as Res).status).toBe(400);
    expect(((await call({ payer: { $ne: 1 } })) as unknown as Res).status).toBe(400);
  });
});

describe("POST /api/admin/appointments/[id]/payer", () => {
  it("passes the decision and the acting admin through, and reports the plan", async () => {
    h.reassign.mockResolvedValue({
      ok: true,
      plan: { kind: "client", state: "confirmed", reason: "client_override", clientPaymentStatus: "pending" },
      ledgerAdjustmentCents: 0,
    });
    const res = (await POST(req({ payer: "client", note: "  PAE refused  " }), ctx())) as unknown as Res;
    expect(res.status).toBe(200);
    expect(h.reassign).toHaveBeenCalledWith({
      appointmentId: APT_ID,
      decision: "client",
      adminUserId: ADMIN_ID,
      note: "PAE refused",
    });
    expect(res.body).toMatchObject({ kind: "client", clientPaymentStatus: "pending" });
  });

  it("returns the refusal's status and code", async () => {
    h.reassign.mockResolvedValue({ ok: false, status: 409, code: "CLIENT_ALREADY_PAID", error: "x" });
    const res = (await POST(req({ payer: "organization" }), ctx())) as unknown as Res;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CLIENT_ALREADY_PAID");
  });

  it("400 for a malformed id", async () => {
    const res = (await POST(req({ payer: "client" }), ctx("nope"))) as unknown as Res;
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/admin/appointments/[id]/billing-override", () => {
  it("sets the choice only while the session is open", async () => {
    h.updateOne.mockResolvedValue({ matchedCount: 1 });
    const res = (await PUT(req({ payer: "external", note: "Cash au PAE" }), ctx())) as unknown as Res;
    expect(res.status).toBe(200);
    const [filter, update] = h.updateOne.mock.calls[0] as [Record<string, unknown>, { $set: { billingOverride: Record<string, unknown> } }];
    expect(filter).toEqual({ _id: APT_ID, sessionCompletedAt: null });
    expect(update.$set.billingOverride).toMatchObject({ payer: "external", note: "Cash au PAE" });
    expect(String(update.$set.billingOverride.setBy)).toBe(ADMIN_ID);
  });

  it("null clears the choice", async () => {
    h.updateOne.mockResolvedValue({ matchedCount: 1 });
    await PUT(req({ payer: null }), ctx());
    expect(h.updateOne.mock.calls[0][1]).toEqual({ $unset: { billingOverride: 1 } });
  });

  it("409 once the session is closed", async () => {
    h.updateOne.mockResolvedValue({ matchedCount: 0 });
    h.exists.mockResolvedValue({ _id: APT_ID });
    const res = (await PUT(req({ payer: "client" }), ctx())) as unknown as Res;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_CLOSED");
  });

  it("404 for an unknown appointment", async () => {
    h.updateOne.mockResolvedValue({ matchedCount: 0 });
    h.exists.mockResolvedValue(null);
    expect(((await PUT(req({ payer: "client" }), ctx())) as unknown as Res).status).toBe(404);
  });
});

/**
 * Authorization + transition guard for POST /api/admin/users/[id]/account-activation.
 *
 * Pins: only an admin with managePatients may toggle; only client/professional
 * accounts; reactivation requires a currently-inactive account and clears
 * deactivatedAt; deactivation requires an active account and stamps
 * deactivatedAt. These guards are what keep the "Réactiver le compte" button
 * from becoming a second, unguarded path from pending -> active.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";
const ADMIN_SESSION = { user: { id: "adm0adm0adm0adm0adm0adm00", role: "admin" } };

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const findByIdAndUpdate = vi.fn();
  const adminFindOne = vi.fn();
  const userFindById = vi.fn();
  const store: {
    user: Record<string, unknown> | null;
    admin: Record<string, unknown> | null;
  } = { user: null, admin: null };
  return { getServerSession, findByIdAndUpdate, adminFindOne, userFindById, store };
});

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
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: (...args: unknown[]) => h.userFindById(...args),
    findByIdAndUpdate: h.findByIdAndUpdate,
  },
}));
vi.mock("@/models/Admin", () => ({
  default: { findOne: (...args: unknown[]) => h.adminFindOne(...args) },
}));

import { POST as accountActivationPOST } from "@/app/api/admin/users/[id]/account-activation/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (body: unknown, session: unknown, id = USER_ID): Res => {
  h.getServerSession.mockResolvedValueOnce(session);
  return accountActivationPOST(
    { json: async () => body } as never,
    { params: Promise.resolve({ id }) },
  ) as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.user = { _id: USER_ID, role: "client", status: "inactive" };
  h.store.admin = null; // no granular Admin record -> falls back to session role
  h.adminFindOne.mockImplementation(() => ({
    select: () => ({ lean: () => Promise.resolve(h.store.admin) }),
  }));
  h.userFindById.mockImplementation(() => ({
    select: () => Promise.resolve(h.store.user),
  }));
  h.findByIdAndUpdate.mockResolvedValue({});
});

describe("POST /api/admin/users/[id]/account-activation", () => {
  it("rejects a non-admin (401)", async () => {
    const res = await call({ activate: true }, { user: { id: "x", role: "client" } });
    expect(res.status).toBe(401);
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects an admin lacking managePatients (403)", async () => {
    h.store.admin = { permissions: { managePatients: false } };
    const res = await call({ activate: true }, ADMIN_SESSION);
    expect(res.status).toBe(403);
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("400 when 'activate' is missing / not a boolean", async () => {
    const res = await call({}, ADMIN_SESSION);
    expect(res.status).toBe(400);
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("reactivates an inactive client (200): status active + deactivatedAt unset", async () => {
    h.store.user = { _id: USER_ID, role: "client", status: "inactive" };
    const res = await call({ activate: true }, ADMIN_SESSION);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: "active" });
    expect(h.findByIdAndUpdate).toHaveBeenCalledWith(USER_ID, {
      $set: { status: "active" },
      $unset: { deactivatedAt: "" },
    });
  });

  it("409 when reactivating an account that is not inactive", async () => {
    h.store.user = { _id: USER_ID, role: "client", status: "active" };
    const res = await call({ activate: true }, ADMIN_SESSION);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "NOT_INACTIVE" });
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("deactivates an active professional (200): status inactive + deactivatedAt stamped", async () => {
    h.store.user = { _id: USER_ID, role: "professional", status: "active" };
    const res = await call({ activate: false }, ADMIN_SESSION);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: "inactive" });
    expect(h.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const update = h.findByIdAndUpdate.mock.calls[0][1] as {
      $set: { status: string; deactivatedAt: unknown };
    };
    expect(update.$set.status).toBe("inactive");
    expect(update.$set.deactivatedAt).toBeInstanceOf(Date);
  });

  it("409 when deactivating an account that is not active (e.g. pending)", async () => {
    h.store.user = { _id: USER_ID, role: "professional", status: "pending" };
    const res = await call({ activate: false }, ADMIN_SESSION);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "NOT_ACTIVE" });
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects toggling a non-client/professional account (400)", async () => {
    h.store.user = { _id: USER_ID, role: "admin", status: "inactive" };
    const res = await call({ activate: true }, ADMIN_SESSION);
    expect(res.status).toBe(400);
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("404 when the user does not exist", async () => {
    h.store.user = null;
    const res = await call({ activate: true }, ADMIN_SESSION);
    expect(res.status).toBe(404);
  });
});

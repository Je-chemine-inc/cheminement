/**
 * Guards + idempotency for POST /api/users/me/deactivate.
 *
 * Pins: client/professional only; the admin alert fires ONLY on a real
 * active/pending -> inactive transition. A replayed POST from a still-valid
 * session (account already inactive) acknowledges without re-alerting or
 * re-stamping deactivatedAt. A professional's products leave the site with the
 * account (spec 003 phase 5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const userFindOneAndUpdate = vi.fn();
  const userExists = vi.fn();
  const recordAccountActionRequest = vi.fn().mockResolvedValue(undefined);
  const syncProfessionalProducts = vi.fn();
  const store: { transitioned: Record<string, unknown> | null } = {
    transitioned: null,
  };
  return {
    getServerSession,
    userFindOneAndUpdate,
    userExists,
    recordAccountActionRequest,
    syncProfessionalProducts,
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
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({
  default: {
    findOneAndUpdate: (...args: unknown[]) => ({
      select: () => Promise.resolve(h.userFindOneAndUpdate(...args)),
    }),
    exists: (...args: unknown[]) => h.userExists(...args),
  },
}));
vi.mock("@/lib/account-action-alerts", () => ({
  recordAccountActionRequest: h.recordAccountActionRequest,
}));
vi.mock("@/lib/products", () => ({
  syncProfessionalProducts: h.syncProfessionalProducts,
}));

import { POST as deactivatePOST } from "@/app/api/users/me/deactivate/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (session: unknown): Res => {
  h.getServerSession.mockResolvedValueOnce(session);
  return deactivatePOST() as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.transitioned = {
    _id: USER_ID,
    status: "inactive",
    firstName: "Alex",
    lastName: "Roy",
    email: "alex@example.com",
    role: "client",
  };
  h.userFindOneAndUpdate.mockImplementation(() => h.store.transitioned);
  h.userExists.mockResolvedValue({ _id: USER_ID });
  h.syncProfessionalProducts.mockResolvedValue(0);
});

describe("POST /api/users/me/deactivate", () => {
  it("rejects an unauthenticated request (401)", async () => {
    const res = await call(null);
    expect(res.status).toBe(401);
    expect(h.recordAccountActionRequest).not.toHaveBeenCalled();
  });

  it("rejects a non-client/professional role (403)", async () => {
    const res = await call({ user: { id: USER_ID, role: "admin" } });
    expect(res.status).toBe(403);
    expect(h.recordAccountActionRequest).not.toHaveBeenCalled();
  });

  it("alerts admins on a real active -> inactive transition (200)", async () => {
    const res = await call({ user: { id: USER_ID, role: "client" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(h.recordAccountActionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "deactivation", userId: USER_ID }),
    );
  });

  it("does NOT re-alert when the account is already inactive (200)", async () => {
    h.store.transitioned = null; // conditional update matched nothing
    const res = await call({ user: { id: USER_ID, role: "client" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(h.recordAccountActionRequest).not.toHaveBeenCalled();
  });

  it("404 when the account no longer exists", async () => {
    h.store.transitioned = null;
    h.userExists.mockResolvedValue(null);
    const res = await call({ user: { id: USER_ID, role: "client" } });
    expect(res.status).toBe(404);
    expect(h.recordAccountActionRequest).not.toHaveBeenCalled();
  });

  it("takes a professional's products off sale once the account is deactivated", async () => {
    h.store.transitioned = { ...h.store.transitioned, role: "professional" };
    const res = await call({ user: { id: USER_ID, role: "professional" } });
    expect(res.status).toBe(200);
    expect(h.syncProfessionalProducts).toHaveBeenCalledWith(USER_ID);
    expect(h.userFindOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      h.syncProfessionalProducts.mock.invocationCallOrder[0],
    );
  });

  it("leaves products alone for a client, and for an account already inactive", async () => {
    await call({ user: { id: USER_ID, role: "client" } });
    h.store.transitioned = null;
    await call({ user: { id: USER_ID, role: "professional" } });
    expect(h.syncProfessionalProducts).not.toHaveBeenCalled();
  });

  it("still deactivates and alerts when the products sync fails", async () => {
    h.store.transitioned = { ...h.store.transitioned, role: "professional" };
    h.syncProfessionalProducts.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call({ user: { id: USER_ID, role: "professional" } });
    expect(res.status).toBe(200);
    expect(h.recordAccountActionRequest).toHaveBeenCalled();
  });
});

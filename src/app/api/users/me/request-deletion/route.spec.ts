/**
 * Guards + behavior for POST /api/users/me/request-deletion (droit à l'oubli).
 *
 * Pins: only a logged-in client/professional may submit; the route never
 * deletes anything; on success it fires recordAccountActionRequest with
 * kind "deletion_request" (which emails admins + drops an in-app inbox entry).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const userFindById = vi.fn();
  const userFindOneAndUpdate = vi.fn();
  const recordAccountActionRequest = vi.fn().mockResolvedValue(undefined);
  const store: { user: Record<string, unknown> | null } = { user: null };
  return {
    getServerSession,
    userFindById,
    userFindOneAndUpdate,
    recordAccountActionRequest,
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
  // Run the scheduled callback synchronously so we can assert on it.
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
    findById: (...args: unknown[]) => h.userFindById(...args),
    findOneAndUpdate: (...args: unknown[]) => h.userFindOneAndUpdate(...args),
  },
}));
vi.mock("@/lib/account-action-alerts", () => ({
  recordAccountActionRequest: h.recordAccountActionRequest,
}));

import { POST as requestDeletionPOST } from "@/app/api/users/me/request-deletion/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (session: unknown): Res => {
  h.getServerSession.mockResolvedValueOnce(session);
  return requestDeletionPOST() as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.user = {
    _id: USER_ID,
    firstName: "Alex",
    lastName: "Roy",
    email: "alex@example.com",
    role: "client",
    language: "fr",
  };
  h.userFindById.mockImplementation(() => ({
    select: () => Promise.resolve(h.store.user),
  }));
  // The atomic claim succeeds by default (no prior request).
  h.userFindOneAndUpdate.mockResolvedValue({ _id: USER_ID });
});

describe("POST /api/users/me/request-deletion", () => {
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

  it("404 when the user record is missing", async () => {
    h.store.user = null;
    const res = await call({ user: { id: USER_ID, role: "client" } });
    expect(res.status).toBe(404);
    expect(h.recordAccountActionRequest).not.toHaveBeenCalled();
  });

  it("submits a deletion-request alert for a client (200) without deleting", async () => {
    const res = await call({ user: { id: USER_ID, role: "client" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(h.recordAccountActionRequest).toHaveBeenCalledTimes(1);
    expect(h.recordAccountActionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "deletion_request",
        userId: USER_ID,
        userName: "Alex Roy",
        userEmail: "alex@example.com",
        userRole: "client",
        locale: "fr",
      }),
    );
  });

  it("is idempotent: a second request does not re-alert admins (200)", async () => {
    h.store.user = {
      _id: USER_ID,
      firstName: "Alex",
      lastName: "Roy",
      email: "alex@example.com",
      role: "client",
      language: "fr",
      deletionRequestedAt: new Date("2099-01-01T00:00:00Z"),
    };
    const res = await call({ user: { id: USER_ID, role: "client" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, alreadyRequested: true });
    expect(h.userFindOneAndUpdate).not.toHaveBeenCalled();
    expect(h.recordAccountActionRequest).not.toHaveBeenCalled();
  });

  it("works for a professional too (200)", async () => {
    h.store.user = {
      _id: USER_ID,
      firstName: "Sam",
      lastName: "Pro",
      email: "sam@example.com",
      role: "professional",
      language: "en",
    };
    const res = await call({ user: { id: USER_ID, role: "professional" } });
    expect(res.status).toBe(200);
    expect(h.recordAccountActionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "deletion_request", locale: "en" }),
    );
  });
});

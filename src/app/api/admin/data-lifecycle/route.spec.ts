/**
 * POST /api/admin/data-lifecycle — erasing one person also takes their products
 * off sale when they are a professional (spec 003 phase 5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "b2b2b2b2b2b2b2b2b2b2b2b2";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  anonymizeSingleUser: vi.fn(),
  anonymizeExpiredAccounts: vi.fn(),
  syncProfessionalProducts: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/Admin", () => ({
  default: { findOne: () => ({ lean: async () => ({ permissions: { manageUsers: true } }) }) },
}));
vi.mock("@/lib/data-lifecycle", () => ({
  anonymizeSingleUser: h.anonymizeSingleUser,
  anonymizeExpiredAccounts: h.anonymizeExpiredAccounts,
}));
vi.mock("@/lib/products", () => ({ syncProfessionalProducts: h.syncProfessionalProducts }));

import { POST } from "@/app/api/admin/data-lifecycle/route";

const call = (body: unknown) => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: "a1a1a1a1a1a1a1a1a1a1a1a1", role: "admin" } });
  return POST({ json: async () => body } as never) as unknown as Promise<{
    status: number;
    body: Record<string, unknown>;
  }>;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.anonymizeSingleUser.mockResolvedValue(true);
  h.anonymizeExpiredAccounts.mockResolvedValue({ scanned: 0 });
  h.syncProfessionalProducts.mockResolvedValue(0);
});

describe("POST /api/admin/data-lifecycle — products of an erased professional", () => {
  it("syncs the person's products once they are anonymized", async () => {
    const res = await call({ action: "anonymize_user", userId: USER_ID });
    expect(res.status).toBe(200);
    expect(h.syncProfessionalProducts).toHaveBeenCalledWith(USER_ID);
    expect(h.anonymizeSingleUser.mock.invocationCallOrder[0]).toBeLessThan(
      h.syncProfessionalProducts.mock.invocationCallOrder[0],
    );
  });

  it("syncs nothing when nobody was anonymized, nor for the bulk run", async () => {
    h.anonymizeSingleUser.mockResolvedValue(false);
    expect((await call({ action: "anonymize_user", userId: USER_ID })).status).toBe(404);
    expect((await call({ action: "run_bulk" })).status).toBe(200);
    expect(h.syncProfessionalProducts).not.toHaveBeenCalled();
  });

  it("still answers when the products sync fails", async () => {
    h.syncProfessionalProducts.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call({ action: "anonymize_user", userId: USER_ID })).status).toBe(200);
  });
});

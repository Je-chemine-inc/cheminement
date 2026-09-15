import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN = "0123456789abcdef0123aaaa";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getActiveAdminPermissions: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-rbac", () => ({ getActiveAdminPermissions: h.getActiveAdminPermissions }));

import { requireContentAdmin } from "@/lib/content-admin";

beforeEach(() => {
  vi.clearAllMocks();
  h.getServerSession.mockResolvedValue({ user: { id: ADMIN, isAdmin: true } });
  h.getActiveAdminPermissions.mockResolvedValue({ manageContent: true });
});

describe("requireContentAdmin", () => {
  it("is 401 without a session", async () => {
    h.getServerSession.mockResolvedValue(null);
    const gate = await requireContentAdmin();
    expect(gate.error?.status).toBe(401);
    expect(h.getActiveAdminPermissions).not.toHaveBeenCalled();
  });

  it("is 401 for a signed-in user who is not an admin", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: "u1", isAdmin: false } });
    const gate = await requireContentAdmin();
    expect(gate.error?.status).toBe(401);
    expect(h.getActiveAdminPermissions).not.toHaveBeenCalled();
  });

  it("is 403 for an admin without manageContent", async () => {
    h.getActiveAdminPermissions.mockResolvedValue({ manageBilling: true });
    const gate = await requireContentAdmin();
    expect(gate.error?.status).toBe(403);
  });

  it("is 403 for an inactive admin", async () => {
    h.getActiveAdminPermissions.mockResolvedValue(null);
    const gate = await requireContentAdmin();
    expect(gate.error?.status).toBe(403);
  });

  it("lets an active admin with manageContent through", async () => {
    const gate = await requireContentAdmin();
    expect(gate).toEqual({ userId: ADMIN });
    expect(h.getActiveAdminPermissions).toHaveBeenCalledWith(ADMIN);
  });
});

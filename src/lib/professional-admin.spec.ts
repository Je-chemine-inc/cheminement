import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * requireProfessionalsAdmin gates what the public sees of a professional
 * (spec 003). It must fail closed: no session, not an admin, no active Admin
 * record, or any right other than manageProfessionals.
 */
const h = vi.hoisted(() => ({
  session: null as null | { user: { id?: string; isAdmin?: boolean } },
  permissions: null as Record<string, boolean> | null,
  connect: vi.fn(async () => undefined),
  readPermissions: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: h.connect }));
vi.mock("@/lib/admin-rbac", () => ({
  getActiveAdminPermissions: async (id: string) => {
    h.readPermissions(id);
    return h.permissions;
  },
}));

import { requireProfessionalsAdmin } from "@/lib/professional-admin";

type Gate = Awaited<ReturnType<typeof requireProfessionalsAdmin>>;
const statusOf = (gate: Gate) => (gate.error as unknown as { status: number } | undefined)?.status;

beforeEach(() => {
  h.session = { user: { id: "a1", isAdmin: true } };
  h.permissions = { manageProfessionals: true };
  h.readPermissions.mockReset();
  h.connect.mockClear();
});

describe("requireProfessionalsAdmin", () => {
  it("401 without a session or for someone who is not an admin, reading nothing", async () => {
    h.session = null;
    expect(statusOf(await requireProfessionalsAdmin())).toBe(401);
    h.session = { user: { id: "u1", isAdmin: false } };
    expect(statusOf(await requireProfessionalsAdmin())).toBe(401);
    expect(h.readPermissions).not.toHaveBeenCalled();
  });

  it("403 for an admin without manageProfessionals, even with every other right", async () => {
    h.permissions = { managePatients: true, manageBilling: true, manageContent: true, manageUsers: true };
    expect(statusOf(await requireProfessionalsAdmin())).toBe(403);
  });

  it("403 when there is no active Admin record", async () => {
    h.permissions = null;
    expect(statusOf(await requireProfessionalsAdmin())).toBe(403);
  });

  it("lets an admin who manages professionals through, with their session", async () => {
    const gate = await requireProfessionalsAdmin();
    expect(gate.error).toBeUndefined();
    expect(gate.session?.user.id).toBe("a1");
    expect(h.readPermissions).toHaveBeenCalledWith("a1");
  });
});

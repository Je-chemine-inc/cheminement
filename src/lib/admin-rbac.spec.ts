import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getAdminUiPermissions decides which screens the admin menu offers. Same rules
 * as requireBillingAdmin and requireProfessionalsAdmin, so the menu never
 * offers a screen its API refuses; it never throws, and anything unexpected
 * hides.
 */

const h = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
  filter: null as unknown,
  findOne: vi.fn(),
  connect: vi.fn(async () => undefined),
}));

vi.mock("@/lib/mongodb", () => ({ default: h.connect }));
vi.mock("@/models/Admin", () => ({
  default: {
    findOne: (filter: unknown) => {
      h.findOne(filter);
      h.filter = filter;
      return { select: () => ({ lean: async () => h.record }) };
    },
  },
}));

import { getAdminUiPermissions } from "@/lib/admin-rbac";

const admin = { id: "a1", isAdmin: true };
const NONE = { manageBilling: false, manageProfessionals: false };

beforeEach(() => {
  vi.clearAllMocks();
  h.record = null;
  h.filter = null;
  h.connect.mockImplementation(async () => undefined);
});

describe("getAdminUiPermissions", () => {
  it("reads nothing for someone who is not an admin", async () => {
    expect(await getAdminUiPermissions({ id: "u1", isAdmin: false })).toEqual(NONE);
    expect(await getAdminUiPermissions(null)).toEqual(NONE);
    expect(await getAdminUiPermissions({ isAdmin: true })).toEqual(NONE);
    expect(h.findOne).not.toHaveBeenCalled();
  });

  it("grants billing screens only with manageBilling on an active admin record", async () => {
    h.record = { permissions: { manageBilling: true } };
    expect(await getAdminUiPermissions(admin)).toEqual({ manageBilling: true, manageProfessionals: false });
    expect(h.filter).toEqual({ userId: "a1", isActive: true });
  });

  it("grants the showcase screens only with manageProfessionals", async () => {
    h.record = { permissions: { manageProfessionals: true, managePatients: true } };
    expect(await getAdminUiPermissions(admin)).toEqual({ manageBilling: false, manageProfessionals: true });
    h.record = { permissions: { manageProfessionals: "yes" } };
    expect(await getAdminUiPermissions(admin)).toEqual(NONE);
  });

  it("hides them without the permission, or without an admin record", async () => {
    h.record = { permissions: { manageBilling: false, managePatients: true } };
    expect(await getAdminUiPermissions(admin)).toEqual(NONE);
    h.record = null;
    expect(await getAdminUiPermissions(admin)).toEqual(NONE);
  });

  it("hides them when the database cannot answer, rather than failing the page", async () => {
    h.connect.mockRejectedValueOnce(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await getAdminUiPermissions(admin)).toEqual(NONE);
    spy.mockRestore();
  });
});

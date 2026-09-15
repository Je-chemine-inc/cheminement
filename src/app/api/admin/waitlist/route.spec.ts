import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ADMIN = "0123456789abcdef0123dddd";

const h = vi.hoisted(() => ({
  gate: { session: { user: { id: "" } } } as { error: Response } | { session: { user: { id: string } } },
  permissions: null as { managePatients?: boolean } | null,
  permissionLookups: [] as string[],
  lists: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/professional-admin", () => ({ requireProfessionalsAdmin: async () => h.gate }));
vi.mock("@/lib/admin-rbac", () => ({
  getActiveAdminPermissions: async (id: string) => {
    h.permissionLookups.push(id);
    return h.permissions;
  },
}));
vi.mock("@/lib/waitlist-entries", () => ({
  listAdminWaitlist: async (input: Record<string, unknown>) => {
    h.lists.push(input);
    return [{ id: "e1" }];
  },
}));

import { GET } from "@/app/api/admin/waitlist/route";

const call = (query = "") => GET(new NextRequest(`http://www.jechemine.ca/api/admin/waitlist${query}`));

beforeEach(() => {
  h.gate = { session: { user: { id: ADMIN } } };
  h.permissions = { managePatients: true };
  h.permissionLookups = [];
  h.lists = [];
});

describe("GET /api/admin/waitlist", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    h.gate = { error: refusal };
    expect(await call()).toBe(refusal);
    expect(h.lists).toEqual([]);
  });

  it("refuses an unknown scope", async () => {
    expect((await call("?scope=everything")).status).toBe(400);
    expect(h.lists).toEqual([]);
  });

  it("lists open entries by default with contact details for an admin who manages patients", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ entries: [{ id: "e1" }], showContact: true });
    expect(h.permissionLookups).toEqual([ADMIN]);
    expect(h.lists).toEqual([{ scope: "open", showContact: true }]);
  });

  it("hides contact details from an admin without managePatients", async () => {
    h.permissions = { managePatients: false };
    expect(await (await call("?scope=closed")).json()).toMatchObject({ showContact: false });
    h.permissions = null;
    expect(await (await call("?scope=all")).json()).toMatchObject({ showContact: false });
    expect(h.lists).toEqual([
      { scope: "closed", showContact: false },
      { scope: "all", showContact: false },
    ]);
  });
});

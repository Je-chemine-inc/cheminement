import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ADMIN = "0123456789abcdef0123aaaa";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  listProductsForAdmin: vi.fn(),
}));

vi.mock("@/lib/content-admin", () => ({ requireContentAdmin: async () => h.gate }));
vi.mock("@/lib/products", () => ({ listProductsForAdmin: h.listProductsForAdmin }));

import { GET } from "./route";

const call = (query = "") => GET(new NextRequest(`http://www.jechemine.ca/api/admin/products${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: ADMIN };
  h.listProductsForAdmin.mockResolvedValue([{ slug: "guide" }]);
});

describe("GET /api/admin/products", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Forbidden - missing permission: manageContent" }, { status: 403 });
    h.gate = { error: refusal };
    expect(await call()).toBe(refusal);
    expect(h.listProductsForAdmin).not.toHaveBeenCalled();
  });

  it("lists what awaits review by default, uncached", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ products: [{ slug: "guide" }] });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.listProductsForAdmin).toHaveBeenCalledWith("review");
  });

  it("lists everything with scope=all", async () => {
    await call("?scope=all");
    expect(h.listProductsForAdmin).toHaveBeenCalledWith("all");
  });

  it("refuses any other scope", async () => {
    for (const scope of ["published", "", "ALL"]) {
      const res = await call(`?scope=${scope}`);
      expect(res.status).toBe(400);
    }
    expect(h.listProductsForAdmin).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  gate: { userId: "admin" } as { error: Response } | { userId: string },
  listArticlesForAdmin: vi.fn(),
}));

vi.mock("@/lib/content-admin", () => ({ requireContentAdmin: async () => h.gate }));
vi.mock("@/lib/articles", () => ({ listArticlesForAdmin: h.listArticlesForAdmin }));

import { GET } from "./route";

const get = (query = "") => GET(new NextRequest(`http://www.jechemine.ca/api/admin/articles${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: "admin" };
  h.listArticlesForAdmin.mockResolvedValue([{ slug: "mieux-dormir" }]);
});

describe("GET /api/admin/articles", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    h.gate = { error: refusal };
    expect(await get()).toBe(refusal);
    expect(h.listArticlesForAdmin).not.toHaveBeenCalled();
  });

  it("lists the review queue by default, or everything, uncached", async () => {
    const res = await get();
    expect(await res.json()).toEqual({ articles: [{ slug: "mieux-dormir" }] });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await get("?scope=all");
    expect(h.listArticlesForAdmin.mock.calls).toEqual([["review"], ["all"]]);
  });

  it("refuses an unknown scope", async () => {
    expect((await get("?scope=drafts")).status).toBe(400);
    expect(h.listArticlesForAdmin).not.toHaveBeenCalled();
  });
});

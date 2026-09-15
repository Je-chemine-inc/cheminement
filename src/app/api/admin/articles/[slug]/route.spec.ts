import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ADMIN = "0123456789abcdef0123aaaa";
const SLUG = "mieux-dormir";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  adminArticleAction: vi.fn(),
}));

vi.mock("@/lib/content-admin", () => ({ requireContentAdmin: async () => h.gate }));
vi.mock("@/lib/articles", () => ({ adminArticleAction: h.adminArticleAction }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new NextRequest(`http://www.jechemine.ca/api/admin/articles/${SLUG}`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug: SLUG }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: ADMIN };
  h.adminArticleAction.mockResolvedValue({ ok: true, status: "approved" });
});

describe("POST /api/admin/articles/[slug]", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await post({ action: "approve" })).toBe(refusal);
    expect(h.adminArticleAction).not.toHaveBeenCalled();
  });

  it("refuses an action that is not the team's", async () => {
    for (const action of ["submit", "withdraw", "delete", undefined]) {
      const res = await post({ action });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_ACTION" });
    }
    expect(h.adminArticleAction).not.toHaveBeenCalled();
  });

  it("decides as the gate's admin: approve, reject with notes, unpublish, feature and unfeature", async () => {
    for (const action of ["approve", "reject", "unpublish", "feature", "unfeature"]) await post({ action, notes: "Note" });
    expect(h.adminArticleAction.mock.calls.map((call) => call[0])).toEqual(
      ["approve", "reject", "unpublish", "feature", "unfeature"].map((action) => ({ adminId: ADMIN, slug: SLUG, action, notes: "Note" })),
    );
  });

  it("passes a failure's code, details and status through", async () => {
    h.adminArticleAction.mockResolvedValue({ ok: false, status: 409, code: "TRANSITION_NOT_ALLOWED", details: { from: "draft" } });
    const res = await post({ action: "feature" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TRANSITION_NOT_ALLOWED", from: "draft" });
  });
});

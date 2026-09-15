import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ADMIN = "0123456789abcdef0123aaaa";
const SLUG = "gerer-son-stress";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  adminProductAction: vi.fn(),
}));

vi.mock("@/lib/content-admin", () => ({ requireContentAdmin: async () => h.gate }));
vi.mock("@/lib/products", () => ({ adminProductAction: h.adminProductAction }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new NextRequest(`http://www.jechemine.ca/api/admin/products/${SLUG}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: SLUG }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: ADMIN };
  h.adminProductAction.mockResolvedValue({ ok: true, status: "approved" });
});

describe("POST /api/admin/products/[slug]", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await post({ action: "approve" })).toBe(refusal);
    expect(h.adminProductAction).not.toHaveBeenCalled();
  });

  it("refuses an unknown or missing action", async () => {
    for (const action of ["submit", "withdraw", "delete", undefined, true]) {
      const res = await post({ action });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_ACTION" });
    }
    expect(h.adminProductAction).not.toHaveBeenCalled();
  });

  it("decides as the gate's admin and forwards the notes", async () => {
    h.adminProductAction.mockResolvedValue({ ok: true, status: "rejected" });
    const res = await post({ action: "reject", notes: "Ajoutez un résumé." });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "rejected" });
    expect(h.adminProductAction).toHaveBeenCalledWith({
      adminId: ADMIN,
      slug: SLUG,
      action: "reject",
      notes: "Ajoutez un résumé.",
    });
  });

  it("passes approve and unpublish through", async () => {
    await post({ action: "approve" });
    await post({ action: "unpublish" });
    const actions = h.adminProductAction.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions).toEqual(["approve", "unpublish"]);
  });

  it("passes a failure's code, details and status through", async () => {
    h.adminProductAction.mockResolvedValue({
      ok: false,
      status: 409,
      code: "TRANSITION_NOT_ALLOWED",
      details: { from: "draft" },
    });
    const res = await post({ action: "approve" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TRANSITION_NOT_ALLOWED", from: "draft" });
  });

  it("passes NOTES_REQUIRED through", async () => {
    h.adminProductAction.mockResolvedValue({ ok: false, status: 400, code: "NOTES_REQUIRED" });
    const res = await post({ action: "reject" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "NOTES_REQUIRED" });
  });
});

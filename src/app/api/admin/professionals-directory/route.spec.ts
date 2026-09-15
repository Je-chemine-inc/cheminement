import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ADMIN = "0123456789abcdef0123aaaa";
const A = "0123456789abcdef0123bbbb";
const B = "0123456789abcdef0123cccc";

const h = vi.hoisted(() => ({
  gate: {} as { error: Response } | { session: { user: { id: string } } },
  load: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/lib/professional-admin", () => ({ requireProfessionalsAdmin: async () => h.gate }));
vi.mock("@/lib/professionals-directory-queries", () => ({
  loadProfessionalsDirectoryAdmin: h.load,
  saveProfessionalsDirectoryCuration: h.save,
}));

import { GET, PUT } from "./route";

const put = (body: unknown) =>
  PUT(
    new NextRequest("http://www.jechemine.ca/api/admin/professionals-directory", {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const view = { rows: [{ id: A }], updatedAt: "2026-09-15T20:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { session: { user: { id: ADMIN } } };
  h.load.mockResolvedValue(view);
  h.save.mockResolvedValue({ ok: true, updatedAt: "2026-09-15T21:00:00.000Z" });
});

describe("GET /api/admin/professionals-directory", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Forbidden - missing permission: manageProfessionals" }, { status: 403 });
    h.gate = { error: refusal };
    expect(await GET()).toBe(refusal);
    expect(h.load).not.toHaveBeenCalled();
  });

  it("returns the team's view, uncached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(view);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("PUT /api/admin/professionals-directory", () => {
  it("returns the gate's refusal as is, saving nothing", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await put({ order: [], hidden: [], expectedUpdatedAt: null })).toBe(refusal);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("saves the order and hidden list on the version the screen loaded, as this admin, and returns the new view", async () => {
    const res = await put({ order: [B, A], hidden: [A], expectedUpdatedAt: view.updatedAt });
    expect(res.status).toBe(200);
    expect(h.save).toHaveBeenCalledWith({ order: [B, A], hidden: [A], expectedUpdatedAt: view.updatedAt, adminId: ADMIN });
    expect(await res.json()).toEqual(view);
  });

  it("refuses a body that is not two lists of distinct ids and a version", async () => {
    for (const body of ["{", { order: [A] }, { order: [A, A], hidden: [], expectedUpdatedAt: null }, { order: [{ $gt: "" }], hidden: [], expectedUpdatedAt: null }]) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID" });
    }
    expect(h.save).not.toHaveBeenCalled();
  });

  it("answers 409 when someone saved since, or the settings were never saved", async () => {
    for (const code of ["CHANGED", "SETTINGS_MISSING"]) {
      h.save.mockResolvedValueOnce({ ok: false, code });
      const res = await put({ order: [], hidden: [], expectedUpdatedAt: null });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
    }
  });
});

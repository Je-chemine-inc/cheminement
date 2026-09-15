import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";
const SLUG = "gerer-son-stress";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  professionalProductAction: vi.fn(),
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/products", () => ({ professionalProductAction: h.professionalProductAction }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new NextRequest(`http://www.jechemine.ca/api/professional/products/${SLUG}/actions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: SLUG }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: PRO };
  h.professionalProductAction.mockResolvedValue({ ok: true, status: "submitted" });
});

describe("POST /api/professional/products/[slug]/actions", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await post({ action: "submit", attest: true })).toBe(refusal);
    expect(h.professionalProductAction).not.toHaveBeenCalled();
  });

  it("refuses an unknown or missing action", async () => {
    for (const action of ["approve", "delete", "", undefined, 1]) {
      const res = await post({ action });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_ACTION" });
    }
    expect(h.professionalProductAction).not.toHaveBeenCalled();
  });

  it("acts as the gate's professional and answers with the new status", async () => {
    const res = await post({ action: "submit", attest: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "submitted" });
    expect(h.professionalProductAction).toHaveBeenCalledWith({
      professionalId: PRO,
      slug: SLUG,
      action: "submit",
      attest: true,
    });
  });

  it("counts only a literal true as the attestation", async () => {
    for (const attest of ["true", 1, "yes", null, undefined]) {
      await post({ action: "submit", attest });
    }
    const passed = h.professionalProductAction.mock.calls.map((call) => (call[0] as { attest: unknown }).attest);
    expect(passed).toEqual([false, false, false, false, false]);
  });

  it("passes withdraw and unpublish through", async () => {
    await post({ action: "withdraw" });
    await post({ action: "unpublish" });
    const actions = h.professionalProductAction.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions).toEqual(["withdraw", "unpublish"]);
  });

  it("passes a failure's code, details and status through", async () => {
    h.professionalProductAction.mockResolvedValue({
      ok: false,
      status: 400,
      code: "INCOMPLETE",
      details: { missing: ["file", "attestation"] },
    });
    const res = await post({ action: "submit" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INCOMPLETE", missing: ["file", "attestation"] });
  });
});

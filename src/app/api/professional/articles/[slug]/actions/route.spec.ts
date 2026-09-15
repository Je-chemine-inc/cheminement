import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";
const SLUG = "mieux-dormir";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  professionalArticleAction: vi.fn(),
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/articles", () => ({ professionalArticleAction: h.professionalArticleAction }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new NextRequest(`http://www.jechemine.ca/api/professional/articles/${SLUG}/actions`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ slug: SLUG }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: PRO };
  h.professionalArticleAction.mockResolvedValue({ ok: true, status: "submitted" });
});

describe("POST /api/professional/articles/[slug]/actions", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await post({ action: "submit", attest: true })).toBe(refusal);
    expect(h.professionalArticleAction).not.toHaveBeenCalled();
  });

  it("refuses an action that is not the professional's", async () => {
    for (const action of ["approve", "reject", "feature", undefined]) {
      const res = await post({ action });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_ACTION" });
    }
    expect(h.professionalArticleAction).not.toHaveBeenCalled();
  });

  it("sends with the attestation only when it is literally true", async () => {
    await post({ action: "submit", attest: true });
    await post({ action: "submit", attest: "true" });
    expect(h.professionalArticleAction.mock.calls.map((call) => (call[0] as { attest: boolean }).attest)).toEqual([true, false]);
    expect(h.professionalArticleAction).toHaveBeenCalledWith({ professionalId: PRO, slug: SLUG, action: "submit", attest: true });
  });

  it("passes a failure's code, details and status through", async () => {
    h.professionalArticleAction.mockResolvedValue({ ok: false, status: 400, code: "INCOMPLETE", details: { missing: ["attestation"] } });
    const res = await post({ action: "submit" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INCOMPLETE", missing: ["attestation"] });
  });
});

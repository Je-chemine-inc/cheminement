import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  createArticle: vi.fn(),
  listProfessionalArticles: vi.fn(),
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/articles", () => ({
  createArticle: h.createArticle,
  listProfessionalArticles: h.listProfessionalArticles,
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://www.jechemine.ca/api/professional/articles", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: PRO };
  h.listProfessionalArticles.mockResolvedValue([{ slug: "mieux-dormir" }]);
  h.createArticle.mockResolvedValue({ ok: true, slug: "mieux-dormir" });
});

describe("GET /api/professional/articles", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await GET()).toBe(refusal);
    expect(h.listProfessionalArticles).not.toHaveBeenCalled();
  });

  it("lists the signed-in professional's articles, uncached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ articles: [{ slug: "mieux-dormir" }] });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.listProfessionalArticles).toHaveBeenCalledWith(PRO);
  });
});

describe("POST /api/professional/articles", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 });
    h.gate = { error: refusal };
    expect(await post({ titleFr: "Mieux dormir" })).toBe(refusal);
    expect(h.createArticle).not.toHaveBeenCalled();
  });

  it("creates a draft for the gate's professional, never one named in the body", async () => {
    const res = await post({ titleFr: "Mieux dormir", professionalId: "0123456789abcdef0123ffff" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ slug: "mieux-dormir" });
    expect(h.createArticle).toHaveBeenCalledWith({ professionalId: PRO, titleFr: "Mieux dormir" });
  });

  it("passes a failure through, and survives a body that is not JSON", async () => {
    h.createArticle.mockResolvedValue({ ok: false, status: 400, code: "INVALID_TITLE" });
    const res = await post("not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TITLE" });
    expect(h.createArticle).toHaveBeenCalledWith({ professionalId: PRO, titleFr: undefined });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";
const SLUG = "mieux-dormir";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  loadArticleEditor: vi.fn(),
  updateArticle: vi.fn(),
  deleteArticle: vi.fn(),
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/articles", () => ({
  loadArticleEditor: h.loadArticleEditor,
  updateArticle: h.updateArticle,
  deleteArticle: h.deleteArticle,
}));

import { DELETE, GET, PUT } from "./route";

const params = { params: Promise.resolve({ slug: SLUG }) };
const url = `http://www.jechemine.ca/api/professional/articles/${SLUG}`;

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: PRO };
  h.loadArticleEditor.mockResolvedValue({ slug: SLUG });
  h.updateArticle.mockResolvedValue({ ok: true });
  h.deleteArticle.mockResolvedValue({ ok: true });
});

describe("/api/professional/articles/[slug]", () => {
  it("returns the gate's refusal as is on every method", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await GET(new NextRequest(url), params)).toBe(refusal);
    expect(await PUT(new NextRequest(url, { method: "PUT", body: "{}" }), params)).toBe(refusal);
    expect(await DELETE(new NextRequest(url, { method: "DELETE" }), params)).toBe(refusal);
    expect(h.loadArticleEditor).not.toHaveBeenCalled();
    expect(h.updateArticle).not.toHaveBeenCalled();
    expect(h.deleteArticle).not.toHaveBeenCalled();
  });

  it("reads only the gate's professional's article, 404 otherwise, uncached", async () => {
    const res = await GET(new NextRequest(url), params);
    expect(await res.json()).toEqual({ slug: SLUG });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.loadArticleEditor).toHaveBeenCalledWith(PRO, SLUG);
    h.loadArticleEditor.mockResolvedValue(null);
    expect((await GET(new NextRequest(url), params)).status).toBe(404);
  });

  it("edits as the gate's professional and answers with the editor's data, or the failure", async () => {
    const res = await PUT(new NextRequest(url, { method: "PUT", body: JSON.stringify({ titleFr: "Titre" }) }), params);
    expect(await res.json()).toEqual({ slug: SLUG });
    expect(h.updateArticle).toHaveBeenCalledWith({ professionalId: PRO, slug: SLUG, body: { titleFr: "Titre" } });
    h.updateArticle.mockResolvedValue({ ok: false, status: 409, code: "UNDER_REVIEW" });
    const refused = await PUT(new NextRequest(url, { method: "PUT", body: "{}" }), params);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "UNDER_REVIEW" });
  });

  it("deletes as the gate's professional", async () => {
    const res = await DELETE(new NextRequest(url, { method: "DELETE" }), params);
    expect(await res.json()).toEqual({ deleted: true });
    expect(h.deleteArticle).toHaveBeenCalledWith({ professionalId: PRO, slug: SLUG });
  });
});

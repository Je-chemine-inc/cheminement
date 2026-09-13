import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";
const SLUG = "gerer-son-stress";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  loadProductEditor: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/products", () => ({
  loadProductEditor: h.loadProductEditor,
  updateProduct: h.updateProduct,
  deleteProduct: h.deleteProduct,
}));

import { DELETE, GET, PUT } from "./route";

const URL_ = `http://www.jechemine.ca/api/professional/products/${SLUG}`;
const ctx = () => ({ params: Promise.resolve({ slug: SLUG }) });
const refuse = () => {
  const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  h.gate = { error: refusal };
  return refusal;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: PRO };
  h.loadProductEditor.mockResolvedValue({ slug: SLUG });
  h.updateProduct.mockResolvedValue({ ok: true });
  h.deleteProduct.mockResolvedValue({ ok: true });
});

describe("GET /api/professional/products/[slug]", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = refuse();
    expect(await GET(new NextRequest(URL_), ctx())).toBe(refusal);
    expect(h.loadProductEditor).not.toHaveBeenCalled();
  });

  it("loads the product for the gate's professional", async () => {
    const res = await GET(new NextRequest(URL_), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: SLUG });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.loadProductEditor).toHaveBeenCalledWith(PRO, SLUG);
  });

  it("is 404 for a product that is not theirs", async () => {
    h.loadProductEditor.mockResolvedValue(null);
    const res = await GET(new NextRequest(URL_), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });
});

describe("PUT /api/professional/products/[slug]", () => {
  const put = (body: unknown) => PUT(new NextRequest(URL_, { method: "PUT", body: JSON.stringify(body) }), ctx());

  it("returns the gate's refusal as is", async () => {
    const refusal = refuse();
    expect(await put({ titleFr: "x" })).toBe(refusal);
    expect(h.updateProduct).not.toHaveBeenCalled();
  });

  it("edits as the gate's professional and answers with the fresh editor", async () => {
    const res = await put({ titleFr: "Nouveau" });
    expect(res.status).toBe(200);
    expect(h.updateProduct).toHaveBeenCalledWith({ professionalId: PRO, slug: SLUG, body: { titleFr: "Nouveau" } });
    expect(h.loadProductEditor).toHaveBeenCalledWith(PRO, SLUG);
    expect(await res.json()).toEqual({ slug: SLUG });
  });

  it("passes a failure's code, details and status through", async () => {
    h.updateProduct.mockResolvedValue({ ok: false, status: 400, code: "INVALID_PRICE", details: { field: "priceCents" } });
    const res = await put({ priceCents: 1 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PRICE", field: "priceCents" });
  });

  it("passes a conflict through", async () => {
    h.updateProduct.mockResolvedValue({ ok: false, status: 409, code: "UNDER_REVIEW" });
    const res = await put({ titleFr: "x" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "UNDER_REVIEW" });
  });
});

describe("DELETE /api/professional/products/[slug]", () => {
  const del = () => DELETE(new NextRequest(URL_, { method: "DELETE" }), ctx());

  it("returns the gate's refusal as is", async () => {
    const refusal = refuse();
    expect(await del()).toBe(refusal);
    expect(h.deleteProduct).not.toHaveBeenCalled();
  });

  it("deletes as the gate's professional", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(h.deleteProduct).toHaveBeenCalledWith({ professionalId: PRO, slug: SLUG });
  });

  it("passes HAS_SALES through", async () => {
    h.deleteProduct.mockResolvedValue({ ok: false, status: 409, code: "HAS_SALES" });
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "HAS_SALES" });
  });
});

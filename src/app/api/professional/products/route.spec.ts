import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  createProduct: vi.fn(),
  listProfessionalProducts: vi.fn(),
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/products", () => ({
  createProduct: h.createProduct,
  listProfessionalProducts: h.listProfessionalProducts,
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://www.jechemine.ca/api/professional/products", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: PRO };
  h.listProfessionalProducts.mockResolvedValue([{ slug: "guide" }]);
  h.createProduct.mockResolvedValue({ ok: true, slug: "gerer-son-stress" });
});

describe("GET /api/professional/products", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await GET()).toBe(refusal);
    expect(h.listProfessionalProducts).not.toHaveBeenCalled();
  });

  it("lists the signed-in professional's products, uncached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ products: [{ slug: "guide" }] });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.listProfessionalProducts).toHaveBeenCalledWith(PRO);
  });
});

describe("POST /api/professional/products", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 });
    h.gate = { error: refusal };
    expect(await post({ type: "pdf", titleFr: "Guide" })).toBe(refusal);
    expect(h.createProduct).not.toHaveBeenCalled();
  });

  it("creates a draft for the gate's professional, never one named in the body", async () => {
    const res = await post({ type: "pdf", titleFr: "Gérer son stress", professionalId: "0123456789abcdef0123ffff" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ slug: "gerer-son-stress" });
    expect(h.createProduct).toHaveBeenCalledWith({ professionalId: PRO, type: "pdf", titleFr: "Gérer son stress" });
  });

  it("passes a failure's code and status through", async () => {
    h.createProduct.mockResolvedValue({ ok: false, status: 400, code: "INVALID_TYPE" });
    const res = await post({ type: "podcast", titleFr: "Guide" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TYPE" });
  });

  it("survives a body that is not JSON", async () => {
    h.createProduct.mockResolvedValue({ ok: false, status: 400, code: "INVALID_TYPE" });
    const res = await post("not json");
    expect(res.status).toBe(400);
    expect(h.createProduct).toHaveBeenCalledWith({ professionalId: PRO, type: undefined, titleFr: undefined });
  });
});

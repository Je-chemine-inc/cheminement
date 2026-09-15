import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";
const STORED = "0123456789abcdef0123bbbb";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  prepareAndScanUpload: vi.fn(),
  storedCreate: vi.fn(),
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/upload-pipeline", () => ({ prepareAndScanUpload: h.prepareAndScanUpload }));
vi.mock("@/models/StoredFile", () => ({ default: { create: h.storedCreate } }));

import { POST } from "./route";

function request(opts: { file?: boolean; type?: string } = {}) {
  const form = new FormData();
  if (opts.file !== false) {
    form.append("file", new File([new Uint8Array(PNG)], "cover.png", { type: opts.type ?? "image/png" }));
  }
  return { formData: async () => form } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: PRO };
  h.prepareAndScanUpload.mockResolvedValue({
    ok: true,
    value: { buffer: PNG, fileName: "cover.png", scanStatus: "clean" },
  });
  h.storedCreate.mockResolvedValue({ _id: STORED });
});

describe("POST /api/professional/products/uploads", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    expect(await POST(request())).toBe(refusal);
    expect(h.storedCreate).not.toHaveBeenCalled();
  });

  it("is 400 without a file", async () => {
    const res = await POST(request({ file: false }));
    expect(res.status).toBe(400);
    expect(h.storedCreate).not.toHaveBeenCalled();
  });

  it("refuses SVG and GIF with 415", async () => {
    for (const type of ["image/svg+xml", "image/gif"]) {
      const res = await POST(request({ type }));
      expect(res.status).toBe(415);
    }
    expect(h.prepareAndScanUpload).not.toHaveBeenCalled();
    expect(h.storedCreate).not.toHaveBeenCalled();
  });

  it("checks the content as PNG, JPEG or WebP of 2 MB at most", async () => {
    await POST(request());
    expect(h.prepareAndScanUpload).toHaveBeenCalledWith(expect.any(File), {
      allowedTypes: ["image/png", "image/jpeg", "image/webp"],
      maxSize: 2 * 1024 * 1024,
    });
  });

  it("passes the pipeline's refusal through", async () => {
    h.prepareAndScanUpload.mockResolvedValue({ ok: false, status: 400, error: "Invalid file content" });
    const res = await POST(request());
    expect(res.status).toBe(400);
    expect(h.storedCreate).not.toHaveBeenCalled();
  });

  it("refuses with 503 when the antivirus cannot answer", async () => {
    h.prepareAndScanUpload.mockResolvedValue({
      ok: true,
      value: { buffer: PNG, fileName: "cover.png", scanStatus: "error" },
    });
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "SCAN_UNAVAILABLE" });
    expect(h.storedCreate).not.toHaveBeenCalled();
  });

  it("stores a product image for the gate's professional and answers with its URL", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `/api/files/${STORED}` });
    expect(h.storedCreate).toHaveBeenCalledWith({
      fileName: "cover.png",
      fileType: "image/png",
      fileSize: PNG.length,
      data: PNG,
      kind: "product-image",
      uploadedBy: PRO,
      scanStatus: "clean",
    });
  });
});

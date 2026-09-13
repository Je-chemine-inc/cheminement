import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";
const SLUG = "gerer-son-stress";
const PDF = Buffer.from("%PDF-1.4 guide");

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  prepareAndScanUpload: vi.fn(),
  attachProductFile: vi.fn(),
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/upload-pipeline", () => ({ prepareAndScanUpload: h.prepareAndScanUpload }));
vi.mock("@/lib/products", () => ({ attachProductFile: h.attachProductFile }));

import { POST } from "./route";

function request(opts: { file?: boolean; locale?: string; length?: number } = {}) {
  const form = new FormData();
  if (opts.file !== false) {
    form.append("file", new File([new Uint8Array(PDF)], "guide.pdf", { type: "application/pdf" }));
  }
  if (opts.locale) form.append("locale", opts.locale);
  const formData = vi.fn(async () => form);
  return {
    req: { headers: new Headers({ "content-length": String(opts.length ?? PDF.length + 300) }), formData },
    formData,
  };
}
const post = (r: ReturnType<typeof request>) => POST(r.req as never, { params: Promise.resolve({ slug: SLUG }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { userId: PRO };
  h.prepareAndScanUpload.mockResolvedValue({
    ok: true,
    value: { buffer: PDF, fileName: "guide.pdf", scanStatus: "clean" },
  });
  h.attachProductFile.mockResolvedValue({ ok: true });
});

describe("POST /api/professional/products/[slug]/file", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    h.gate = { error: refusal };
    const r = request();
    expect(await post(r)).toBe(refusal);
    expect(r.formData).not.toHaveBeenCalled();
  });

  it("refuses an oversized body before reading it", async () => {
    const r = request({ length: 12 * 1024 * 1024 });
    const res = await post(r);
    expect(res.status).toBe(413);
    expect(r.formData).not.toHaveBeenCalled();
  });

  it("is 400 without a file", async () => {
    const res = await post(request({ file: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FILE_REQUIRED" });
    expect(h.prepareAndScanUpload).not.toHaveBeenCalled();
  });

  it("accepts only a PDF of 10 MB at most", async () => {
    await post(request());
    expect(h.prepareAndScanUpload).toHaveBeenCalledWith(expect.any(File), {
      allowedTypes: ["application/pdf"],
      maxSize: 10 * 1024 * 1024,
    });
  });

  it("passes the pipeline's refusal through", async () => {
    h.prepareAndScanUpload.mockResolvedValue({ ok: false, status: 400, error: "Invalid file content" });
    const res = await post(request());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid file content" });
    expect(h.attachProductFile).not.toHaveBeenCalled();
  });

  it("refuses with 503 when the antivirus cannot answer", async () => {
    h.prepareAndScanUpload.mockResolvedValue({
      ok: true,
      value: { buffer: PDF, fileName: "guide.pdf", scanStatus: "error" },
    });
    const res = await post(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "SCAN_UNAVAILABLE" });
    expect(h.attachProductFile).not.toHaveBeenCalled();
  });

  it("attaches the file for the gate's professional in the chosen language", async () => {
    const res = await post(request({ locale: "en" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ attached: true, locale: "en" });
    expect(h.attachProductFile).toHaveBeenCalledWith({
      professionalId: PRO,
      slug: SLUG,
      locale: "en",
      file: { buffer: PDF, fileName: "guide.pdf", fileType: "application/pdf", fileSize: PDF.length, scanStatus: "clean" },
    });
  });

  it("defaults to French for any other locale", async () => {
    await post(request({ locale: "de" }));
    expect((h.attachProductFile.mock.calls[0][0] as { locale: string }).locale).toBe("fr");
  });

  it("passes the library's failure through", async () => {
    h.attachProductFile.mockResolvedValue({ ok: false, status: 409, code: "UNDER_REVIEW" });
    const res = await post(request());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "UNDER_REVIEW" });
  });
});

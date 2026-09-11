/**
 * Spec 002 phase 7 — attaching an organization's own claim form to an
 * invoice. Billing admins only; a confirmation that it holds nothing clinical;
 * one real PDF of 5 MB at most; a scanner that cannot answer is a refusal (the
 * file leaves for a third party). Downloads never go through a cache.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const INV = "0123456789abcdef0123456e";

const h = vi.hoisted(() => ({
  gate: { session: { user: { id: "admin1" } } } as Record<string, unknown>,
  scan: { status: "clean" } as { status: string; detail?: string },
  scanned: vi.fn(),
  attach: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
}));

vi.mock("next/server", () => {
  class NextResponse {
    status: number;
    body: unknown;
    headers: Map<string, string>;
    constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Map(Object.entries(init?.headers ?? {}));
    }
    static json(body: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, body, headers: new Map() };
    }
  }
  return { NextResponse };
});
vi.mock("@/lib/organization-admin", () => ({ requireBillingAdmin: async () => h.gate }));
vi.mock("@/lib/virus-scan", () => ({
  scanBufferForViruses: vi.fn(async () => {
    h.scanned();
    return h.scan;
  }),
}));
vi.mock("@/lib/organization-invoice-attachment", () => ({
  attachInvoiceForm: h.attach,
  removeInvoiceForm: h.remove,
  readInvoiceForm: h.read,
}));
vi.mock("@/models/Organization", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => ({ name: "PAE", requiresOwnForm: true }) }) }) },
}));
vi.mock("@/lib/organization-invoice-serialize", () => ({
  serializeInvoice: (inv: Record<string, unknown>) => ({ id: String(inv._id), attachment: inv.attachment ?? null }),
}));

import { DELETE, GET, POST } from "./route";

type Res = { status: number; body: unknown; headers: Map<string, string> };
const ctx = { params: Promise.resolve({ id: INV }) };
const PDF = Buffer.from("%PDF-1.4 formulaire rempli");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function upload(opts: { bytes?: Buffer; type?: string; name?: string; confirm?: boolean; length?: number } = {}) {
  const form = new FormData();
  const bytes = opts.bytes ?? PDF;
  form.append("file", new File([new Uint8Array(bytes)], opts.name ?? "Formulaire Léa.pdf", { type: opts.type ?? "application/pdf" }));
  if (opts.confirm !== false) form.append("confirmNoClinical", "true");
  const formData = vi.fn(async () => form);
  return {
    req: {
      headers: new Map([["content-length", String(opts.length ?? bytes.length + 300)]]),
      formData,
    },
    formData,
  };
}
const post = async (u: ReturnType<typeof upload>) => (await POST(u.req as never, ctx)) as unknown as Res;
const code = (r: Res) => (r.body as { code?: string }).code;

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { session: { user: { id: "admin1" } } };
  h.scan = { status: "clean" };
  h.attach.mockResolvedValue({ ok: true, invoice: { toObject: () => ({ _id: INV, organizationId: "o1", attachment: { fileName: "x.pdf" } }) } });
  h.remove.mockResolvedValue({ ok: true, invoice: { toObject: () => ({ _id: INV, organizationId: "o1" }) } });
});

describe("POST attachment", () => {
  it("attaches a clean PDF, confirmed, for the admin who sent it", async () => {
    const r = await post(upload());
    expect(r.status).toBe(200);
    const args = h.attach.mock.calls[0][0] as { invoiceId: string; bytes: Buffer; scanStatus: string; byUserId: string; originalName: string };
    expect(args).toMatchObject({ invoiceId: INV, scanStatus: "clean", byUserId: "admin1" });
    expect(Buffer.compare(args.bytes, PDF)).toBe(0);
    expect(args.originalName).toMatch(/\.pdf$/);
  });

  it("refuses without the confirmation — nothing scanned, nothing stored", async () => {
    const r = await post(upload({ confirm: false }));
    expect(r.status).toBe(400);
    expect(code(r)).toBe("CONFIRMATION_REQUIRED");
    expect(h.scanned).not.toHaveBeenCalled();
    expect(h.attach).not.toHaveBeenCalled();
  });

  it("refuses an oversized body before reading it", async () => {
    const u = upload({ length: 6 * 1024 * 1024 });
    const r = await post(u);
    expect(r.status).toBe(413);
    expect(code(r)).toBe("FORM_TOO_LARGE");
    expect(u.formData).not.toHaveBeenCalled();
  });

  it("refuses a PDF over 5 MB", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    const r = await post(upload({ bytes: big, length: 1000 }));
    expect(r.status).toBe(413);
    expect(h.attach).not.toHaveBeenCalled();
  });

  it("refuses what is not a PDF — by type, or by its bytes (a PNG renamed .pdf)", async () => {
    expect(code(await post(upload({ type: "image/png", bytes: PNG, name: "scan.png" })))).toBe("FORM_NOT_PDF");
    const disguised = await post(upload({ bytes: PNG, name: "scan.pdf" }));
    expect(disguised.status).toBe(400);
    expect(code(disguised)).toBe("FORM_NOT_PDF");
    expect(h.attach).not.toHaveBeenCalled();
  });

  it("a scanner that cannot answer is a refusal: the file goes to a third party", async () => {
    h.scan = { status: "error", detail: "http_503" };
    const r = await post(upload());
    expect(r.status).toBe(503);
    expect(code(r)).toBe("SCAN_UNAVAILABLE");
    expect(h.attach).not.toHaveBeenCalled();
  });

  it("an infected file is rejected", async () => {
    h.scan = { status: "infected", detail: "Eicar" };
    const r = await post(upload());
    expect(r.status).toBe(422);
    expect(code(r)).toBe("FORM_INFECTED");
  });

  it("no scanner configured: accepted, and recorded as not scanned", async () => {
    h.scan = { status: "skipped" };
    await post(upload());
    expect(h.attach.mock.calls[0][0]).toMatchObject({ scanStatus: "skipped" });
  });

  it("passes the service's refusal on", async () => {
    h.attach.mockResolvedValue({ ok: false, status: 409, code: "NOT_EDITABLE", error: "no" });
    const r = await post(upload());
    expect(r.status).toBe(409);
    expect(code(r)).toBe("NOT_EDITABLE");
  });
});

describe("GET and DELETE attachment", () => {
  it("downloads under the outgoing name, never cached, never rendered", async () => {
    h.read.mockResolvedValue({ bytes: PDF, fileName: "JCO-2026-000007-formulaire.pdf" });
    const r = (await GET({} as never, ctx)) as unknown as Res;
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="JCO-2026-000007-formulaire.pdf"');
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Security-Policy")).toContain("sandbox");
  });

  it("404 when no form is attached", async () => {
    h.read.mockResolvedValue(null);
    expect(((await GET({} as never, ctx)) as unknown as Res).status).toBe(404);
  });

  it("DELETE takes the form off", async () => {
    const r = (await DELETE({} as never, ctx)) as unknown as Res;
    expect(r.status).toBe(200);
    expect(h.remove).toHaveBeenCalledWith({ invoiceId: INV });
  });
});

describe("without billing rights", () => {
  it("every method is refused before anything is read or stored", async () => {
    h.gate = { error: { status: 403, body: { error: "Forbidden" }, headers: new Map() } };
    expect((await post(upload())).status).toBe(403);
    expect(((await GET({} as never, ctx)) as unknown as Res).status).toBe(403);
    expect(((await DELETE({} as never, ctx)) as unknown as Res).status).toBe(403);
    expect(h.attach).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
});

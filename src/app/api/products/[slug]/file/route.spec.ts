/**
 * The PDF a professional sells: only to its buyers, its professional and the
 * team; always a sandboxed attachment, never cached or sniffed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const PRO = "0123456789abcdef01234567";
const BUYER = "0123456789abcdef0123dddd";
const FILE_FR = "0123456789abcdef0123f000";
const FILE_EN = "0123456789abcdef0123e000";
const SLUG = "gerer-son-stress";
const TOKEN = "a".repeat(64);
const PDF = Buffer.from("%PDF-1.4 guide");

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  rateLimit: vi.fn(),
  entryFind: vi.fn(),
  fileFindOne: vi.fn(),
  resolveResourceAccess: vi.fn(),
  rows: [] as Record<string, unknown>[],
  file: null as Record<string, unknown> | null,
}));

vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit, getClientIp: () => "1.2.3.4" }));
vi.mock("@/lib/resource-access", () => ({ resolveResourceAccess: h.resolveResourceAccess }));
vi.mock("@/models/ContentEntry", () => ({ default: { find: h.entryFind } }));
vi.mock("@/models/StoredFile", () => ({ default: { findOne: h.fileFindOne } }));

import { GET } from "./route";

const call = (opts: { slug?: string; query?: string } = {}) => {
  const slug = opts.slug ?? SLUG;
  return GET(new NextRequest(`http://www.jechemine.ca/api/products/${slug}/file${opts.query ?? ""}`), {
    params: Promise.resolve({ slug }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.rateLimit.mockReturnValue({ allowed: true });
  h.getServerSession.mockResolvedValue(null);
  h.rows = [
    { locale: "fr", productFileId: FILE_FR, ownerProfessionalId: PRO },
    { locale: "en", productFileId: FILE_EN, ownerProfessionalId: PRO },
  ];
  h.file = { data: PDF, scanStatus: "clean" };
  h.entryFind.mockImplementation(() => ({ select: () => ({ lean: async () => h.rows }) }));
  h.fileFindOne.mockImplementation(() => ({ lean: async () => h.file }));
  h.resolveResourceAccess.mockResolvedValue({ granted: false, via: null });
});

describe("GET /api/products/[slug]/file", () => {
  it("is 429 once rate limited, before any lookup", async () => {
    h.rateLimit.mockReturnValue({ allowed: false });
    expect((await call()).status).toBe(429);
    expect(h.entryFind).not.toHaveBeenCalled();
  });

  it("is 404 for a malformed slug, without a lookup", async () => {
    for (const slug of ["Gerer", "../etc", "a--b", "-a"]) {
      expect((await call({ slug })).status).toBe(404);
    }
    expect(h.entryFind).not.toHaveBeenCalled();
  });

  it("is 404 when no professional's PDF product has this slug", async () => {
    h.rows = [];
    expect((await call()).status).toBe(404);
    expect(h.entryFind).toHaveBeenCalledWith({
      kind: "resource",
      slug: SLUG,
      productType: "pdf",
      ownerProfessionalId: { $exists: true },
    });
  });

  it("is 403 for someone who did not buy it", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: BUYER } });
    const res = await call();
    expect(res.status).toBe(403);
    expect(h.fileFindOne).not.toHaveBeenCalled();
  });

  it("is 403 for an anonymous visitor without a token", async () => {
    expect((await call()).status).toBe(403);
    expect(h.resolveResourceAccess).toHaveBeenCalledWith(SLUG, { isPremium: true, token: null });
  });

  it("serves the product's professional without asking about a purchase", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.resolveResourceAccess).not.toHaveBeenCalled();
  });

  it("serves an admin without asking about a purchase", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: "admin", isAdmin: true } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.resolveResourceAccess).not.toHaveBeenCalled();
  });

  it("serves a buyer, forwarding the emailed token", async () => {
    h.resolveResourceAccess.mockResolvedValue({ granted: true, via: "token", entitlementId: "e1" });
    const res = await call({ query: `?token=${TOKEN}` });
    expect(res.status).toBe(200);
    expect(h.resolveResourceAccess).toHaveBeenCalledWith(SLUG, { isPremium: true, token: TOKEN });
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("answers as a sandboxed, uncached, unsniffed attachment", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO } });
    const res = await call();
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${SLUG}.pdf"`);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("Content-Length")).toBe(String(PDF.length));
  });

  it("serves the English file when asked, and only a product file", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO } });
    await call({ query: "?locale=en" });
    expect(h.fileFindOne).toHaveBeenCalledWith({ _id: FILE_EN, kind: "product-file" });
  });

  it("falls back to the French file when there is no English one", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO } });
    h.rows = [
      { locale: "fr", productFileId: FILE_FR, ownerProfessionalId: PRO },
      { locale: "en", ownerProfessionalId: PRO },
    ];
    const res = await call({ query: "?locale=en" });
    expect(res.status).toBe(200);
    expect(h.fileFindOne).toHaveBeenCalledWith({ _id: FILE_FR, kind: "product-file" });
  });

  it("is 404 when the product has no file", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO } });
    h.rows = [{ locale: "fr", ownerProfessionalId: PRO }, { locale: "en", ownerProfessionalId: PRO }];
    expect((await call()).status).toBe(404);
    expect(h.fileFindOne).not.toHaveBeenCalled();
  });

  it("is 404 when the stored file is not a product file", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO } });
    h.file = null;
    expect((await call()).status).toBe(404);
  });

  it("never serves an infected file", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO } });
    h.file = { data: PDF, scanStatus: "infected" };
    expect((await call()).status).toBe(404);
  });

  it("serves the bytes of a BSON Binary read with lean()", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO } });
    h.file = { data: { buffer: new Uint8Array(PDF) }, scanStatus: "clean" };
    const res = await call();
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });
});

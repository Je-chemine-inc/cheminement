/**
 * GET /api/files/[id] — the generic file route. Any signed-in user can read
 * any file by id (debt-map P2), so a file that must not be read that way has
 * its own route and is refused here: an organization's claim form carries
 * patient data and goes to billing admins only (spec 002 phase 7).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  file: null as Record<string, unknown> | null,
  session: null as { user: { id: string } } | null,
}));

vi.mock("next/server", () => {
  class NextResponse {
    status: number;
    body: Uint8Array | null;
    headers: Map<string, string>;
    constructor(body: Uint8Array | null, init?: { status?: number; headers?: Record<string, string> }) {
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
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/StoredFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/StoredFile")>()),
  default: { findById: () => ({ lean: async () => h.file }) },
}));

import { GET } from "./route";

type Res = { status: number; body: Uint8Array | null; headers: Map<string, string> };
const get = async () =>
  (await GET({} as never, { params: Promise.resolve({ id: ID }) })) as unknown as Res;

const file = (over: Record<string, unknown> = {}) => ({
  _id: ID,
  fileName: "document.pdf",
  fileType: "application/pdf",
  data: Buffer.from("%PDF-1.4"),
  kind: "patient-document",
  scanStatus: "clean",
  ...over,
});

beforeEach(() => {
  h.file = file();
  h.session = { user: { id: "u1" } };
});

describe("GET /api/files/[id]", () => {
  it("never serves an organization's claim form, even to a signed-in user", async () => {
    h.file = file({ kind: "organization-form" });
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("serves another document to a signed-in user, as a download", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body!).toString()).toBe("%PDF-1.4");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("keeps the BSON Binary normalization: a non-empty body", async () => {
    h.file = file({ data: { buffer: new Uint8Array(Buffer.from("%PDF-binary")) } });
    const res = await get();
    expect(Buffer.from(res.body!).toString()).toBe("%PDF-binary");
  });

  it("asks for a session, except for public content images", async () => {
    h.session = null;
    expect((await get()).status).toBe(401);
    h.file = file({ kind: "content-image", fileType: "image/png", fileName: "a.png" });
    expect((await get()).status).toBe(200);
  });

  it("never serves an infected file", async () => {
    h.file = file({ scanStatus: "infected" });
    expect((await get()).status).toBe(404);
  });
});

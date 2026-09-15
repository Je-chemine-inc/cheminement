/**
 * GET /api/files/[id] — the generic file route. Any signed-in user can read
 * any file by id (debt-map P2), so a file that must not be read that way has
 * its own route and is refused here: an organization's claim form carries
 * patient data and goes to billing admins only (spec 002 phase 7).
 *
 * A showcase photo (spec 003) is public under the same conditions as its page:
 * a published page shows it, the pages are open and the professional's account
 * is active. Otherwise only the page's professional, the uploader and admins
 * see it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  file: null as Record<string, unknown> | null,
  session: null as { user: { id: string; isAdmin?: boolean } } | null,
  published: false,
  enabled: true,
  activePro: true,
  ownsPage: false,
  pageFilters: [] as Record<string, unknown>[],
  ownerFilters: [] as Record<string, unknown>[],
  userFilters: [] as Record<string, unknown>[],
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
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/models/StoredFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/StoredFile")>()),
  default: { findById: () => ({ lean: async () => h.file }) },
}));
vi.mock("@/models/ShowcasePage", () => ({
  default: {
    findOne: (filter: Record<string, unknown>) => {
      h.pageFilters.push(filter);
      return { select: () => ({ lean: async () => (h.published ? { _id: "page", userId: "pro1" } : null) }) };
    },
    exists: async (filter: Record<string, unknown>) => {
      h.ownerFilters.push(filter);
      return h.ownsPage ? { _id: "page" } : null;
    },
  },
}));
vi.mock("@/models/User", () => ({
  default: {
    exists: async (filter: Record<string, unknown>) => {
      h.userFilters.push(filter);
      return h.activePro ? { _id: "pro1" } : null;
    },
  },
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

const photo = (over: Record<string, unknown> = {}) =>
  file({ kind: "showcase-photo", fileType: "image/jpeg", fileName: "portrait.jpg", uploadedBy: "pro1", ...over });

beforeEach(() => {
  h.file = file();
  h.session = { user: { id: "u1" } };
  h.published = false;
  h.enabled = true;
  h.activePro = true;
  h.ownsPage = false;
  h.pageFilters = [];
  h.ownerFilters = [];
  h.userFilters = [];
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
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400, immutable");
  });

  it("never serves an infected file", async () => {
    h.file = file({ scanStatus: "infected" });
    expect((await get()).status).toBe(404);
  });

  it("serves a live page's photo to anyone, inline, cached for an hour only", async () => {
    h.file = photo();
    h.published = true;
    h.session = null;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    // A portrait or an office photo of that page.
    expect(h.pageFilters[0]).toEqual({
      status: "published",
      $or: [{ "published.photoFileId": ID }, { "published.officePhotoFileIds": ID }],
    });
    expect(h.userFilters[0]).toEqual({ _id: "pro1", role: "professional", status: "active" });
  });

  it("keeps a published page's photo private while the pages are closed", async () => {
    h.file = photo();
    h.published = true;
    h.enabled = false;
    h.session = null;
    expect((await get()).status).toBe(401);
    h.session = { user: { id: "client1" } };
    expect((await get()).status).toBe(404);
  });

  it("keeps the photo private once the professional's account is no longer active", async () => {
    h.file = photo();
    h.published = true;
    h.activePro = false;
    h.session = null;
    expect((await get()).status).toBe(401);
  });

  it("keeps a photo that no published page shows away from the public and other users", async () => {
    h.file = photo();
    h.session = null;
    expect((await get()).status).toBe(401);
    h.session = { user: { id: "client1" } };
    expect((await get()).status).toBe(404);
  });

  it("lets the uploader, the page's professional and admins see a photo that is not public", async () => {
    h.file = photo({ uploadedBy: "admin9" });
    h.session = { user: { id: "admin9" } };
    expect((await get()).status).toBe(200);
    h.session = { user: { id: "someAdmin", isAdmin: true } };
    expect((await get()).status).toBe(200);
    h.session = { user: { id: "pro1" } };
    h.ownsPage = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(h.ownerFilters.at(-1)).toEqual({
      userId: "pro1",
      $or: [
        { "draft.photoFileId": ID },
        { "published.photoFileId": ID },
        { "draft.officePhotoFileIds": ID },
        { "published.officePhotoFileIds": ID },
      ],
    });
  });
});

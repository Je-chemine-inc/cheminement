/**
 * A professional's product (spec 003 phase 5) is never edited or deleted from
 * the team's content editor: they review it in « Produits » instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_USER = "dddddddddddddddddddddddd";
const PRO = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  adminFindOne: vi.fn(),
  entryFind: vi.fn(),
  entryExists: vi.fn(),
  entryDeleteMany: vi.fn(),
  entitlementCount: vi.fn(),
  getContentPair: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/Admin", () => ({ default: { findOne: h.adminFindOne } }));
vi.mock("@/models/ContentEntry", () => ({
  default: { find: h.entryFind, exists: h.entryExists, deleteMany: h.entryDeleteMany },
  CONTENT_KIND_PUBLIC_BASE: {
    problematique: "/explore",
    traitement: "/approaches",
    nouveaute: "/nouveautes",
    media: "/medias",
    resource: "/book",
  },
}));
vi.mock("@/models/ResourceEntitlement", () => ({ default: { countDocuments: h.entitlementCount } }));
vi.mock("@/lib/content-entry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/content-kind")>("@/lib/content-kind");
  return { isContentKind: actual.isContentKind, getContentPair: h.getContentPair };
});

import { DELETE, PUT } from "./route";

type Doc = Record<string, unknown> & { locale: string; save: ReturnType<typeof vi.fn> };

const makeDoc = (locale: string, over: Record<string, unknown> = {}): Doc => ({
  locale,
  title: locale === "fr" ? "Gérer son stress" : "Managing stress",
  status: "published",
  isPremium: true,
  priceCents: 4900,
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

let frDoc: Doc;
let enDoc: Doc;

const req = (body: unknown) => ({ json: async () => body }) as never;
const ctx = (kind = "resource", slug = "gerer-son-stress") => ({ params: Promise.resolve({ kind, slug }) }) as never;
const errorOf = (res: { body: unknown }) => (res.body as { error: string }).error;

beforeEach(() => {
  vi.clearAllMocks();
  h.getServerSession.mockResolvedValue({ user: { id: ADMIN_USER, isAdmin: true } });
  h.adminFindOne.mockResolvedValue({ permissions: { manageContent: true } });
  frDoc = makeDoc("fr", { ownerProfessionalId: PRO });
  enDoc = makeDoc("en", { ownerProfessionalId: PRO });
  h.entryFind.mockResolvedValue([frDoc, enDoc]);
  h.entryExists.mockResolvedValue({ _id: "row" });
  h.entryDeleteMany.mockResolvedValue({ deletedCount: 2 });
  h.entitlementCount.mockResolvedValue(0);
  h.getContentPair.mockResolvedValue({ fr: {}, en: {} });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a professional's product in the team's content editor", () => {
  it("refuses an edit with PRO_OWNED and saves nothing", async () => {
    const res = await PUT(req({ titleFr: "Réécrit", status: "published", priceCents: 1 }), ctx());

    expect(res.status).toBe(409);
    expect(errorOf(res)).toBe("PRO_OWNED");
    expect(frDoc.save).not.toHaveBeenCalled();
    expect(enDoc.save).not.toHaveBeenCalled();
    expect(frDoc.title).toBe("Gérer son stress");
  });

  it("refuses an edit when only one row carries the owner", async () => {
    h.entryFind.mockResolvedValue([makeDoc("fr"), enDoc]);
    const res = await PUT(req({ titleFr: "Réécrit" }), ctx());
    expect(res.status).toBe(409);
    expect(enDoc.save).not.toHaveBeenCalled();
  });

  it("refuses a delete with PRO_OWNED and deletes nothing", async () => {
    const res = await DELETE(req({}), ctx());

    expect(res.status).toBe(409);
    expect(errorOf(res)).toBe("PRO_OWNED");
    expect(h.entryExists).toHaveBeenCalledWith({
      kind: "resource",
      slug: "gerer-son-stress",
      ownerProfessionalId: { $exists: true },
    });
    expect(h.entryDeleteMany).not.toHaveBeenCalled();
  });

  it("still edits and deletes the team's own resources", async () => {
    h.entryFind.mockResolvedValue([makeDoc("fr"), makeDoc("en")]);
    h.entryExists.mockResolvedValue(null);

    expect((await PUT(req({ titleFr: "Nouveau" }), ctx())).status).toBe(200);
    expect((await DELETE(req({}), ctx())).status).toBe(200);
    expect(h.entryDeleteMany).toHaveBeenCalled();
  });
});

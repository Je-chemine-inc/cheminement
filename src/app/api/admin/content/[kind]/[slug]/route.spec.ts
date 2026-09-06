/**
 * Admin CMS writes for premium resources.
 *
 * Three things are being pinned here:
 *   1. the permission gate (manageContent), which the route hand-rolls;
 *   2. price validation at the trust boundary — a float or a string price must
 *      never reach the database, because everything downstream compares cents;
 *   3. that content people have PAID for cannot be deleted, and cannot be
 *      silently repriced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_USER = "dddddddddddddddddddddddd";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  adminFindOne: vi.fn(),
  entryFind: vi.fn(),
  entryDeleteMany: vi.fn(),
  entitlementCount: vi.fn(),
  getContentPair: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/Admin", () => ({ default: { findOne: h.adminFindOne } }));
vi.mock("@/models/ContentEntry", () => ({
  default: { find: h.entryFind, deleteMany: h.entryDeleteMany },
  CONTENT_KIND_PUBLIC_BASE: {
    problematique: "/explore",
    traitement: "/approaches",
    nouveaute: "/nouveautes",
    media: "/medias",
    resource: "/book",
  },
}));
vi.mock("@/models/ResourceEntitlement", () => ({
  default: { countDocuments: h.entitlementCount },
}));
vi.mock("@/lib/content-entry", async () => {
  // isContentKind is a pure re-export; use the real one rather than a stub that
  // could quietly diverge from the enum.
  const actual = await vi.importActual<typeof import("@/lib/content-kind")>(
    "@/lib/content-kind",
  );
  return { isContentKind: actual.isContentKind, getContentPair: h.getContentPair };
});

import { DELETE, PUT } from "./route";

type Doc = Record<string, unknown> & { locale: string; save: () => Promise<void> };

const makeDoc = (locale: string, over: Record<string, unknown> = {}): Doc => ({
  locale,
  title: locale === "fr" ? "Gérer son stress" : "Managing stress",
  summary: "",
  contentHtml: "",
  previewHtml: "",
  status: "published",
  isPremium: false,
  priceCents: 0,
  sortOrder: 100,
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

let frDoc: Doc;
let enDoc: Doc;

const req = (body: unknown) => ({ json: async () => body }) as never;
const ctx = (kind = "resource", slug = "gerer-son-stress") =>
  ({ params: Promise.resolve({ kind, slug }) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.getServerSession.mockResolvedValue({ user: { id: ADMIN_USER, isAdmin: true } });
  h.adminFindOne.mockResolvedValue({ permissions: { manageContent: true } });
  frDoc = makeDoc("fr");
  enDoc = makeDoc("en");
  h.entryFind.mockResolvedValue([frDoc, enDoc]);
  h.entryDeleteMany.mockResolvedValue({ deletedCount: 2 });
  h.entitlementCount.mockResolvedValue(0);
  h.getContentPair.mockResolvedValue({ fr: {}, en: {} });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("permissions", () => {
  it("rejects an anonymous caller", async () => {
    h.getServerSession.mockResolvedValue(null);

    expect((await PUT(req({}), ctx())).status).toBe(401);
    expect((await DELETE(req({}), ctx())).status).toBe(401);
    expect(h.entryDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects an admin without manageContent", async () => {
    h.adminFindOne.mockResolvedValue({ permissions: { manageBilling: true } });

    expect((await PUT(req({}), ctx())).status).toBe(403);
    expect((await DELETE(req({}), ctx())).status).toBe(403);
    expect(h.entryDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects a signed-in non-admin", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: "u1", isAdmin: false } });
    expect((await PUT(req({}), ctx())).status).toBe(401);
  });
});

describe("price validation", () => {
  it("refuses a fractional price", async () => {
    const res = await PUT(req({ isPremium: true, priceCents: 1900.5 }), ctx());

    expect(res.status).toBe(400);
    expect(frDoc.save).not.toHaveBeenCalled();
  });

  it("refuses a price sent as a string", async () => {
    const res = await PUT(req({ isPremium: true, priceCents: "1900" }), ctx());
    expect(res.status).toBe(400);
  });

  it("refuses zero and negative prices on a premium entry", async () => {
    expect((await PUT(req({ isPremium: true, priceCents: 0 }), ctx())).status).toBe(400);
    expect((await PUT(req({ isPremium: true, priceCents: -100 }), ctx())).status).toBe(400);
  });

  it("refuses a premium flag on a kind that is not for sale", async () => {
    const res = await PUT(
      req({ isPremium: true, priceCents: 1900 }),
      ctx("nouveaute", "une-nouvelle"),
    );

    expect(res.status).toBe(400);
    expect(frDoc.save).not.toHaveBeenCalled();
  });

  it("accepts a whole number of cents", async () => {
    const res = await PUT(req({ isPremium: true, priceCents: 1900 }), ctx());

    expect(res.status).toBe(200);
    expect(frDoc.save).toHaveBeenCalled();
  });
});

describe("premium fields are mirrored across locales", () => {
  it("writes isPremium and priceCents to both rows", async () => {
    // An FR-paid / EN-free entry would be a paywall bypass via ?locale=en.
    await PUT(req({ isPremium: true, priceCents: 4500 }), ctx());

    expect(frDoc.isPremium).toBe(true);
    expect(enDoc.isPremium).toBe(true);
    expect(frDoc.priceCents).toBe(4500);
    expect(enDoc.priceCents).toBe(4500);
  });

  it("zeroes the price when a resource is made free again", async () => {
    frDoc.isPremium = true;
    enDoc.isPremium = true;
    frDoc.priceCents = 4500;
    enDoc.priceCents = 4500;

    await PUT(req({ isPremium: false }), ctx());

    expect(frDoc.isPremium).toBe(false);
    expect(frDoc.priceCents).toBe(0);
    expect(enDoc.priceCents).toBe(0);
  });
});

describe("per-locale resource fields", () => {
  it("keeps a different preview and media URL per language", async () => {
    await PUT(
      req({
        previewHtmlFr: "<p>Extrait</p>",
        previewHtmlEn: "<p>Preview</p>",
        mediaUrlFr: "https://youtu.be/francais",
        mediaUrlEn: "https://youtu.be/english",
      }),
      ctx(),
    );

    expect(frDoc.previewHtml).toBe("<p>Extrait</p>");
    expect(enDoc.previewHtml).toBe("<p>Preview</p>");
    expect(frDoc.mediaUrl).toBe("https://youtu.be/francais");
    expect(enDoc.mediaUrl).toBe("https://youtu.be/english");
  });

  it("clears a media URL when emptied", async () => {
    frDoc.mediaUrl = "https://youtu.be/old";
    await PUT(req({ mediaUrlFr: "  " }), ctx());
    expect(frDoc.mediaUrl).toBeUndefined();
  });

  it("mirrors mediaType, which is not language-specific", async () => {
    await PUT(req({ mediaType: "video" }), ctx());
    expect(frDoc.mediaType).toBe("video");
    expect(enDoc.mediaType).toBe("video");
  });

  it("leaves the media kind's mirrored behaviour alone", async () => {
    await PUT(req({ mediaUrl: "https://youtu.be/shared" }), ctx("media", "un-media"));
    expect(frDoc.mediaUrl).toBe("https://youtu.be/shared");
    expect(enDoc.mediaUrl).toBe("https://youtu.be/shared");
  });
});

describe("repricing something people already bought", () => {
  it("refuses without an explicit confirmation", async () => {
    h.entitlementCount.mockResolvedValue(3);

    const res = await PUT(req({ isPremium: true, priceCents: 9900 }), ctx());

    expect(res.status).toBe(409);
    expect((res.body as unknown as { error: string }).error).toBe("RESOURCE_HAS_PURCHASES");
    expect((res.body as unknown as { paid: number }).paid).toBe(3);
    expect(frDoc.save).not.toHaveBeenCalled();
  });

  it("goes through once confirmed", async () => {
    h.entitlementCount.mockResolvedValue(3);

    const res = await PUT(
      req({ isPremium: true, priceCents: 9900, confirmPriceChange: true }),
      ctx(),
    );

    expect(res.status).toBe(200);
    expect(frDoc.priceCents).toBe(9900);
  });

  it("does not nag when the price is unchanged", async () => {
    frDoc.isPremium = true;
    enDoc.isPremium = true;
    frDoc.priceCents = 1900;
    enDoc.priceCents = 1900;
    h.entitlementCount.mockResolvedValue(3);

    const res = await PUT(req({ isPremium: true, priceCents: 1900 }), ctx());

    expect(res.status).toBe(200);
  });

  it("does not nag when nobody has bought it yet", async () => {
    h.entitlementCount.mockResolvedValue(0);
    const res = await PUT(req({ isPremium: true, priceCents: 9900 }), ctx());
    expect(res.status).toBe(200);
  });
});

describe("deleting a resource", () => {
  it("refuses while anyone holds a paid entitlement", async () => {
    // Deleting content someone paid to read strands their purchase.
    h.entitlementCount.mockResolvedValue(1);

    const res = await DELETE(req({}), ctx());

    expect(res.status).toBe(409);
    expect((res.body as unknown as { error: string }).error).toBe("RESOURCE_HAS_PURCHASES");
    expect(h.entryDeleteMany).not.toHaveBeenCalled();
  });

  it("proceeds when only unpaid rows exist", async () => {
    // countDocuments is filtered to status "paid", so pending/failed/refunded
    // rows do not block a delete.
    h.entitlementCount.mockResolvedValue(0);

    const res = await DELETE(req({}), ctx());

    expect(res.status).toBe(200);
    expect(h.entryDeleteMany).toHaveBeenCalledWith({
      kind: "resource",
      slug: "gerer-son-stress",
    });
  });

  it("counts only paid entitlements for this slug", async () => {
    await DELETE(req({}), ctx());
    expect(h.entitlementCount).toHaveBeenCalledWith({
      slug: "gerer-son-stress",
      status: "paid",
    });
  });

  it("does not run the purchase check for editorial kinds", async () => {
    await DELETE(req({}), ctx("nouveaute", "une-nouvelle"));
    expect(h.entitlementCount).not.toHaveBeenCalled();
    expect(h.entryDeleteMany).toHaveBeenCalled();
  });
});

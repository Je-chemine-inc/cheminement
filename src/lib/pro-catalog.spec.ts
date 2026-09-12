import { describe, it, expect, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-rbac", () => ({ getActiveAdminPermissions: async () => null }));

import { catalogSlug, serializeCatalogItem } from "@/lib/pro-catalog";

describe("catalogSlug", () => {
  it("makes a URL segment from the French label", () => {
    expect(catalogSlug(undefined, "Anxiété et stress")).toBe("anxiete-et-stress");
    expect(catalogSlug("", "Trouble déficitaire de l'attention (TDAH)")).toBe("trouble-deficitaire-de-lattention-tdah");
  });

  it("takes the one asked for when it is valid", () => {
    expect(catalogSlug("TDAH", "Trouble déficitaire")).toBe("tdah");
    expect(catalogSlug("burn-out", "Épuisement")).toBe("burn-out");
  });

  it("refuses what cannot be a segment", () => {
    expect(catalogSlug("deux mots", "x")).toBeNull();
    expect(catalogSlug("a", "x")).toBeNull();
    expect(catalogSlug(undefined, "!!!")).toBeNull();
    expect(catalogSlug("x".repeat(61), "y")).toBeNull();
  });
});

describe("serializeCatalogItem", () => {
  it("exposes whether an expertise is offered on showcase pages, and its segment", () => {
    const base = {
      _id: "id1",
      category: "expertise" as const,
      labelFr: "Anxiété",
      labelEn: "Anxiety",
      aliases: [],
      active: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    expect(serializeCatalogItem({ ...base, showcase: true, slug: "anxiete" })).toMatchObject({
      showcase: true,
      slug: "anxiete",
    });
    expect(serializeCatalogItem(base)).toMatchObject({ showcase: false, slug: "" });
  });
});

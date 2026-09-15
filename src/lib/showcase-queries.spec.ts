/**
 * Spec 003 — the reads behind public showcase pages: published pages of
 * active professionals only, former slugs redirected, and only public profile
 * fields loaded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const chain = (value: () => unknown, onSelect?: (fields: string) => void) => {
    const query = {
      select: (fields: string) => {
        onSelect?.(fields);
        return query;
      },
      sort: () => query,
      lean: async () => value(),
    };
    return query;
  };
  return {
    chain,
    page: null as Record<string, unknown> | null,
    moved: null as Record<string, unknown> | null,
    pages: [] as Record<string, unknown>[],
    user: null as Record<string, unknown> | null,
    users: [] as Record<string, unknown>[],
    profile: null as Record<string, unknown> | null,
    catalog: [] as Record<string, unknown>[],
    pageFilters: [] as Record<string, unknown>[],
    userFilters: [] as Record<string, unknown>[],
    catalogFilters: [] as Record<string, unknown>[],
    profileSelects: [] as string[],
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: async (_id: string, type: string, options?: { quick?: boolean }) => ({
    sessionPrice: options?.quick ? 70 : { solo: 130, couple: 160, group: 90 }[type],
  }),
}));
vi.mock("@/models/ShowcasePage", () => ({
  default: {
    findOne: (filter: Record<string, unknown>) => {
      h.pageFilters.push(filter);
      return h.chain(() => ("previousSlugs" in filter ? h.moved : h.page));
    },
    find: (filter: Record<string, unknown>) => {
      h.pageFilters.push(filter);
      return h.chain(() => h.pages);
    },
  },
}));
vi.mock("@/models/User", () => ({
  default: {
    findOne: (filter: Record<string, unknown>) => {
      h.userFilters.push(filter);
      return h.chain(() => h.user);
    },
    find: (filter: Record<string, unknown>) => {
      h.userFilters.push(filter);
      return h.chain(() => h.users);
    },
  },
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: () => h.chain(() => h.profile, (fields) => h.profileSelects.push(fields)),
    find: () => h.chain(() => (h.profile ? [h.profile] : []), (fields) => h.profileSelects.push(fields)),
  },
}));
vi.mock("@/models/ProCatalogItem", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.catalogFilters.push(filter);
      return h.chain(() => h.catalog);
    },
  },
}));

import {
  SHOWCASE_PROFILE_SELECT,
  buildShowcasePreview,
  findPublishedShowcase,
  loadShowcaseDirectory,
} from "@/lib/showcase-queries";

const PRO = "0123456789abcdef01234567";
const ZOE = "0123456789abcdef0123zzzz";
const ANXIETY = "0123456789abcdef0123aaaa";
const content = { displayName: "Amel Sassi", headline: { fr: "Psychologue" }, expertiseIds: [] };

beforeEach(() => {
  h.page = { _id: "p1", userId: PRO, slug: "sassi", cityKey: "mascouche", services: {}, published: content };
  h.moved = null;
  h.pages = [];
  h.user = { _id: PRO, firstName: "Amel", lastName: "Sassi" };
  h.users = [];
  h.profile = { userId: PRO, specialty: "psychologist", sessionTypes: ["Individual"] };
  h.catalog = [];
  h.pageFilters = [];
  h.userFilters = [];
  h.catalogFilters = [];
  h.profileSelects = [];
});

describe("findPublishedShowcase", () => {
  it("finds a published page of an active professional", async () => {
    const found = await findPublishedShowcase("sassi", "fr");
    expect(found).toMatchObject({ kind: "found", profile: { slug: "sassi", displayName: "Amel Sassi" } });
    expect(h.pageFilters[0]).toEqual({ slug: "sassi", status: "published" });
    expect(h.userFilters[0]).toEqual({ _id: PRO, role: "professional", status: "active" });
    expect(found.kind === "found" && found.profile.services.standard.prices).toEqual([{ therapyType: "solo", price: 130 }]);
  });

  it("is missing when the professional is no longer active", async () => {
    h.user = null;
    expect(await findPublishedShowcase("sassi", "fr")).toEqual({ kind: "missing" });
  });

  it("sends a former slug to the current page", async () => {
    h.page = null;
    h.moved = { slug: "amel-sassi" };
    expect(await findPublishedShowcase("sassi", "fr")).toEqual({ kind: "moved", slug: "amel-sassi" });
    expect(h.pageFilters[1]).toEqual({ previousSlugs: "sassi", status: "published" });
  });

  it("does not even query a malformed slug", async () => {
    expect(await findPublishedShowcase("../etc", "fr")).toEqual({ kind: "missing" });
    expect(h.pageFilters).toEqual([]);
  });

  it("loads only the public profile fields", async () => {
    await findPublishedShowcase("sassi", "fr");
    expect(h.profileSelects).toEqual([SHOWCASE_PROFILE_SELECT]);
    for (const secret of ["rates", "pricing", "payout", "calendarFeedToken", "bio", "officeAddress.street", "officeNotes", "problematics"]) {
      expect(SHOWCASE_PROFILE_SELECT.split(" ")).not.toContain(secret);
    }
  });
});

describe("loadShowcaseDirectory", () => {
  it("lists published pages of active professionals in registry cities, reduced to what the sitemap needs", async () => {
    const updatedAt = new Date("2026-09-10");
    h.pages = [
      { userId: PRO, cityKey: "mascouche", slug: "amel-sassi", updatedAt },
      { userId: "0123456789abcdef0123gone", cityKey: "mascouche", slug: "gone", updatedAt },
      { userId: ZOE, cityKey: "atlantis", slug: "zoe", updatedAt },
    ];
    h.users = [{ _id: PRO }, { _id: ZOE }];
    expect(await loadShowcaseDirectory()).toEqual([{ slug: "amel-sassi", lastModified: updatedAt }]);
    expect(h.pageFilters[0]).toEqual({ status: "published" });
    expect(h.userFilters[0]).toMatchObject({ role: "professional", status: "active" });
  });

  it("does not look up users when nothing is published", async () => {
    expect(await loadShowcaseDirectory()).toEqual([]);
    expect(h.userFilters).toEqual([]);
  });
});

describe("buildShowcasePreview", () => {
  it("builds from the draft, whatever the page's state or the account's", async () => {
    h.page = { userId: PRO, slug: "sassi", cityKey: "mascouche", status: "invited", draft: { displayName: "Brouillon" } };
    expect((await buildShowcasePreview(PRO, "draft", "fr"))?.displayName).toBe("Brouillon");
    expect(h.pageFilters[0]).toEqual({ userId: PRO });
    expect(h.userFilters[0]).toEqual({ _id: PRO, role: "professional" });
    expect(await buildShowcasePreview(PRO, "published", "fr")).toBeNull();
    expect(await buildShowcasePreview("nope", "draft", "fr")).toBeNull();
  });
});

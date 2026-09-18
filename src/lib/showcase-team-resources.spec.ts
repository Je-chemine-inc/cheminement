import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  page: null as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
  filters: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/ShowcasePage", () => ({
  default: { findOne: () => ({ select: () => ({ lean: async () => h.page }) }) },
}));
vi.mock("@/models/ContentEntry", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.filters.push(filter);
      // Like the database: only the rows the filter's slugs and locale name.
      const slugs = (filter.slug as { $in?: string[] } | undefined)?.$in;
      const rows = h.rows.filter((row) => (!slugs || slugs.includes(row.slug as string)) && row.locale === filter.locale);
      return { select: () => ({ lean: async () => rows }) };
    },
  },
}));

import {
  findTeamResources,
  listShowcaseTeamResources,
  listTeamResourceOptions,
  pageImageUrl,
  resolveTeamResources,
  teamResourceCardType,
} from "@/lib/showcase-team-resources";

const FILE = "/api/files/0123456789abcdef01234567";
const row = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  locale: "fr",
  title: `Titre ${slug}`,
  summary: `Résumé ${slug}`,
  priceCents: 0,
  mediaType: "article",
  ...over,
});

beforeEach(() => {
  h.page = { teamResourceSlugs: ["respirer", "dormir"] };
  h.rows = [];
  h.filters = [];
});

describe("what a team resource card is", () => {
  it("names videos, podcasts and readings the way the page's cards do", () => {
    expect(teamResourceCardType("video")).toBe("video");
    expect(teamResourceCardType("podcast")).toBe("audio");
    expect(teamResourceCardType("article")).toBe("article");
    expect(teamResourceCardType(undefined)).toBe("article");
  });

  it("keeps only an image the page can draw: a stored file or an allowed https host", () => {
    expect(pageImageUrl(FILE)).toBe(FILE);
    expect(pageImageUrl("https://images.unsplash.com/photo-1?w=800")).toBe("https://images.unsplash.com/photo-1?w=800");
    expect(pageImageUrl("http://images.unsplash.com/photo-1")).toBeNull();
    expect(pageImageUrl("https://example.com/a.jpg")).toBeNull();
    expect(pageImageUrl("/api/files/../../etc/passwd")).toBeNull();
    expect(pageImageUrl("not a url")).toBeNull();
    expect(pageImageUrl(undefined)).toBeNull();
  });
});

describe("listShowcaseTeamResources: what the page shows", () => {
  it("shows the team's resources in the admin's order, in the visitor's language, as Je chemine's", async () => {
    h.rows = [
      row("dormir", { locale: "en", title: "Sleep better", mediaType: "video", priceCents: 1500, iconUrl: "https://example.com/x.jpg" }),
      row("respirer", { locale: "en", title: "Breathe", mediaType: "podcast", iconUrl: FILE }),
    ];
    const cards = await listShowcaseTeamResources("psychologue-helene-belzil", "en");
    expect(cards.map((card) => card.slug)).toEqual(["respirer", "dormir"]);
    expect(cards[0]).toEqual({
      slug: "respirer",
      type: "audio",
      title: "Breathe",
      summary: "Résumé respirer",
      iconUrl: FILE,
      priceCents: 0,
      webinarStartsAt: null,
      url: "https://www.jechemine.ca/book/respirer",
      source: "jechemine",
    });
    expect(cards[1]).toMatchObject({ type: "video", priceCents: 1500, iconUrl: null });
  });

  it("reads only published resources with no owner: never a professional's product", async () => {
    await listShowcaseTeamResources("psychologue-helene-belzil", "fr");
    expect(h.filters[0]).toMatchObject({ kind: "resource", status: "published", ownerProfessionalId: null, locale: "fr" });
  });

  it("drops what the team unpublished or deleted meanwhile, and reads nothing for a page without any", async () => {
    h.rows = [row("dormir")];
    expect((await listShowcaseTeamResources("psychologue-helene-belzil", "fr")).map((card) => card.slug)).toEqual(["dormir"]);
    h.filters = [];
    h.page = { teamResourceSlugs: [] };
    expect(await listShowcaseTeamResources("psychologue-helene-belzil", "fr")).toEqual([]);
    h.page = null;
    expect(await listShowcaseTeamResources("gone", "fr")).toEqual([]);
    expect(h.filters).toEqual([]);
  });
});

describe("the editors' lists", () => {
  it("flags a chosen resource the team withdrew, keeping the admin's order", async () => {
    h.rows = [row("dormir", { priceCents: 1500 })];
    expect(await resolveTeamResources(["respirer", "dormir", 42])).toEqual([
      { slug: "respirer", title: "respirer", priceCents: 0, available: false },
      { slug: "dormir", title: "Titre dormir", priceCents: 1500, available: true },
    ]);
  });

  it("finds the team's resources by their French row", async () => {
    h.rows = [row("dormir")];
    const found = await findTeamResources(["dormir", "inconnue"]);
    expect([...found.keys()]).toEqual(["dormir"]);
    expect(h.filters[0]).toMatchObject({ locale: "fr", ownerProfessionalId: null, status: "published", kind: "resource" });
    expect(await findTeamResources([])).toEqual(new Map());
  });

  it("offers every published team resource, by title", async () => {
    h.rows = [row("b", { title: "Émotions" }), row("a", { title: "Anxiété", priceCents: 900, mediaType: "video" })];
    expect(await listTeamResourceOptions()).toEqual([
      { slug: "a", title: "Anxiété", priceCents: 900, mediaType: "video" },
      { slug: "b", title: "Émotions", priceCents: 0, mediaType: "article" },
    ]);
  });
});

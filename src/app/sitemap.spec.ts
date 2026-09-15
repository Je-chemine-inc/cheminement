import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  failDirectory: false,
  directory: [] as { slug: string; lastModified: Date | null }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/content-entry", () => ({ listPublishedContent: async () => [] }));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/showcase-queries", () => ({
  loadShowcaseDirectory: async () => {
    if (h.failDirectory) throw new Error("database down");
    return h.directory;
  },
}));

import sitemap from "./sitemap";

const PAGES = ["https://www.jechemine.ca/amel-sassi", "https://www.jechemine.ca/julie-cote"];
const urls = async () => (await sitemap()).map((entry) => entry.url);

beforeEach(() => {
  h.enabled = true;
  h.failDirectory = false;
  h.directory = [
    { slug: "amel-sassi", lastModified: new Date("2026-09-10") },
    { slug: "julie-cote", lastModified: null },
  ];
});

describe("www sitemap (spec 003 professional pages)", () => {
  it("lists each professional's page on www", async () => {
    const entries = await sitemap();
    const listed = entries.map((entry) => entry.url);
    expect(listed).toContain("https://www.jechemine.ca/");
    expect(listed.filter((url) => PAGES.includes(url))).toEqual(PAGES);
    expect(entries.find((entry) => entry.url === PAGES[0])?.lastModified).toEqual(new Date("2026-09-10"));
  });

  it("lists no professional's page while the pages are off", async () => {
    h.enabled = false;
    expect((await urls()).some((url) => PAGES.includes(url))).toBe(false);
  });

  it("still lists the rest of the site when the pages cannot be read", async () => {
    h.failDirectory = true;
    const listed = await urls();
    expect(listed).toContain("https://www.jechemine.ca/");
    expect(listed.some((url) => PAGES.includes(url))).toBe(false);
  });
});

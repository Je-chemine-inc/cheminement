import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  failDirectory: false,
  directory: [] as { cityKey: string; slug: string; expertiseIds: string[]; lastModified: Date | null }[],
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

const urls = async () => (await sitemap()).map((entry) => entry.url);

beforeEach(() => {
  h.enabled = true;
  h.failDirectory = false;
  h.directory = [
    { cityKey: "mascouche", slug: "sassi", expertiseIds: [], lastModified: null },
    { cityKey: "laval", slug: "roy", expertiseIds: [], lastModified: null },
  ];
});

describe("www sitemap (spec 003 directory)", () => {
  it("lists /psy and the regions where professionals are presented", async () => {
    const listed = await urls();
    expect(listed).toContain("https://www.jechemine.ca/");
    expect(listed.filter((url) => url.includes("/psy"))).toEqual([
      "https://www.jechemine.ca/psy",
      "https://www.jechemine.ca/psy/laval",
      "https://www.jechemine.ca/psy/lanaudiere",
    ]);
  });

  it("lists no directory page while the pages are off, or while nobody is presented", async () => {
    h.enabled = false;
    expect((await urls()).some((url) => url.includes("/psy"))).toBe(false);
    h.enabled = true;
    h.directory = [];
    expect((await urls()).some((url) => url.includes("/psy"))).toBe(false);
  });

  it("still lists the rest of the site when the directory cannot be read", async () => {
    h.failDirectory = true;
    const listed = await urls();
    expect(listed).toContain("https://www.jechemine.ca/");
    expect(listed.some((url) => url.includes("/psy"))).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  pages: [] as { slug: string; lastModified: Date | null }[],
  listed: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/showcase-queries", () => ({
  listShowcaseSitemapPages: async (cityKey: string) => {
    h.listed(cityKey);
    return h.pages;
  },
}));

import { GET } from "./route";

const call = (cityKey: string) => GET({} as never, { params: Promise.resolve({ cityKey }) });
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

beforeEach(() => {
  h.enabled = true;
  h.pages = [];
  h.listed.mockReset();
});

describe("GET /sitemap.xml on a city host", () => {
  it("is a 404 for a city that is not in the registry", async () => {
    expect((await call("atlantis")).status).toBe(404);
  });

  it("lists nothing while the pages are off, without even looking", async () => {
    h.pages = [{ slug: "sassi", lastModified: null }];
    h.enabled = false;
    const res = await call("mascouche");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(locs(await res.text())).toEqual([]);
    expect(h.listed).not.toHaveBeenCalled();
  });

  it("lists nothing for a city where no professional is presented", async () => {
    const xml = await (await call("mascouche")).text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(locs(xml)).toEqual([]);
  });

  it("lists the city page and each published professional, on its own host only", async () => {
    h.pages = [
      { slug: "sassi", lastModified: new Date("2026-09-10T10:00:00Z") },
      { slug: "tremblay", lastModified: new Date("2026-09-11T10:00:00Z") },
    ];
    const xml = await (await call("mascouche")).text();
    expect(locs(xml)).toEqual([
      "https://psymascouche.jechemine.ca/",
      "https://psymascouche.jechemine.ca/sassi",
      "https://psymascouche.jechemine.ca/tremblay",
    ]);
    expect(xml).toContain("<lastmod>2026-09-11T10:00:00.000Z</lastmod>");
    expect(h.listed).toHaveBeenCalledWith("mascouche");
  });
});

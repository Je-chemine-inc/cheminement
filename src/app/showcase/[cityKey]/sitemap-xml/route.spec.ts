import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  directory: [] as { cityKey: string; slug: string; expertiseIds: string[]; lastModified: Date | null }[],
  catalog: [] as { id: string; slug: string; labelFr: string; labelEn: string | null }[],
  loaded: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/showcase-queries", () => ({
  loadShowcaseDirectory: async () => {
    h.loaded("directory");
    return h.directory;
  },
  loadShowcaseCatalog: async () => {
    h.loaded("catalog");
    return h.catalog;
  },
}));

import { GET } from "./route";

const call = (cityKey: string) => GET({} as never, { params: Promise.resolve({ cityKey }) });
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

beforeEach(() => {
  h.enabled = true;
  h.directory = [];
  h.catalog = [{ id: "a", slug: "anxiete", labelFr: "Anxiété", labelEn: "Anxiety" }];
  h.loaded.mockReset();
});

describe("GET /sitemap.xml on a city host", () => {
  it("is a 404 for a city that is not in the registry", async () => {
    expect((await call("atlantis")).status).toBe(404);
  });

  it("lists nothing while the pages are off, without even looking", async () => {
    h.directory = [{ cityKey: "mascouche", slug: "sassi", expertiseIds: [], lastModified: null }];
    h.enabled = false;
    const res = await call("mascouche");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(locs(await res.text())).toEqual([]);
    expect(h.loaded).not.toHaveBeenCalled();
  });

  it("lists nothing for a city where no professional is presented", async () => {
    h.directory = [{ cityKey: "terrebonne", slug: "tremblay", expertiseIds: ["a"], lastModified: null }];
    const xml = await (await call("mascouche")).text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(locs(xml)).toEqual([]);
  });

  it("lists the city page, its professionals and its expertise pages, on its own host only", async () => {
    h.directory = [
      { cityKey: "mascouche", slug: "tremblay", expertiseIds: [], lastModified: new Date("2026-09-11T10:00:00Z") },
      { cityKey: "mascouche", slug: "sassi", expertiseIds: ["a"], lastModified: new Date("2026-09-10T10:00:00Z") },
      { cityKey: "terrebonne", slug: "roy", expertiseIds: ["a"], lastModified: null },
    ];
    const xml = await (await call("mascouche")).text();
    expect(locs(xml)).toEqual([
      "https://psymascouche.jechemine.ca/",
      "https://psymascouche.jechemine.ca/sassi",
      "https://psymascouche.jechemine.ca/tremblay",
      "https://psymascouche.jechemine.ca/specialite/anxiete",
    ]);
    expect(xml).toContain("<lastmod>2026-09-11T10:00:00.000Z</lastmod>");
  });
});

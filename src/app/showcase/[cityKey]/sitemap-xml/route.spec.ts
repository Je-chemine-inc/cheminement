import { describe, it, expect } from "vitest";
import { GET } from "./route";

const call = (cityKey: string) => GET({} as never, { params: Promise.resolve({ cityKey }) });

describe("GET /sitemap.xml on a city host", () => {
  it("is a 404 for a city that is not in the registry", async () => {
    expect((await call("atlantis")).status).toBe(404);
  });

  it("answers a valid, empty sitemap until a page is worth indexing", async () => {
    const res = await call("mascouche");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).not.toContain("<url>");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ enabled: false, calls: 0 }));

vi.mock("@/lib/showcase-settings", () => ({
  isShowcaseEnabled: async () => {
    h.calls++;
    return h.enabled;
  },
}));

import { GET } from "./route";

const call = (cityKey: string) => GET({} as never, { params: Promise.resolve({ cityKey }) });

beforeEach(() => {
  h.enabled = false;
  h.calls = 0;
});

describe("GET /robots.txt on a city host", () => {
  it("is a 404 for a city that is not in the registry, without reading the switch", async () => {
    expect((await call("atlantis")).status).toBe(404);
    expect(h.calls).toBe(0);
  });

  it("closes the whole host while the module is off", async () => {
    const res = await call("mascouche");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("opens the pages, with the host's own sitemap, once the module is on", async () => {
    h.enabled = true;
    const body = await (await call("troisrivieres")).text();
    expect(body).toContain("Allow: /\n");
    expect(body).toContain("Sitemap: https://psytroisrivieres.jechemine.ca/sitemap.xml");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  enabled: true,
  allowed: true,
  failStore: false,
  page: { _id: "page1" } as Record<string, unknown> | null,
  recorded: [] as unknown[],
  pageFilters: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ allowed: h.allowed }),
  getClientIp: () => "203.0.113.9",
}));
vi.mock("@/lib/showcase-stats", () => ({
  recordShowcaseEvent: async (input: unknown) => {
    if (h.failStore) throw new Error("store down");
    h.recorded.push(input);
  },
}));
vi.mock("@/models/ShowcasePage", () => ({
  default: {
    findOne: (filter: unknown) => {
      h.pageFilters.push(filter);
      return { select: () => ({ lean: async () => h.page }) };
    },
  },
}));

import { POST } from "./route";

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const post = (body: unknown, userAgent = BROWSER) =>
  POST(
    new NextRequest("http://127.0.0.1:3000/api/showcase/beacon", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", "user-agent": userAgent },
    }),
  );

beforeEach(() => {
  h.enabled = true;
  h.allowed = true;
  h.failStore = false;
  h.page = { _id: "page1" };
  h.recorded = [];
  h.pageFilters = [];
});

describe("POST /api/showcase/beacon", () => {
  it("is a 404 while the pages are off, and counts nothing", async () => {
    h.enabled = false;
    expect((await post({ event: "view", city: "mascouche" })).status).toBe(404);
    expect(h.recorded).toEqual([]);
  });

  it("refuses a malformed request", async () => {
    for (const body of [
      { event: "click", city: "mascouche" },
      { event: "view", city: "atlantis" },
      { event: "view", city: "mascouche", slug: "../etc" },
      { event: "view", city: "mascouche", slug: 42 },
      "not json",
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(h.recorded).toEqual([]);
  });

  it("counts a view of a city's own pages against the city", async () => {
    const res = await post({ event: "view", city: "mascouche" });
    expect(res.status).toBe(204);
    expect(h.recorded).toEqual([{ scope: "city", key: "mascouche", event: "view" }]);
    expect(h.pageFilters).toEqual([]);
  });

  it("counts a click on a professional's page against that published page, found in its city", async () => {
    expect((await post({ event: "cta", city: "mascouche", slug: "sassi" })).status).toBe(204);
    expect(h.pageFilters).toEqual([{ slug: "sassi", cityKey: "mascouche", status: "published" }]);
    expect(h.recorded).toEqual([{ scope: "page", key: "page1", event: "cta" }]);
  });

  it("counts nothing for a page that is not published there", async () => {
    h.page = null;
    expect((await post({ event: "view", city: "mascouche", slug: "sassi" })).status).toBe(204);
    expect(h.recorded).toEqual([]);
  });

  it("ignores crawlers and a visitor over the rate limit, still answering 204", async () => {
    expect((await post({ event: "view", city: "mascouche" }, "Mozilla/5.0 (compatible; Googlebot/2.1)")).status).toBe(204);
    expect((await post({ event: "view", city: "mascouche" }, "Mozilla/5.0 HeadlessChrome/128.0")).status).toBe(204);
    h.allowed = false;
    expect((await post({ event: "view", city: "mascouche" })).status).toBe(204);
    expect(h.recorded).toEqual([]);
  });

  it("never lets a failing store reach the page", async () => {
    h.failStore = true;
    expect((await post({ event: "view", city: "mascouche" })).status).toBe(204);
  });
});

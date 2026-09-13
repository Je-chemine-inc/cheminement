import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const PRO = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  enabled: true,
  allowed: true,
  bookable: null as Record<string, unknown> | null,
  loads: [] as string[],
  lists: [] as unknown[][],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/lazy-cron", () => ({ triggerDueWaitlistOffers: async () => undefined }));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.9",
  rateLimit: () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/showcase-booking", () => ({
  loadBookableShowcase: async (slug: string) => {
    h.loads.push(slug);
    return h.bookable;
  },
  listShowcaseSlots: async (...args: unknown[]) => {
    h.lists.push(args);
    return {
      service: args[1],
      available: true,
      durationMinutes: 60,
      price: 130,
      days: [{ day: "2026-09-15", slots: ["09:00"] }],
      nextFrom: "2026-09-28",
    };
  },
}));

import { GET } from "@/app/api/showcase/[slug]/slots/route";

const call = async (query = "", slug = "sassi") => {
  const res = await GET(new NextRequest(`http://psymascouche.jechemine.ca/api/showcase/${slug}/slots${query}`), {
    params: Promise.resolve({ slug }),
  });
  return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
};

beforeEach(() => {
  h.enabled = true;
  h.allowed = true;
  h.bookable = { pageId: "page-1", professionalId: PRO, slug: "sassi", cityKey: "mascouche", services: {} };
  h.loads = [];
  h.lists = [];
});

describe("GET /api/showcase/[slug]/slots", () => {
  it("does not exist while the pages are off", async () => {
    h.enabled = false;
    expect((await call()).status).toBe(404);
    expect(h.loads).toEqual([]);
  });

  it("slows down a burst from one address", async () => {
    h.allowed = false;
    expect((await call()).status).toBe(429);
    expect(h.loads).toEqual([]);
  });

  it("refuses an unknown consultation or an unreadable day", async () => {
    expect((await call("?service=couple")).status).toBe(400);
    expect((await call("?from=2026-02-30")).status).toBe(400);
    expect(h.loads).toEqual([]);
  });

  it("is 404 for a page that is not published", async () => {
    h.bookable = null;
    expect((await call()).status).toBe(404);
    expect(h.lists).toEqual([]);
  });

  it("lists the free times, the standard consultation by default, never cached", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.cache).toBe("no-store");
    expect(res.body).toEqual({
      service: "standard",
      available: true,
      durationMinutes: 60,
      price: 130,
      days: [{ day: "2026-09-15", slots: ["09:00"] }],
      nextFrom: "2026-09-28",
    });
    // The internal description of the page never reaches the body.
    expect(JSON.stringify(res.body)).not.toContain(PRO);
    expect(h.lists[0].slice(1, 3)).toEqual(["standard", null]);

    await call("?service=quick&from=2026-09-28");
    expect(h.lists[1].slice(1, 3)).toEqual(["quick", "2026-09-28"]);
  });
});

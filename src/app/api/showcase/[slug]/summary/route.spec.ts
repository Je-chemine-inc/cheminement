import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  enabled: true,
  allowed: true,
  result: { kind: "missing" } as Record<string, unknown>,
  slugs: [] as string[],
}));

vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.9",
  rateLimit: () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/showcase-queries", () => ({
  findPublishedShowcase: async (slug: string) => {
    h.slugs.push(slug);
    return h.result;
  },
}));

import { GET } from "@/app/api/showcase/[slug]/summary/route";

const SECRET = "POISON";
const services = {
  standard: { offered: true, durationMinutes: 50, prices: [{ therapyType: "solo", price: 130 }] },
  quick: { offered: true, durationMinutes: 30, price: 70 },
};
const profile = {
  slug: "sassi",
  url: "https://psymascouche.jechemine.ca/sassi",
  city: { key: "mascouche", name: "Mascouche", region: "Lanaudière", regionKey: "lanaudiere" },
  displayName: "Amel Sassi",
  title: { key: "psychologist", label: null },
  order: { code: "OPQ", label: null },
  licenseNumber: `${SECRET}-1`,
  photoUrl: "/api/files/0123456789abcdef01234567",
  headline: SECRET,
  intro: [SECRET],
  bio: [SECRET],
  approach: [],
  values: [],
  expertises: [],
  languages: [],
  modalities: [],
  officeCity: SECRET,
  yearsOfExperience: 12,
  services,
  insuranceNote: [],
  freeCancellationHours: 48,
};

const call = async (slug = "sassi") => {
  const res = await GET(new NextRequest(`https://www.jechemine.ca/api/showcase/${slug}/summary`), {
    params: Promise.resolve({ slug }),
  });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  h.enabled = true;
  h.allowed = true;
  h.result = { kind: "found", profile, updatedAt: null };
  h.slugs = [];
});

describe("GET /api/showcase/[slug]/summary", () => {
  it("does not exist while the pages are off, and slows down bursts", async () => {
    h.enabled = false;
    expect((await call()).status).toBe(404);
    h.enabled = true;
    h.allowed = false;
    expect((await call()).status).toBe(429);
    expect(h.slugs).toEqual([]);
  });

  it("is 404 for a page that is missing or moved", async () => {
    h.result = { kind: "missing" };
    expect((await call()).status).toBe(404);
    h.result = { kind: "moved", cityKey: "terrebonne", slug: "dre-sassi" };
    expect((await call()).status).toBe(404);
  });

  it("names the professional and the consultations, and nothing else of the page", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      slug: "sassi",
      url: "https://psymascouche.jechemine.ca/sassi",
      displayName: "Amel Sassi",
      title: { key: "psychologist", label: null },
      photoUrl: "/api/files/0123456789abcdef01234567",
      city: { key: "mascouche", name: "Mascouche" },
      services,
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});

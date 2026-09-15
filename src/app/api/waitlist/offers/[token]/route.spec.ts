import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";

const h = vi.hoisted(() => ({
  enabled: true,
  allowed: true,
  result: { ok: false, code: "OFFER_INVALID" } as { ok: true; offer: Record<string, unknown> } | { ok: false; code: string },
  tokens: [] as unknown[],
}));

vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.9",
  rateLimit: () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/waitlist-entries", () => ({
  readWaitlistOffer: async (token: unknown) => {
    h.tokens.push(token);
    return h.result;
  },
}));

import { GET } from "@/app/api/waitlist/offers/[token]/route";

const call = async (token = TOKEN) => {
  const res = await GET(new NextRequest(`http://www.jechemine.ca/api/waitlist/offers/${token}`), {
    params: Promise.resolve({ token }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
    cache: res.headers.get("cache-control"),
  };
};

beforeEach(() => {
  h.enabled = true;
  h.allowed = true;
  h.result = { ok: false, code: "OFFER_INVALID" };
  h.tokens = [];
});

describe("GET /api/waitlist/offers/[token]", () => {
  it("does not exist while the pages are off", async () => {
    h.enabled = false;
    expect((await call()).status).toBe(404);
    expect(h.tokens).toEqual([]);
  });

  it("slows down guessing", async () => {
    h.allowed = false;
    expect((await call()).status).toBe(429);
    expect(h.tokens).toEqual([]);
  });

  it("answers 410 with the reason for a dead offer, never cached", async () => {
    h.result = { ok: false, code: "OFFER_EXPIRED" };
    expect(await call()).toMatchObject({ status: 410, body: { code: "OFFER_EXPIRED" }, cache: "no-store" });
    h.result = { ok: false, code: "OFFER_CLAIMED" };
    expect(await call()).toMatchObject({ status: 410, body: { code: "OFFER_CLAIMED" }, cache: "no-store" });
  });

  it("shows the offer, never cached", async () => {
    const offer = {
      professionalName: "Dre Sassi",
      service: "standard",
      dayKey: "2026-09-16",
      time: "10:00",
      durationMinutes: 60,
      expiresAt: "2026-09-13T15:15:00.000Z",
    };
    h.result = { ok: true, offer };
    expect(await call()).toEqual({ status: 200, body: { offer }, cache: "no-store" });
    expect(h.tokens).toEqual([TOKEN]);
  });
});

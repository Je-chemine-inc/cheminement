import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const APPT = "0123456789abcdef0123aaaa";
const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";

type ClaimResult =
  | { ok: true; appointmentId: string; professionalName: string; dayKey: string; time: string; respondBy: Date }
  | { ok: false; status: number; code: string };

const h = vi.hoisted(() => ({
  allowed: true,
  result: null as ClaimResult | null,
  throws: false,
  tokens: [] as unknown[],
  notified: [] as string[],
  afterTasks: [] as (() => unknown)[],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    h.afterTasks.push(task);
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.9",
  rateLimit: () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/waitlist-entries", () => ({
  claimWaitlistOffer: async (token: unknown) => {
    h.tokens.push(token);
    if (h.throws) throw new Error("db down");
    return h.result;
  },
}));
vi.mock("@/lib/direct-request", () => ({
  notifyDirectRequestCreated: async (id: string) => {
    h.notified.push(id);
  },
}));

import { POST } from "@/app/api/waitlist/claim/route";

const call = async (body: unknown = { token: TOKEN }) => {
  const res = await POST(
    new NextRequest("http://www.jechemine.ca/api/waitlist/claim", { method: "POST", body: JSON.stringify(body) }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  h.allowed = true;
  h.result = {
    ok: true,
    appointmentId: APPT,
    professionalName: "Dre Sassi",
    dayKey: "2026-09-16",
    time: "10:00",
    respondBy: new Date("2026-09-14T15:00:00.000Z"),
  };
  h.throws = false;
  h.tokens = [];
  h.notified = [];
  h.afterTasks = [];
});

describe("POST /api/waitlist/claim", () => {
  it("slows down guessing", async () => {
    h.allowed = false;
    expect((await call()).status).toBe(429);
    expect(h.tokens).toEqual([]);
  });

  it("passes the library's refusals through and notifies no one", async () => {
    h.result = { ok: false, status: 410, code: "OFFER_EXPIRED" };
    expect(await call()).toMatchObject({ status: 410, body: { code: "OFFER_EXPIRED" } });
    h.result = { ok: false, status: 409, code: "OFFER_UNAVAILABLE" };
    expect(await call()).toMatchObject({ status: 409, body: { code: "OFFER_UNAVAILABLE" } });
    h.result = { ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" };
    expect(await call()).toMatchObject({ status: 404, body: { code: "SHOWCASE_NOT_FOUND" } });
    expect(h.afterTasks).toEqual([]);
  });

  it("books the held time and emails the professional after the answer", async () => {
    expect(await call()).toEqual({
      status: 200,
      body: {
        claimed: true,
        professionalName: "Dre Sassi",
        dayKey: "2026-09-16",
        time: "10:00",
        respondBy: "2026-09-14T15:00:00.000Z",
      },
    });
    expect(h.tokens).toEqual([TOKEN]);
    expect(h.notified).toEqual([]);
    expect(h.afterTasks).toHaveLength(1);
    await h.afterTasks[0]();
    expect(h.notified).toEqual([APPT]);
  });

  it("answers 500 when the claim fails", async () => {
    h.throws = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call()).status).toBe(500);
    expect(h.afterTasks).toEqual([]);
  });
});

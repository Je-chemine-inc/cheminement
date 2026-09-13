import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const PRO = "0123456789abcdef01234567";
const TOKEN = "ab".repeat(32);

const h = vi.hoisted(() => ({
  allowed: true,
  result: { ok: false } as { ok: false } | { ok: true; professionalId: string; freedTime: boolean },
  tokens: [] as unknown[],
  freed: [] as unknown[],
  afterTasks: [] as (() => unknown)[],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    h.afterTasks.push(task);
  },
}));
// Leaving never depends on the switch: even with the pages off it works.
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => false }));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.9",
  rateLimit: () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/waitlist-entries", () => ({
  leaveWaitlist: async (token: unknown) => {
    h.tokens.push(token);
    return h.result;
  },
}));
vi.mock("@/lib/waitlist-slot-freed", () => ({
  afterSlotFreed: async (professional: unknown) => {
    h.freed.push(professional);
  },
}));

import { POST } from "@/app/api/waitlist/leave/route";

const call = async (body: unknown) => {
  const res = await POST(
    new NextRequest("http://www.jechemine.ca/api/waitlist/leave", { method: "POST", body: JSON.stringify(body) }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  h.allowed = true;
  h.result = { ok: false };
  h.tokens = [];
  h.freed = [];
  h.afterTasks = [];
});

describe("POST /api/waitlist/leave", () => {
  it("slows down guessing", async () => {
    h.allowed = false;
    expect((await call({ token: TOKEN })).status).toBe(429);
    expect(h.tokens).toEqual([]);
  });

  it("answers 410 for a link already used or unknown", async () => {
    expect(await call({ token: "spent" })).toMatchObject({ status: 410, body: { code: "LINK_INVALID" } });
    expect(h.tokens).toEqual(["spent"]);
    expect(h.afterTasks).toEqual([]);
  });

  it("leaves the list, even while the pages are off, and offers the freed time after the answer", async () => {
    h.result = { ok: true, professionalId: PRO, freedTime: true };
    expect(await call({ token: TOKEN })).toEqual({ status: 200, body: { left: true } });
    expect(h.tokens).toEqual([TOKEN]);
    expect(h.freed).toEqual([]);
    expect(h.afterTasks).toHaveLength(1);
    await h.afterTasks[0]();
    expect(h.freed).toEqual([PRO]);
  });

  it("offers nothing when leaving freed no time", async () => {
    h.result = { ok: true, professionalId: PRO, freedTime: false };
    expect(await call({ token: TOKEN })).toEqual({ status: 200, body: { left: true } });
    expect(h.afterTasks).toEqual([]);
  });
});

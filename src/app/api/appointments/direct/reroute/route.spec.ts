import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT = "0123456789abcdef0123aaaa";

const h = vi.hoisted(() => ({
  allowed: true,
  result: { ok: false } as { ok: boolean; appointmentId?: string },
  tokens: [] as unknown[],
  routed: [] as string[],
  afterTasks: [] as (() => unknown)[],
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: (task: () => unknown) => {
    h.afterTasks.push(task);
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.9",
  rateLimit: () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/direct-request", () => ({
  rerouteDirectRequest: async (token: unknown) => {
    h.tokens.push(token);
    return h.result;
  },
}));
vi.mock("@/lib/appointment-routing", () => ({
  routeAppointmentToProfessionals: async (id: string) => {
    h.routed.push(id);
    return {};
  },
}));

import { POST } from "@/app/api/appointments/direct/reroute/route";

type Res = { status: number; body: Record<string, unknown> };
const call = (body: unknown) =>
  POST({ json: async () => body, headers: new Headers() } as never) as unknown as Promise<Res>;

beforeEach(() => {
  h.allowed = true;
  h.result = { ok: false };
  h.tokens = [];
  h.routed = [];
  h.afterTasks = [];
});

describe("POST /api/appointments/direct/reroute", () => {
  it("hands the request to matching, which runs after the answer", async () => {
    h.result = { ok: true, appointmentId: APPT };
    expect(await call({ token: "ab".repeat(32) })).toEqual({ status: 200, body: { rerouted: true } });
    expect(h.tokens).toEqual(["ab".repeat(32)]);
    expect(h.routed).toEqual([]);
    await h.afterTasks[0]();
    expect(h.routed).toEqual([APPT]);
  });

  it("answers 410 for a link that is invalid, expired or already used", async () => {
    expect(await call({ token: "spent" })).toMatchObject({ status: 410, body: { code: "LINK_INVALID" } });
    expect(await call({ token: { $ne: "" } })).toMatchObject({ status: 410 });
    expect(h.tokens).toEqual(["spent", ""]);
    expect(h.afterTasks).toEqual([]);
  });

  it("slows down guessing", async () => {
    h.allowed = false;
    expect((await call({ token: "ab".repeat(32) })).status).toBe(429);
    expect(h.tokens).toEqual([]);
  });
});

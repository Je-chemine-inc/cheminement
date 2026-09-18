import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO = "0123456789abcdef01234567";
const APPT = "0123456789abcdef0123aaaa";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
  released: null as { rerouteToken: string | null; handedToMatching?: boolean } | null,
  matched: [] as string[],
  handedOn: [] as unknown[][],
  releaseCalls: [] as Record<string, unknown>[],
  notified: [] as unknown[][],
  afterTasks: [] as (() => unknown)[],
  exists: null as unknown,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: (task: () => unknown) => {
    h.afterTasks.push(task);
  },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/Appointment", () => ({ default: { exists: async () => h.exists } }));
vi.mock("@/lib/direct-request", () => ({
  releaseDirectRequest: async (input: Record<string, unknown>) => {
    h.releaseCalls.push(input);
    return h.released;
  },
  notifyDirectRequestReleased: async (...args: unknown[]) => {
    h.notified.push(args);
  },
  matchHandedOnRequest: async (id: string) => {
    h.matched.push(id);
  },
  notifyDirectRequestHandedOn: async (...args: unknown[]) => {
    h.handedOn.push(args);
  },
}));

import { POST } from "@/app/api/appointments/[id]/decline-direct/route";

type Res = { status: number; body: Record<string, unknown> };
const call = (body: unknown, id = APPT) =>
  POST({ json: async () => body } as never, { params: Promise.resolve({ id }) } as never) as unknown as Promise<Res>;

beforeEach(() => {
  h.session = { user: { id: PRO, role: "professional" } };
  h.released = { rerouteToken: "ab".repeat(32) };
  h.releaseCalls = [];
  h.notified = [];
  h.matched = [];
  h.handedOn = [];
  h.afterTasks = [];
  h.exists = null;
});

describe("POST /api/appointments/[id]/decline-direct", () => {
  it("declines as the professional asked, then emails the client and the team after answering", async () => {
    const res = await call({ reason: "not_a_fit", note: "Hors de mon champ" });
    expect(res).toEqual({ status: 200, body: { id: APPT, state: "declined" } });
    expect(h.releaseCalls).toEqual([
      { appointmentId: APPT, outcome: "declined", professionalId: PRO, reason: "not_a_fit", note: "Hors de mon champ" },
    ]);
    expect(h.notified).toEqual([]);
    await h.afterTasks[0]();
    expect(h.notified).toEqual([[APPT, "ab".repeat(32)]]);
  });

  it("hands a request on to matching when the client agreed, then tells them — no link to choose from (phase 3b)", async () => {
    h.released = { rerouteToken: null, handedToMatching: true };
    const res = await call({ reason: "not_a_fit" });
    expect(res.status).toBe(200);
    await h.afterTasks[0]();
    expect(h.matched).toEqual([APPT]);
    expect(h.handedOn).toEqual([[APPT, "declined"]]);
    expect(h.notified).toEqual([]);
  });

  it("requires a known reason and a short note", async () => {
    expect(await call({ reason: "busy" })).toMatchObject({ status: 400, body: { code: "INVALID_REASON" } });
    expect(await call({ reason: "other", note: "x".repeat(501) })).toMatchObject({ status: 400, body: { code: "INVALID_NOTE" } });
    expect(h.releaseCalls).toEqual([]);
  });

  it("tells a closed request from someone else's", async () => {
    h.released = null;
    h.exists = { _id: APPT };
    expect(await call({ reason: "other" })).toMatchObject({ status: 409, body: { code: "DIRECT_REQUEST_CLOSED" } });
    h.exists = null;
    expect((await call({ reason: "other" })).status).toBe(404);
    expect(h.afterTasks).toEqual([]);
  });

  it("refuses anyone but a professional", async () => {
    h.session = { user: { id: "c1", role: "client" } };
    expect((await call({ reason: "other" })).status).toBe(401);
    expect(h.releaseCalls).toEqual([]);
  });
});

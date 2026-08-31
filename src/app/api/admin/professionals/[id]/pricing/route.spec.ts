/**
 * Admin-only per-professional pricing. Pins the auth gate and the money
 * validation: a professional must never be able to set their own rate here, and
 * the platform must never be configured to pay out more than it collects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  profileFindOne: vi.fn(),
  profileFindOneAndUpdate: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: (...a: unknown[]) => h.profileFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => h.profileFindOneAndUpdate(...a),
  },
}));

import {
  GET,
  PATCH,
} from "@/app/api/admin/professionals/[id]/pricing/route";

type Res = Promise<{ status: number; body: unknown }>;

const ctx = (id = PRO_ID) => ({ params: Promise.resolve({ id }) });

const callPatch = (body: unknown, id = PRO_ID): Res =>
  PATCH({ json: async () => body } as never, ctx(id) as never) as unknown as Res;

const callGet = (id = PRO_ID): Res =>
  GET({} as never, ctx(id) as never) as unknown as Res;

const asAdmin = () =>
  h.getServerSession.mockResolvedValue({ user: { id: "adm", role: "admin" } });

beforeEach(() => {
  vi.clearAllMocks();
  asAdmin();
  h.profileFindOne.mockResolvedValue({
    userId: PRO_ID,
    rates: { solo: { clientPrice: 175, professionalRate: 150 } },
  });
  h.profileFindOneAndUpdate.mockImplementation((_f, update) =>
    Promise.resolve({
      rates: { solo: { clientPrice: 175, professionalRate: 150 } },
      _update: update,
    }),
  );
});

describe("auth gate", () => {
  it.each([
    ["professional", { user: { id: PRO_ID, role: "professional" } }],
    ["client", { user: { id: "c1", role: "client" } }],
    ["anonymous", null],
  ])("rejects %s with 401 on PATCH", async (_label, session) => {
    h.getServerSession.mockResolvedValue(session);

    const res = await callPatch({
      rates: { solo: { clientPrice: 999, professionalRate: 999 } },
    });

    expect(res.status).toBe(401);
    // KEY: a professional must not be able to set their own rate here.
    expect(h.profileFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-admin on GET too", async () => {
    h.getServerSession.mockResolvedValue({
      user: { id: PRO_ID, role: "professional" },
    });
    expect((await callGet()).status).toBe(401);
  });

  it("rejects a malformed professional id", async () => {
    expect((await callPatch({ rates: {} }, "not-an-objectid")).status).toBe(400);
  });

  it("404s when the profile does not exist", async () => {
    h.profileFindOne.mockResolvedValue(null);
    expect((await callPatch({ rates: {} })).status).toBe(404);
  });
});

describe("money validation", () => {
  it("rejects a professional rate above the client price", async () => {
    const res = await callPatch({
      rates: { solo: { clientPrice: 175, professionalRate: 200 } },
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "RATE_EXCEEDS_CLIENT_PRICE" });
    expect(h.profileFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a partial update that would exceed the STORED client price", async () => {
    // Only the rate is sent; it must still be checked against the stored 175.
    const res = await callPatch({ rates: { solo: { professionalRate: 300 } } });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "RATE_EXCEEDS_CLIENT_PRICE" });
    expect(h.profileFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a negative price", async () => {
    const res = await callPatch({ rates: { solo: { clientPrice: -5 } } });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown therapy type", async () => {
    const res = await callPatch({ rates: { massage: { clientPrice: 100 } } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "UNKNOWN_THERAPY_TYPE" });
  });
});

describe("writes", () => {
  it("persists a valid pair as dotted paths", async () => {
    const res = await callPatch({
      rates: { solo: { clientPrice: 200, professionalRate: 160 } },
    });

    expect(res.status).toBe(200);
    const [, update] = h.profileFindOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, number> },
    ];
    expect(update.$set).toEqual({
      "rates.solo.clientPrice": 200,
      "rates.solo.professionalRate": 160,
    });
  });

  it("unsets a field the admin explicitly cleared", async () => {
    const res = await callPatch({ rates: { solo: { clientPrice: null } } });

    expect(res.status).toBe(200);
    const [, update] = h.profileFindOneAndUpdate.mock.calls[0] as [
      unknown,
      { $unset: Record<string, string> },
    ];
    expect(update.$unset).toEqual({ "rates.solo.clientPrice": "" });
  });

  it("is a no-op write when nothing changed", async () => {
    const res = await callPatch({ rates: {} });

    expect(res.status).toBe(200);
    expect(h.profileFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("allows a zero spread but reports it", async () => {
    h.profileFindOneAndUpdate.mockResolvedValue({
      rates: { solo: { clientPrice: 175, professionalRate: 175 } },
    });

    const res = await callPatch({
      rates: { solo: { clientPrice: 175, professionalRate: 175 } },
    });

    expect(res.status).toBe(200);
    const solo = (res.body as { rates: Record<string, { zeroOrNegativeSpread: boolean }> })
      .rates.solo;
    // AC-17: legal, but never silent.
    expect(solo.zeroOrNegativeSpread).toBe(true);
  });
});

describe("GET", () => {
  it("returns stored values plus the derived spread", async () => {
    const res = await callGet();

    expect(res.status).toBe(200);
    const solo = (
      res.body as {
        rates: Record<
          string,
          {
            clientPrice: number;
            professionalRate: number;
            spread: { amount: number; percentage: number };
            zeroOrNegativeSpread: boolean;
          }
        >;
      }
    ).rates.solo;

    expect(solo.clientPrice).toBe(175);
    expect(solo.professionalRate).toBe(150);
    expect(solo.spread).toEqual({ amount: 25, percentage: 14.29 });
    expect(solo.zeroOrNegativeSpread).toBe(false);
  });

  it("returns nulls for an unconfigured therapy type", async () => {
    const res = await callGet();
    const group = (
      res.body as { rates: Record<string, { clientPrice: null }> }
    ).rates.group;
    expect(group.clientPrice).toBeNull();
  });
});

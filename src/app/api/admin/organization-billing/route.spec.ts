/**
 * The organization-billing switches (spec 002): organization billing itself,
 * and bank debit (DPA) on the pay link — each one set on its own, only by a
 * billing admin, only to true or false.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  gate: { session: { user: { id: "admin1" } } } as Record<string, unknown>,
  settings: { organizationBillingEnabled: false, organizationPadEnabled: false } as Record<string, unknown>,
  matched: 1,
  updateOne: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
vi.mock("@/lib/organization-admin", () => ({ requireBillingAdmin: async () => h.gate }));
vi.mock("@/models/PlatformSettings", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: async () => h.settings }) }),
    updateOne: h.updateOne,
  },
}));

import { GET, PUT } from "./route";

type Res = { status: number; body: Record<string, unknown> };
const put = async (body: unknown) => (await PUT({ json: async () => body } as never)) as unknown as Res;

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  h.gate = { session: { user: { id: "admin1" } } };
  h.settings = { organizationBillingEnabled: false, organizationPadEnabled: false };
  h.matched = 1;
  h.updateOne.mockReset();
  h.updateOne.mockImplementation(async (_f: unknown, u: { $set: Record<string, unknown> }) => {
    if (h.matched) Object.assign(h.settings, u.$set);
    return { matchedCount: h.matched };
  });
});

describe("GET", () => {
  it("both switches, off unless set", async () => {
    h.settings = {};
    expect(((await GET()) as unknown as Res).body).toEqual({ enabled: false, padEnabled: false });
    h.settings = { organizationBillingEnabled: true, organizationPadEnabled: true };
    expect(((await GET()) as unknown as Res).body).toEqual({ enabled: true, padEnabled: true });
  });
});

describe("PUT", () => {
  it("turns bank debit on without touching organization billing", async () => {
    const r = await put({ padEnabled: true });
    expect(h.updateOne).toHaveBeenCalledWith({}, { $set: { organizationPadEnabled: true } });
    expect(r.body).toEqual({ enabled: false, padEnabled: true });
  });

  it("turns organization billing off without touching bank debit", async () => {
    h.settings = { organizationBillingEnabled: true, organizationPadEnabled: true };
    const r = await put({ enabled: false });
    expect(h.updateOne).toHaveBeenCalledWith({}, { $set: { organizationBillingEnabled: false } });
    expect(r.body).toEqual({ enabled: false, padEnabled: true });
  });

  it("only true or false, and at least one switch — nothing written otherwise", async () => {
    for (const body of [{}, null, { padEnabled: "true" }, { enabled: 1 }, { enabled: true, padEnabled: "yes" }]) {
      expect((await put(body)).status).toBe(400);
    }
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("no settings saved yet: refused, not created", async () => {
    h.matched = 0;
    expect((await put({ padEnabled: true })).status).toBe(409);
  });

  it("without billing rights, nothing is read or written", async () => {
    h.gate = { error: { status: 403, body: { error: "Forbidden" } } };
    expect((await put({ padEnabled: true })).status).toBe(403);
    expect(((await GET()) as unknown as Res).status).toBe(403);
    expect(h.updateOne).not.toHaveBeenCalled();
  });
});

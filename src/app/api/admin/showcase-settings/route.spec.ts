/**
 * The showcase switch (spec 003): set only by an admin who manages
 * professionals, only to true or false, never by creating the settings.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  gate: { session: { user: { id: "admin1" } } } as Record<string, unknown>,
  settings: { showcaseEnabled: false } as Record<string, unknown>,
  matched: 1,
  updateOne: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
vi.mock("@/lib/professional-admin", () => ({ requireProfessionalsAdmin: async () => h.gate }));
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
  h.settings = { showcaseEnabled: false };
  h.matched = 1;
  h.updateOne.mockReset();
  h.updateOne.mockImplementation(async (_f: unknown, u: { $set: Record<string, unknown> }) => {
    if (h.matched) Object.assign(h.settings, u.$set);
    return { matchedCount: h.matched };
  });
});

describe("GET", () => {
  it("is off unless set to true", async () => {
    h.settings = {};
    expect(((await GET()) as unknown as Res).body).toEqual({ enabled: false });
    h.settings = { showcaseEnabled: "true" };
    expect(((await GET()) as unknown as Res).body).toEqual({ enabled: false });
    h.settings = { showcaseEnabled: true };
    expect(((await GET()) as unknown as Res).body).toEqual({ enabled: true });
  });
});

describe("PUT", () => {
  it("turns the showcase on and off", async () => {
    expect((await put({ enabled: true })).body).toEqual({ enabled: true });
    expect(h.updateOne).toHaveBeenLastCalledWith({}, { $set: { showcaseEnabled: true } });
    expect((await put({ enabled: false })).body).toEqual({ enabled: false });
    expect(h.updateOne).toHaveBeenLastCalledWith({}, { $set: { showcaseEnabled: false } });
  });

  it("only true or false — nothing written otherwise", async () => {
    for (const body of [{}, null, { enabled: "true" }, { enabled: 1 }]) {
      expect((await put(body)).status).toBe(400);
    }
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("no settings saved yet: refused, not created", async () => {
    h.matched = 0;
    expect((await put({ enabled: true })).status).toBe(409);
  });

  it("without the right, nothing is read or written", async () => {
    h.gate = { error: { status: 403, body: { error: "Forbidden" } } };
    expect((await put({ enabled: true })).status).toBe(403);
    expect(((await GET()) as unknown as Res).status).toBe(403);
    expect(h.updateOne).not.toHaveBeenCalled();
  });
});

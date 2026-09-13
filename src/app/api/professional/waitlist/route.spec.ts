import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  gate: { userId: "" } as { error: Response } | { userId: string },
  throws: false,
  loads: [] as string[],
}));

vi.mock("@/lib/showcase-http", () => ({ requireShowcaseProfessional: async () => h.gate }));
vi.mock("@/lib/waitlist-entries", () => ({
  listProfessionalWaitlist: async (professionalId: string) => {
    h.loads.push(professionalId);
    if (h.throws) throw new Error("db down");
    return [{ id: "e1", name: "Amel S.", position: 1 }];
  },
}));

import { GET } from "@/app/api/professional/waitlist/route";

beforeEach(() => {
  h.gate = { userId: PRO };
  h.throws = false;
  h.loads = [];
});

describe("GET /api/professional/waitlist", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 });
    h.gate = { error: refusal };
    expect(await GET()).toBe(refusal);
    expect(h.loads).toEqual([]);
  });

  it("lists the signed-in professional's waitlist, never cached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ entries: [{ id: "e1", name: "Amel S.", position: 1 }] });
    expect(h.loads).toEqual([PRO]);
  });

  it("answers 500 when the list cannot be loaded", async () => {
    h.throws = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET()).status).toBe(500);
  });
});

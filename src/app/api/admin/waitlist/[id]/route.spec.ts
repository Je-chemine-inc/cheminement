import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const PRO = "0123456789abcdef01234567";
const ENTRY = "0123456789abcdef0123eeee";

const h = vi.hoisted(() => ({
  gate: { session: {} } as { error: Response } | { session: Record<string, unknown> },
  result: { ok: false } as { ok: false } | { ok: true; professionalId: string; freedTime: boolean },
  removals: [] as Record<string, unknown>[],
  freed: [] as unknown[],
  afterTasks: [] as (() => unknown)[],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    h.afterTasks.push(task);
  },
}));
vi.mock("@/lib/professional-admin", () => ({ requireProfessionalsAdmin: async () => h.gate }));
vi.mock("@/lib/waitlist-entries", () => ({
  removeWaitlistEntry: async (input: Record<string, unknown>) => {
    h.removals.push(input);
    return h.result;
  },
}));
vi.mock("@/lib/waitlist-slot-freed", () => ({
  afterSlotFreed: async (professional: unknown) => {
    h.freed.push(professional);
  },
}));

import { DELETE } from "@/app/api/admin/waitlist/[id]/route";

const call = (id = ENTRY) =>
  DELETE(new Request(`http://www.jechemine.ca/api/admin/waitlist/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  h.gate = { session: { user: { id: "admin-1" } } };
  h.result = { ok: false };
  h.removals = [];
  h.freed = [];
  h.afterTasks = [];
});

describe("DELETE /api/admin/waitlist/[id]", () => {
  it("returns the gate's refusal as is", async () => {
    const refusal = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    h.gate = { error: refusal };
    expect(await call()).toBe(refusal);
    expect(h.removals).toEqual([]);
  });

  it("is 404 for an entry that is not open", async () => {
    expect((await call()).status).toBe(404);
    expect(h.removals).toEqual([{ entryId: ENTRY, by: "admin" }]);
    expect(h.afterTasks).toEqual([]);
  });

  it("removes the person and offers the freed time after the answer", async () => {
    h.result = { ok: true, professionalId: PRO, freedTime: true };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(h.afterTasks).toHaveLength(1);
    await h.afterTasks[0]();
    expect(h.freed).toEqual([PRO]);
  });

  it("offers nothing when no time was held", async () => {
    h.result = { ok: true, professionalId: PRO, freedTime: false };
    expect((await call()).status).toBe(200);
    expect(h.afterTasks).toEqual([]);
  });
});

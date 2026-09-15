import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "cron-secret-for-tests";

const h = vi.hoisted(() => ({
  throws: false,
  runs: 0,
}));

vi.mock("@/lib/product-jobs", () => ({
  runProductJobs: async () => {
    h.runs += 1;
    if (h.throws) throw new Error("db down");
    return { statusCorrected: 1, remindersSent: 2, remindersFailed: 0 };
  },
}));

import { GET } from "@/app/api/cron/products/route";

const call = async (authorization?: string) => {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  const res = await GET(new NextRequest("http://127.0.0.1:3000/api/cron/products", { headers }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  h.throws = false;
  h.runs = 0;
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

describe("GET /api/cron/products", () => {
  it("refuses a call without the secret, or with a wrong one", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
    expect(h.runs).toBe(0);
  });

  it("refuses everyone when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(h.runs).toBe(0);
  });

  it("runs the job and reports its counts", async () => {
    expect(await call(`Bearer ${SECRET}`)).toEqual({
      status: 200,
      body: { ok: true, statusCorrected: 1, remindersSent: 2, remindersFailed: 0 },
    });
    expect(h.runs).toBe(1);
  });

  it("answers 500 when the job fails", async () => {
    h.throws = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call(`Bearer ${SECRET}`)).status).toBe(500);
  });
});

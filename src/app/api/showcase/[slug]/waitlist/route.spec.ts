import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { WAITLIST_CONSENT_VERSION } from "@/lib/waitlist-rules";

const PRO = "0123456789abcdef01234567";

type JoinResult =
  | { ok: true; created: false; professionalId: string }
  | { ok: true; created: true; professionalId: string; professionalName: string; pageUrl: string; leaveUrl: string }
  | { ok: false; status: number; code: string };

const h = vi.hoisted(() => ({
  enabled: true,
  refusedPrefix: null as string | null,
  rateKeys: [] as string[],
  result: null as JoinResult | null,
  throws: false,
  joins: [] as Record<string, unknown>[],
  emails: [] as Record<string, unknown>[],
  freed: [] as unknown[],
  afterTasks: [] as (() => unknown)[],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    h.afterTasks.push(task);
  },
}));
vi.mock("@/lib/showcase-settings", () => ({ isShowcaseEnabled: async () => h.enabled }));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.9",
  rateLimit: (key: string) => {
    h.rateKeys.push(key);
    return { allowed: !(h.refusedPrefix !== null && key.startsWith(h.refusedPrefix)) };
  },
}));
vi.mock("@/lib/waitlist-entries", () => ({
  joinWaitlist: async (input: Record<string, unknown>) => {
    h.joins.push(input);
    if (h.throws) throw new Error("db down");
    return h.result;
  },
}));
vi.mock("@/lib/notifications", () => ({
  sendWaitlistJoinedEmail: async (input: Record<string, unknown>) => {
    h.emails.push(input);
  },
}));
vi.mock("@/lib/waitlist-slot-freed", () => ({
  afterSlotFreed: async (professional: unknown) => {
    h.freed.push(professional);
  },
}));

import { POST } from "@/app/api/showcase/[slug]/waitlist/route";

const validBody = (over: Record<string, unknown> = {}) => ({
  firstName: "Amel",
  lastName: "Sassi",
  email: "Amel@Example.com",
  phone: "514-555-0199",
  locale: "en",
  service: "standard",
  modality: "video",
  motifs: ["Anxiété"],
  periods: ["morning"],
  days: ["monday"],
  consent: true,
  consentVersion: WAITLIST_CONSENT_VERSION,
  smsConsent: true,
  ...over,
});

const call = async (body: unknown = validBody(), slug = "sassi") => {
  const res = await POST(
    new NextRequest(`http://psymascouche.jechemine.ca/api/showcase/${slug}/waitlist`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ slug }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const created = (): JoinResult => ({
  ok: true,
  created: true,
  professionalId: PRO,
  professionalName: "Dre Sassi",
  pageUrl: "https://www.jechemine.ca/sassi",
  leaveUrl: "https://www.jechemine.ca/liste-attente/quitter?t=abc",
});

beforeEach(() => {
  h.enabled = true;
  h.refusedPrefix = null;
  h.rateKeys = [];
  h.result = created();
  h.throws = false;
  h.joins = [];
  h.emails = [];
  h.freed = [];
  h.afterTasks = [];
});

describe("POST /api/showcase/[slug]/waitlist", () => {
  it("does not exist while the pages are off", async () => {
    h.enabled = false;
    expect((await call()).status).toBe(404);
    expect(h.joins).toEqual([]);
  });

  it("slows down a burst from one address", async () => {
    h.refusedPrefix = "waitlist-join:";
    expect(await call()).toMatchObject({ status: 429, body: { code: "RATE_LIMITED" } });
    expect(h.joins).toEqual([]);
  });

  it("refuses an invalid form and names the field", async () => {
    expect(await call(validBody({ email: "not-an-email" }))).toMatchObject({
      status: 400,
      body: { code: "INVALID_WAITLIST_REQUEST", field: "email" },
    });
    expect(await call(validBody({ consentVersion: "2020-01-01" }))).toMatchObject({
      status: 400,
      body: { code: "INVALID_WAITLIST_REQUEST", field: "consent" },
    });
    expect(await call(validBody({ phone: null }))).toMatchObject({
      status: 400,
      body: { code: "INVALID_WAITLIST_REQUEST", field: "smsConsent" },
    });
    expect(h.joins).toEqual([]);
  });

  it("slows down repeated joins for one email", async () => {
    h.refusedPrefix = "waitlist-join-email:";
    expect(await call()).toMatchObject({ status: 429, body: { code: "RATE_LIMITED" } });
    expect(h.rateKeys).toContain("waitlist-join-email:amel@example.com");
    expect(h.joins).toEqual([]);
  });

  it("passes the library's refusals through", async () => {
    h.result = { ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" };
    expect(await call()).toMatchObject({ status: 404, body: { code: "SHOWCASE_NOT_FOUND" } });
    h.result = { ok: false, status: 409, code: "WAITLIST_FULL" };
    expect(await call()).toMatchObject({ status: 409, body: { code: "WAITLIST_FULL" } });
    h.result = { ok: false, status: 400, code: "INVALID_MOTIFS" };
    expect(await call()).toMatchObject({ status: 400, body: { code: "INVALID_MOTIFS" } });
    expect(h.afterTasks).toEqual([]);
  });

  it("joins with the parsed form, emails the person and looks for a free time after the answer", async () => {
    expect(await call()).toEqual({ status: 200, body: { joined: true } });
    expect(h.joins).toHaveLength(1);
    expect(h.joins[0]).toMatchObject({ slug: "sassi", ip: "203.0.113.9" });
    expect(h.joins[0].form).toMatchObject({ email: "amel@example.com", smsConsent: true, locale: "en" });
    expect(h.emails).toEqual([]);
    expect(h.freed).toEqual([]);

    expect(h.afterTasks).toHaveLength(2);
    for (const task of h.afterTasks) await task();
    expect(h.emails).toEqual([
      {
        firstName: "Amel",
        email: "amel@example.com",
        professionalName: "Dre Sassi",
        service: "standard",
        sms: true,
        pageUrl: "https://www.jechemine.ca/sassi",
        leaveUrl: "https://www.jechemine.ca/liste-attente/quitter?t=abc",
        locale: "en",
      },
    ]);
    expect(h.freed).toEqual([PRO]);
  });

  it("answers the same when the address already waits, and sends nothing", async () => {
    h.result = { ok: true, created: false, professionalId: PRO };
    expect(await call()).toEqual({ status: 200, body: { joined: true } });
    expect(h.afterTasks).toEqual([]);
  });

  it("answers 500 when the join fails", async () => {
    h.throws = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call()).status).toBe(500);
    expect(h.afterTasks).toEqual([]);
  });
});

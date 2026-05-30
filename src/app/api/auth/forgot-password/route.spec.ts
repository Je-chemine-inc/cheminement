/**
 * User-initiated password reset request. Issues a hashed 1h token + sends a
 * /reset-password link, ALWAYS returns { ok: true } (no account-existence
 * leak), only for login-capable roles, and is rate-limited.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const rateLimit = vi.fn(() => ({ allowed: true, resetAt: Date.now() + 1000 }));
  const sendEmail = vi.fn().mockResolvedValue(true);
  const findOne = vi.fn();
  return { rateLimit, sendEmail, findOne };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  after: (fn: () => void) => {
    fn();
  },
}));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: h.rateLimit,
  getClientIp: () => "1.2.3.4",
  AuthRateLimits: { passwordReset: { limit: 5, windowMs: 1000 } },
}));
vi.mock("@/lib/account-init", () => ({
  generateUrlToken: () => "rawtoken",
  hashVerificationSecret: (t: string) => `hash:${t}`,
}));
vi.mock("@/lib/notifications", () => ({ sendPasswordSetupLinkEmail: h.sendEmail }));
vi.mock("@/models/User", () => ({ default: { findOne: h.findOne } }));

import { POST } from "@/app/api/auth/forgot-password/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (body: unknown): Res =>
  POST({
    json: async () => body,
    headers: { get: () => null },
    url: "https://app.test/api/auth/forgot-password",
  } as never) as unknown as Res;

const makeUser = (over: Record<string, unknown> = {}) => ({
  _id: "u1",
  email: "alex@example.com",
  firstName: "Alex",
  lastName: "Roy",
  language: "fr",
  role: "client",
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.rateLimit.mockReturnValue({ allowed: true, resetAt: Date.now() + 1000 });
});

describe("POST /api/auth/forgot-password", () => {
  it("issues a token + sends a reset link for a login-capable account", async () => {
    const user = makeUser();
    h.findOne.mockResolvedValueOnce(user);
    const res = await call({ email: "Alex@Example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(h.findOne).toHaveBeenCalledWith({ email: "alex@example.com" });
    expect((user as Record<string, unknown>).passwordResetTokenHash).toBe(
      "hash:rawtoken",
    );
    expect(user.save).toHaveBeenCalled();
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const arg = h.sendEmail.mock.calls[0][0];
    expect(arg.variant).toBe("reset");
    expect(arg.setupLink).toContain("/reset-password?uid=u1&token=rawtoken");
  });

  it("returns ok without sending for an unknown email (no enumeration)", async () => {
    h.findOne.mockResolvedValueOnce(null);
    const res = await call({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("ignores passwordless lead shells (guest/prospect)", async () => {
    const guest = makeUser({ role: "guest" });
    h.findOne.mockResolvedValueOnce(guest);
    const res = await call({ email: "alex@example.com" });
    expect(res.status).toBe(200);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(guest.save).not.toHaveBeenCalled();
  });

  it("returns ok for an invalid email without touching the DB", async () => {
    const res = await call({ email: "not-an-email" });
    expect(res.status).toBe(200);
    expect(h.findOne).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("rate-limits (429)", async () => {
    h.rateLimit.mockReturnValueOnce({ allowed: false, resetAt: Date.now() + 5000 });
    const res = await call({ email: "alex@example.com" });
    expect(res.status).toBe(429);
    expect(h.findOne).not.toHaveBeenCalled();
  });
});

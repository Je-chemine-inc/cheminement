/**
 * §4.3 follow-up: admin "Valider" activation is now full 2FA. After the pro
 * confirms the email link, verify-email must chain into the SMS step (return a
 * phoneStepToken) and NOT auto-activate — an admin-approved pro only goes
 * "active" after SMS (in verify-phone). Clients are unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const HEX = "a".repeat(64);

const h = vi.hoisted(() => {
  const findById = vi.fn();
  const store: { user: Record<string, unknown> | null } = { user: null };
  return { findById, store };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ allowed: true, resetAt: Date.now() + 1000 }),
  getClientIp: () => "1.2.3.4",
  AuthRateLimits: { verifyEmail: { limit: 10, windowMs: 1000 } },
}));
vi.mock("@/lib/account-init", () => ({
  EMAIL_VERIFY_TTL_MS: 600000,
  PHONE_STEP_TTL_MS: 600000,
  generatePhoneStepToken: () => "PHONESTEP",
  hashVerificationSecret: () => HEX,
}));
vi.mock("@/models/User", () => ({ default: { findById: h.findById } }));

import { POST } from "@/app/api/auth/account/verify-email/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;
const call = (): Res =>
  POST({
    json: async () => ({ userId: "u1", token: "rawtok" }),
  } as never) as unknown as Res;

const makeUser = (over: Record<string, unknown> = {}) => ({
  _id: "u1",
  accountSecurityVersion: 1,
  emailVerified: undefined,
  phoneVerifiedAt: undefined,
  phone: "5145551234",
  role: "client",
  adminApproved: false,
  verificationEmailTokenHash: HEX,
  verificationEmailExpires: new Date(Date.now() + 100000),
  status: "pending",
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verify-email — admin activation is full 2FA", () => {
  it("routes an admin-approved professional into the SMS step (no auto-activate)", async () => {
    const user = makeUser({ role: "professional", adminApproved: true });
    h.store.user = user;
    h.findById.mockResolvedValueOnce(user);

    const res = await call();
    expect(res.status).toBe(200);
    expect(res.body.phoneStepToken).toBe("PHONESTEP");
    expect(res.body.phoneAlreadyVerified).toBe(false);
    // KEY: the pro is NOT activated by the email step alone.
    expect(user.status).toBe("pending");
    expect(user.emailVerified).toBeInstanceOf(Date);
  });

  it("still chains the SMS step for a client", async () => {
    const user = makeUser({ role: "client" });
    h.findById.mockResolvedValueOnce(user);
    const res = await call();
    expect(res.body.phoneStepToken).toBe("PHONESTEP");
    expect(user.status).toBe("pending");
  });

  it("activates directly when the phone is already verified (re-click)", async () => {
    const user = makeUser({
      role: "professional",
      adminApproved: true,
      phoneVerifiedAt: new Date(),
    });
    h.findById.mockResolvedValueOnce(user);
    const res = await call();
    expect(res.body.phoneStepToken).toBeUndefined();
    expect(user.status).toBe("active");
  });
});

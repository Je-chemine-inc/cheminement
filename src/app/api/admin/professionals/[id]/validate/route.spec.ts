/**
 * POST /api/admin/professionals/[id]/validate — when the approval leaves the
 * account active, the professional's approved products go back on sale at once
 * (spec 003 phase 5); while the account still waits for its verification they
 * are left alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO_ID = "b2b2b2b2b2b2b2b2b2b2b2b2";
const ADMIN_SESSION = { user: { id: "a1a1a1a1a1a1a1a1a1a1a1a1", role: "admin" } };

type Doc = Record<string, unknown> & { save: ReturnType<typeof vi.fn> };

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  user: null as unknown,
  syncProfessionalProducts: vi.fn(),
  sendVerification: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/User", () => ({ default: { findById: async () => h.user } }));
vi.mock("@/models/Admin", () => ({
  default: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
}));
vi.mock("@/lib/account-init", () => ({
  EMAIL_VERIFY_TTL_MS: 60_000,
  generateUrlToken: () => "token",
  hashVerificationSecret: (value: string) => `hash:${value}`,
}));
vi.mock("@/lib/notifications", () => ({ sendAccountEmailVerificationEmail: h.sendVerification }));
vi.mock("@/lib/products", () => ({ syncProfessionalProducts: h.syncProfessionalProducts }));

import { POST } from "@/app/api/admin/professionals/[id]/validate/route";

const professional = (over: Record<string, unknown> = {}): Doc => ({
  _id: { toString: () => PRO_ID },
  role: "professional",
  status: "inactive",
  firstName: "Léa",
  lastName: "Sassi",
  email: "lea@example.com",
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const call = (body: unknown) => {
  h.getServerSession.mockResolvedValueOnce(ADMIN_SESSION);
  return POST(
    { json: async () => body, url: "http://localhost:3000/api/admin/professionals/x/validate" } as never,
    { params: Promise.resolve({ id: PRO_ID }) },
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.syncProfessionalProducts.mockResolvedValue(1);
  h.sendVerification.mockResolvedValue(true);
});

describe("POST /api/admin/professionals/[id]/validate — products", () => {
  it("puts an activated professional's products back on sale, once the account is saved", async () => {
    const doc = professional();
    h.user = doc;
    const res = await call({ skipEmail: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "active" });
    expect(h.syncProfessionalProducts).toHaveBeenCalledWith(PRO_ID);
    expect(doc.save.mock.invocationCallOrder[0]).toBeLessThan(h.syncProfessionalProducts.mock.invocationCallOrder[0]);
  });

  it("syncs too when an already verified professional is activated", async () => {
    h.user = professional({ status: "pending", emailVerified: new Date(), phoneVerifiedAt: new Date() });
    const res = await call({});
    expect(res.body).toMatchObject({ status: "active" });
    expect(h.syncProfessionalProducts).toHaveBeenCalledWith(PRO_ID);
  });

  it("leaves products alone while the account waits for its verification", async () => {
    h.user = professional({ status: "pending" });
    const res = await call({});
    expect(res.body).toMatchObject({ status: "pending", verificationEmailSent: true });
    expect(h.syncProfessionalProducts).not.toHaveBeenCalled();
  });

  it("still answers when the products sync fails", async () => {
    h.user = professional();
    h.syncProfessionalProducts.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call({ skipEmail: true });
    expect(res.status).toBe(200);
  });
});

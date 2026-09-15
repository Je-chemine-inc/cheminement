/**
 * An admin changing a professional's account status in the user editor takes
 * their products off sale, or puts them back, at once (spec 003 phase 5): a
 * product's stored status follows its professional's account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";
const USER_ID = "b2b2b2b2b2b2b2b2b2b2b2b2";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  userFindById: vi.fn(),
  userFindByIdAndUpdate: vi.fn(),
  profileUpdate: vi.fn(),
  syncProfessionalProducts: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: (fn: () => unknown) => {
    fn();
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/intake-rematch", () => ({ rematchWaitingDemandesForReenabledPro: vi.fn() }));
vi.mock("@/lib/products", () => ({ syncProfessionalProducts: h.syncProfessionalProducts }));
vi.mock("@/models/User", () => ({
  default: { findById: () => h.userFindById(), findByIdAndUpdate: h.userFindByIdAndUpdate },
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: async () => null }) }),
    findOneAndUpdate: () => h.profileUpdate(),
  },
}));
vi.mock("@/models/Admin", () => ({
  default: { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) },
}));
vi.mock("@/models/MedicalProfile", () => ({ default: { findOneAndUpdate: vi.fn() } }));
vi.mock("@/models/Appointment", () => ({ default: {} }));
vi.mock("@/models/ClientDocument", () => ({ default: {} }));
vi.mock("@/models/ClientReceipt", () => ({ default: {} }));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({ default: {} }));
vi.mock("@/models/Review", () => ({ default: {} }));
vi.mock("@/models/Resource", () => ({ ResourcePurchase: {} }));
vi.mock("@/models/ResourceEntitlement", () => ({ default: {} }));
vi.mock("@/models/Conversation", () => ({ default: {} }));
vi.mock("@/models/Message", () => ({ default: {} }));

import { PUT } from "@/app/api/admin/users/[id]/route";

const callPut = (body: Record<string, unknown>) => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: ADMIN_ID, role: "admin" } });
  return PUT({ json: async () => body } as never, {
    params: Promise.resolve({ id: USER_ID }),
  }) as unknown as Promise<{ status: number }>;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.userFindById.mockResolvedValue({ role: "professional", status: "active" });
  h.userFindByIdAndUpdate.mockResolvedValue({});
  h.profileUpdate.mockResolvedValue({});
  h.syncProfessionalProducts.mockResolvedValue(1);
});

describe("PUT /api/admin/users/[id] — a professional's status and their products", () => {
  it("syncs the professional's products once the new status is saved", async () => {
    const res = await callPut({ status: "inactive" });
    expect(res.status).toBe(200);
    expect(h.syncProfessionalProducts).toHaveBeenCalledWith(USER_ID);
    expect(h.userFindByIdAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      h.syncProfessionalProducts.mock.invocationCallOrder[0],
    );
  });

  it("leaves products alone when the status is not part of the change", async () => {
    await callPut({ firstName: "Léa", bio: "Psychologue" });
    expect(h.syncProfessionalProducts).not.toHaveBeenCalled();
  });

  it("leaves products alone for a client", async () => {
    h.userFindById.mockResolvedValue({ role: "client", status: "active" });
    await callPut({ status: "inactive" });
    expect(h.syncProfessionalProducts).not.toHaveBeenCalled();
  });

  it("still saves the account when the products sync fails", async () => {
    h.syncProfessionalProducts.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callPut({ status: "inactive" });
    expect(res.status).toBe(200);
    expect(h.userFindByIdAndUpdate).toHaveBeenCalled();
  });
});

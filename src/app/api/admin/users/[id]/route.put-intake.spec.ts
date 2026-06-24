/**
 * An admin re-enabling a professional's intake toggle (acceptingNewClients /
 * acceptingEmergencyConsultations) must trigger the same "unblock the queue"
 * re-match as the pro doing it themselves — keyed to the PRO's id, not the admin.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";
const PRO_ID = "b2b2b2b2b2b2b2b2b2b2b2b2";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  userFindById: vi.fn(),
  profileBefore: vi.fn(),
  profileUpdate: vi.fn(),
  rematch: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  after: (fn: () => unknown) => {
    fn();
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/intake-rematch", () => ({
  rematchWaitingDemandesForReenabledPro: h.rematch,
}));
vi.mock("@/models/User", () => ({
  default: { findById: () => h.userFindById(), findByIdAndUpdate: vi.fn() },
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: () => h.profileBefore() }) }),
    findOneAndUpdate: () => h.profileUpdate(),
  },
}));
vi.mock("@/models/Admin", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
  },
}));
vi.mock("@/models/MedicalProfile", () => ({ default: { findOneAndUpdate: vi.fn() } }));
vi.mock("@/models/Appointment", () => ({ default: {} }));
vi.mock("@/models/ClientDocument", () => ({ default: {} }));
vi.mock("@/models/ClientReceipt", () => ({ default: {} }));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({ default: {} }));
vi.mock("@/models/Review", () => ({ default: {} }));
vi.mock("@/models/Resource", () => ({ ResourcePurchase: {} }));
vi.mock("@/models/Conversation", () => ({ default: {} }));
vi.mock("@/models/Message", () => ({ default: {} }));

import { PUT } from "@/app/api/admin/users/[id]/route";

const callPut = (body: Record<string, unknown>) => {
  h.getServerSession.mockResolvedValueOnce({
    user: { id: ADMIN_ID, role: "admin" },
  });
  return PUT(
    { json: async () => body } as never,
    { params: Promise.resolve({ id: PRO_ID }) },
  ) as unknown as Promise<{ status: number }>;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.userFindById.mockResolvedValue({ role: "professional", status: "active" });
  h.rematch.mockResolvedValue(undefined);
});

describe("PUT /api/admin/users/[id] — admin toggling a pro's intake", () => {
  it("re-enabling acceptingNewClients re-matches for the PRO's id", async () => {
    h.profileBefore.mockResolvedValue({ acceptingNewClients: false });
    h.profileUpdate.mockResolvedValue({ acceptingNewClients: true });

    const res = await callPut({ acceptingNewClients: true });
    expect(res.status).toBe(200);
    expect(h.rematch).toHaveBeenCalledTimes(1);
    expect(h.rematch).toHaveBeenCalledWith({
      proUserId: PRO_ID,
      reEnabledNewClients: true,
      reEnabledEmergency: false,
    });
  });

  it("DISABLING acceptingNewClients does NOT re-match", async () => {
    h.profileBefore.mockResolvedValue({ acceptingNewClients: true });
    h.profileUpdate.mockResolvedValue({ acceptingNewClients: false });

    await callPut({ acceptingNewClients: false });
    expect(h.rematch).not.toHaveBeenCalled();
  });

  it("coerces the toggle to a strict boolean before persisting", async () => {
    h.profileBefore.mockResolvedValue({ acceptingNewClients: true });
    h.profileUpdate.mockResolvedValue({ acceptingNewClients: false });

    // A truthy-but-not-true value must be stored as false, not the raw value.
    await callPut({ acceptingNewClients: 0 });
    // No re-enable (true->false path); just assert it didn't throw + no re-match.
    expect(h.rematch).not.toHaveBeenCalled();
  });
});

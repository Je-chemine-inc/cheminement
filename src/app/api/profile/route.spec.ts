/**
 * Regression for PUT /api/profile — re-enabling an intake toggle must re-run the
 * matcher on demandes that piled up unmatched in the general pool while the pro
 * had intake OFF, so the queue is no longer "stuck" after reactivation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "p1p1p1p1p1p1p1p1p1p1p1p1";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  profileFindOne: vi.fn(),
  profileFindOneAndUpdate: vi.fn(),
  apptFind: vi.fn(),
  apptClaim: vi.fn(),
  route: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  // Make the deferred re-match awaitable so assertions are deterministic.
  after: (fn: () => unknown) => {
    h.afterTasks.push(Promise.resolve().then(fn));
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/legal", () => ({
  LEGAL_VERSIONS: { professionalTerms: "1" },
}));
vi.mock("@/lib/notifications", () => ({
  sendProfessionalProfileCompletedEmail: vi.fn(),
}));
vi.mock("@/lib/appointment-routing", () => ({
  routeAppointmentToProfessionals: h.route,
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: () => h.profileFindOne(),
    findOneAndUpdate: (...args: unknown[]) => h.profileFindOneAndUpdate(...args),
  },
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.apptFind(filter);
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        select() {
          return this;
        },
        lean: () => Promise.resolve([{ _id: "a1" }, { _id: "a2" }]),
      };
    },
    findOneAndUpdate: (...args: unknown[]) => h.apptClaim(...args),
  },
}));

import { PUT } from "@/app/api/profile/route";

const callPut = (body: Record<string, unknown>, role = "professional") => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: USER_ID, role } });
  return PUT({ json: async () => body } as never) as unknown as Promise<{
    status: number;
  }>;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.afterTasks = [];
  h.route.mockResolvedValue({ success: true });
  // The atomic reset-to-pending claim succeeds (truthy) by default.
  h.apptClaim.mockResolvedValue({ _id: "claimed", routingStatus: "pending" });
});

describe("PUT /api/profile — re-match on intake re-enable", () => {
  it("re-enabling acceptingNewClients (false→true) re-routes waiting demandes", async () => {
    h.profileFindOne.mockResolvedValue({
      acceptingNewClients: false,
      profileCompleted: true,
    });
    h.profileFindOneAndUpdate.mockResolvedValue({
      acceptingNewClients: true,
      profileCompleted: true,
    });

    await callPut({ acceptingNewClients: true });
    await Promise.all(h.afterTasks);

    expect(h.apptFind).toHaveBeenCalledTimes(1);
    const filter = h.apptFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.status).toBe("pending");
    expect(filter.professionalId).toBeNull();
    expect(filter.routingStatus).toEqual({ $in: ["general", "pending"] });
    expect(filter.isEmergency).toBeUndefined();

    // Each waiting demande is atomically reset to "pending" (so the matcher,
    // which hard-skips non-pending, can act), cascade reopened, this pro pulled
    // from refusedBy — THEN re-run through the matcher.
    expect(h.apptClaim).toHaveBeenCalledTimes(2);
    const [, claimUpdate] = h.apptClaim.mock.calls[0] as [
      unknown,
      Record<string, Record<string, unknown>>,
    ];
    expect(claimUpdate.$set.routingStatus).toBe("pending");
    expect(claimUpdate.$set.cascadeAttempts).toBe(0);
    expect(claimUpdate.$pull).toEqual({ refusedBy: USER_ID });
    expect(h.route).toHaveBeenCalledTimes(2);
  });

  it("skips the matcher when the atomic claim loses the race (already taken)", async () => {
    h.profileFindOne.mockResolvedValue({
      acceptingNewClients: false,
      profileCompleted: true,
    });
    h.profileFindOneAndUpdate.mockResolvedValue({
      acceptingNewClients: true,
      profileCompleted: true,
    });
    h.apptClaim.mockResolvedValue(null); // another caller already claimed it

    await callPut({ acceptingNewClients: true });
    await Promise.all(h.afterTasks);

    expect(h.apptClaim).toHaveBeenCalledTimes(2);
    expect(h.route).not.toHaveBeenCalled();
  });

  it("DISABLING acceptingNewClients (true→false) does NOT re-route", async () => {
    h.profileFindOne.mockResolvedValue({
      acceptingNewClients: true,
      profileCompleted: true,
    });
    h.profileFindOneAndUpdate.mockResolvedValue({
      acceptingNewClients: false,
      profileCompleted: true,
    });

    await callPut({ acceptingNewClients: false });
    await Promise.all(h.afterTasks);

    expect(h.apptFind).not.toHaveBeenCalled();
    expect(h.route).not.toHaveBeenCalled();
  });

  it("emergency-only re-enable (newClients already on) scopes to urgent demandes", async () => {
    h.profileFindOne.mockResolvedValue({
      acceptingEmergencyConsultations: false,
      acceptingNewClients: true,
      profileCompleted: true,
    });
    h.profileFindOneAndUpdate.mockResolvedValue({
      acceptingEmergencyConsultations: true,
      acceptingNewClients: true,
      profileCompleted: true,
    });

    await callPut({ acceptingEmergencyConsultations: true });
    await Promise.all(h.afterTasks);

    const filter = h.apptFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.isEmergency).toBe(true);
  });

  it("re-enabling emergency while newClients is OFF does nothing (still ineligible)", async () => {
    h.profileFindOne.mockResolvedValue({
      acceptingEmergencyConsultations: false,
      acceptingNewClients: false,
      profileCompleted: true,
    });
    h.profileFindOneAndUpdate.mockResolvedValue({
      acceptingEmergencyConsultations: true,
      acceptingNewClients: false,
      profileCompleted: true,
    });

    await callPut({ acceptingEmergencyConsultations: true });
    await Promise.all(h.afterTasks);

    expect(h.route).not.toHaveBeenCalled();
  });
});

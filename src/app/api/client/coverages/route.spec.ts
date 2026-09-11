import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec 002 phase 6 — a client sees who pays their sessions and how many are
 * used. Nothing while organization billing is off (they would be charged
 * anyway), and never the organization's rate, case number or consent record.
 */

const CLIENT = "0123456789abcdef01234561";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  enabled: true,
  coverageFilter: null as unknown,
  coverages: [] as Record<string, unknown>[],
  bookings: [] as Record<string, unknown>[],
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/session-payer-plan", () => ({ isOrganizationBillingEnabled: async () => h.enabled }));
vi.mock("@/models/OrganizationCoverage", () => ({
  default: {
    find: (filter: unknown) => {
      h.coverageFilter = filter;
      return { select: () => ({ sort: () => ({ lean: async () => h.coverages }) }) };
    },
  },
}));
vi.mock("@/models/Organization", () => ({
  default: { find: () => ({ select: () => ({ lean: async () => [{ _id: "org1", name: "PAE Desjardins" }] }) }) },
}));
vi.mock("@/models/Appointment", () => ({
  default: { find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => h.bookings }) }) }) }) },
}));

import { GET } from "./route";

type Res = { status: number; body: { coverages: Record<string, unknown>[] } };

beforeEach(() => {
  h.session = { user: { id: CLIENT } };
  h.enabled = true;
  h.coverageFilter = null;
  h.coverages = [
    {
      _id: "cov1",
      beneficiaryKey: "self",
      organizationId: "org1",
      mode: "full",
      maxSessions: 10,
      consumedAppointmentIds: ["a1", "a2", "a3"],
      status: "active",
      caseNumber: "SECRET-CASE",
      rateCentsOverride: 9000,
      consent: { status: "given", note: "note interne" },
    },
  ];
  h.bookings = [];
});

describe("GET /api/client/coverages", () => {
  it("requires a signed-in user", async () => {
    h.session = null;
    expect(((await GET()) as unknown as Res).status).toBe(401);
  });

  it("shows nothing while organization billing is off", async () => {
    h.enabled = false;
    const res = (await GET()) as unknown as Res;
    expect(res.body.coverages).toEqual([]);
    expect(h.coverageFilter).toBeNull();
  });

  it("only the client's own coverages, as « 3/10 », without rate, case number or consent", async () => {
    const res = (await GET()) as unknown as Res;
    expect(h.coverageFilter).toEqual({ clientId: CLIENT, status: { $in: ["active", "exhausted"] } });
    expect(res.body.coverages).toEqual([
      {
        id: "cov1",
        organizationName: "PAE Desjardins",
        forLovedOne: null,
        mode: "full",
        used: 3,
        max: 10,
        status: "active",
        validUntil: null,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET-CASE|9000|note interne|consent/);
  });

  it("names a loved one as the client typed it, not the folded key", async () => {
    h.coverages = [{ ...h.coverages[0], beneficiaryKey: "loved-one:leo cote" }];
    h.bookings = [{ bookingFor: "loved-one", lovedOneInfo: { firstName: "Léo", lastName: "Côté" } }];
    const res = (await GET()) as unknown as Res;
    expect(res.body.coverages[0].forLovedOne).toBe("Léo Côté");
  });
});

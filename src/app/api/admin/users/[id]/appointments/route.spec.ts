/**
 * GET /api/admin/users/[id]/appointments feeds the patient file's payer
 * choice. The client pays by default: « Selon la couverture » is offered only
 * where a coverage applies, and only while organization billing is on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT = "c1c1c1c1c1c1c1c1c1c1c1c1";

const h = vi.hoisted(() => ({
  enabled: false,
  appointments: [] as Array<Record<string, unknown>>,
  coverages: [] as Array<Record<string, unknown>>,
  coverageQuery: vi.fn(),
}));

const chain = (value: unknown) => {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    limit: () => q,
    lean: async () => value,
  };
  return q;
};

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "admin1", role: "admin" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/session-payer-plan", () => ({ isOrganizationBillingEnabled: async () => h.enabled }));
vi.mock("@/models/Admin", () => ({
  default: { findOne: () => chain({ permissions: { manageBilling: true } }) },
}));
vi.mock("@/models/Appointment", () => ({ default: { find: () => chain(h.appointments) } }));
vi.mock("@/models/OrganizationCoverage", () => ({
  default: {
    find: (filter: unknown) => {
      h.coverageQuery(filter);
      return chain(h.coverages);
    },
  },
}));

import { GET } from "./route";

const apt = (id: string, over: Record<string, unknown> = {}) => ({
  _id: { toString: () => id },
  clientId: { _id: { toString: () => CLIENT }, firstName: "Léa", lastName: "Roy", email: "lea@example.com" },
  professionalId: null,
  status: "scheduled",
  bookingFor: "self",
  payment: { price: 175, status: "pending", method: "card" },
  ...over,
});

const list = async () =>
  ((await GET({} as never, { params: Promise.resolve({ id: CLIENT }) })) as unknown as {
    body: { appointments: Array<{ id: string; coverageApplies: boolean }>; organizationBilling: boolean };
  }).body;

beforeEach(() => {
  vi.clearAllMocks();
  h.enabled = false;
  h.coverages = [];
  h.appointments = [
    apt("self-1"),
    apt("loved-1", { bookingFor: "loved-one", lovedOneInfo: { firstName: "Zoé", lastName: "Roy" } }),
  ];
});

describe("GET /api/admin/users/[id]/appointments — the payer choice's default", () => {
  it("while organization billing is off: the client pays, no coverage is even looked up", async () => {
    h.coverages = [{ clientId: CLIENT, beneficiaryKey: "self" }];
    const body = await list();
    expect(body.organizationBilling).toBe(false);
    expect(body.appointments.every((a) => a.coverageApplies === false)).toBe(true);
    expect(h.coverageQuery).not.toHaveBeenCalled();
  });

  it("with billing on, a session is under coverage only for the covered person", async () => {
    h.enabled = true;
    h.coverages = [{ clientId: CLIENT, beneficiaryKey: "self" }];
    const body = await list();
    expect(body.organizationBilling).toBe(true);
    const byId = Object.fromEntries(body.appointments.map((a) => [a.id, a.coverageApplies]));
    expect(byId).toEqual({ "self-1": true, "loved-1": false });
    expect(h.coverageQuery).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: { $in: [CLIENT] }, status: "active" }),
    );
  });

  it("with billing on and no coverage, every session defaults to the client", async () => {
    h.enabled = true;
    const body = await list();
    expect(body.appointments.every((a) => a.coverageApplies === false)).toBe(true);
  });
});

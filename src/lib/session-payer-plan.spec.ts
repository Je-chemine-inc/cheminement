import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The closure-side planner (spec 002): when it steps aside, when it reserves a
 * cap slot, and when it holds a session for a human.
 */

const h = vi.hoisted(() => ({
  flag: true as boolean,
  apt: null as Record<string, unknown> | null,
  coverage: null as Record<string, unknown> | null,
  org: null as Record<string, unknown> | null,
  reserve: vi.fn(),
  release: vi.fn(async () => true),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/PlatformSettings", () => ({
  default: {
    findOne: () => ({
      select: () => ({ lean: async () => ({ organizationBillingEnabled: h.flag }) }),
    }),
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: async () => h.apt }) }),
  },
}));
vi.mock("@/models/Organization", () => ({
  default: { findById: vi.fn(async () => h.org) },
}));
vi.mock("@/lib/organization-coverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/organization-coverage")>();
  return {
    ...actual,
    findApplicableCoverage: vi.fn(async () => h.coverage),
    reserveCoverageSlot: h.reserve,
    releaseCoverageSlot: h.release,
  };
});

import { planSessionPayers } from "@/lib/session-payer-plan";

const ORG_ID = "0123456789abcdef01234567";
const COV_ID = "0123456789abcdef01234568";
const APT_ID = "0123456789abcdef01234569";

const args = () => ({
  appointmentId: APT_ID,
  outcome: "completed" as const,
  listPriceCents: 12000,
  proShareRatio: 0.9,
  now: new Date("2026-09-11T15:00:00Z"),
});

beforeEach(() => {
  h.flag = true;
  h.apt = { clientId: "client-1", bookingFor: "self", date: new Date("2026-09-10T12:00:00Z") };
  h.coverage = {
    _id: COV_ID,
    organizationId: ORG_ID,
    mode: "full",
    caseNumber: "PAE-4471",
    consent: { status: "given" },
    consumedAppointmentIds: [],
  };
  h.org = { _id: ORG_ID, name: "PAE Desjardins", gapPolicy: "client_copay", active: true };
  h.reserve.mockReset();
  h.release.mockClear();
});

describe("planSessionPayers", () => {
  it("steps aside entirely while the feature flag is off", async () => {
    h.flag = false;
    expect(await planSessionPayers(args())).toBeNull();
  });

  it("steps aside when no third party is involved (today's closure runs)", async () => {
    h.coverage = null;
    expect(await planSessionPayers(args())).toBeNull();
  });

  it("plans an organization-paid session and snapshots who, what and which case", async () => {
    const r = await planSessionPayers(args());
    expect(r?.plan.kind).toBe("organization");
    expect(r?.snapshot).toMatchObject({
      kind: "organization",
      orgAmountCents: 12000,
      clientAmountCents: 0,
      caseNumber: "PAE-4471",
      orgStatus: "unbilled",
    });
    expect(String(r?.snapshot.organizationId)).toBe(ORG_ID);
  });

  it("reserves a slot on a capped coverage and reports it for rollback", async () => {
    h.coverage = { ...h.coverage, maxSessions: 6 };
    h.reserve.mockResolvedValue({ granted: true, used: 3, max: 6, exhaustedNow: false });
    const r = await planSessionPayers(args());
    expect(h.reserve).toHaveBeenCalledWith(COV_ID, APT_ID);
    expect(r?.reservedSlot).toBe(true);
    expect(r?.plan.kind).toBe("organization");
  });

  it("bills the client when the cap is reached", async () => {
    h.coverage = { ...h.coverage, maxSessions: 6 };
    h.reserve.mockResolvedValue({ granted: false });
    const r = await planSessionPayers(args());
    expect(r?.plan.reason).toBe("cap_exhausted");
    expect(r?.reservedSlot).toBe(false);
  });

  it("never reserves a slot for a no-show", async () => {
    h.coverage = { ...h.coverage, maxSessions: 6 };
    await planSessionPayers({ ...args(), outcome: "no_show" });
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("holds the session when the coverage's organization was archived", async () => {
    h.org = { ...h.org, active: false };
    const r = await planSessionPayers(args());
    expect(r?.plan.state).toBe("awaiting_decision");
    expect(r?.plan.reason).toBe("organization_without_coverage");
  });

  it("holds the session for a client declaration nobody has confirmed", async () => {
    h.coverage = null;
    h.apt = { ...h.apt, payerDeclaration: { status: "pending", organizationName: "PAE X" } };
    const r = await planSessionPayers(args());
    expect(r?.plan.state).toBe("awaiting_decision");
    expect(r?.plan.reason).toBe("declaration_pending");
  });

  it("honours an admin override to the client", async () => {
    h.apt = { ...h.apt, billingOverride: { payer: "client" } };
    const r = await planSessionPayers(args());
    expect(r?.plan.kind).toBe("client");
    expect(r?.plan.reason).toBe("client_override");
  });
});

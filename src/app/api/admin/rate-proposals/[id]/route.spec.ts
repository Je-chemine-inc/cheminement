/**
 * Admin decision on a professional rate-change request.
 *
 * The rules that matter: only an admin may decide, accepting writes only the
 * professional's rate (never the client price), a decided proposal cannot be
 * re-decided, and two admins racing cannot both apply the change.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PROPOSAL = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PRO = "bbbbbbbbbbbbbbbbbbbbbbbb";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  proposalFindById: vi.fn(),
  proposalClaim: vi.fn(),
  profileFindOne: vi.fn(),
  profileUpdate: vi.fn(),
  settingsFindOne: vi.fn(),
  sendDecision: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  // Make the deferred notification awaitable so assertions stay deterministic.
  after: (fn: () => unknown) => {
    h.afterTasks.push(Promise.resolve().then(fn));
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications", () => ({
  sendRateProposalDecisionEmail: (...a: unknown[]) => h.sendDecision(...a),
}));
vi.mock("@/lib/pricing", () => ({
  getTherapyTypeLabel: (t: string) => t,
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => ({
      select: () =>
        Promise.resolve({
          firstName: "Sam",
          lastName: "Pro",
          email: "pro@example.com",
          language: "fr",
        }),
    }),
  },
}));
vi.mock("@/models/ProfessionalRateProposal", () => ({
  default: {
    findById: (...a: unknown[]) => h.proposalFindById(...a),
    findOneAndUpdate: (...a: unknown[]) => h.proposalClaim(...a),
  },
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: (...a: unknown[]) => h.profileFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => h.profileUpdate(...a),
  },
}));
vi.mock("@/models/PlatformSettings", () => ({
  default: { findOne: (...a: unknown[]) => h.settingsFindOne(...a) },
}));

import { PATCH } from "@/app/api/admin/rate-proposals/[id]/route";

type Res = Promise<{ status: number; body: unknown }>;

const call = (body: unknown, id = PROPOSAL): Res =>
  PATCH({ json: async () => body } as never, {
    params: Promise.resolve({ id }),
  } as never) as unknown as Res;

beforeEach(() => {
  vi.clearAllMocks();
  h.afterTasks = [];
  h.sendDecision.mockResolvedValue(true);
  h.getServerSession.mockResolvedValue({ user: { id: "adm", role: "admin" } });
  h.proposalFindById.mockResolvedValue({
    _id: PROPOSAL,
    professionalId: PRO,
    therapyType: "solo",
    proposedRate: 165,
    status: "pending",
  });
  h.proposalClaim.mockResolvedValue({
    _id: PROPOSAL,
    status: "accepted",
    proposedRate: 165,
    therapyType: "solo",
  });
  h.profileFindOne.mockResolvedValue({
    rates: { solo: { clientPrice: 175, professionalRate: 150 } },
  });
  h.profileUpdate.mockResolvedValue({});
  h.settingsFindOne.mockResolvedValue({
    defaultPricing: { solo: 175, couple: 200, group: 170 },
  });
});

describe("auth gate", () => {
  it.each([
    ["the professional themselves", { user: { id: PRO, role: "professional" } }],
    ["a client", { user: { id: "c", role: "client" } }],
    ["anonymous", null],
  ])("rejects %s", async (_l, session) => {
    h.getServerSession.mockResolvedValue(session);

    const res = await call({ decision: "accept" });

    expect(res.status).toBe(401);
    // KEY: a professional must not be able to approve their own raise.
    expect(h.proposalClaim).not.toHaveBeenCalled();
    expect(h.profileUpdate).not.toHaveBeenCalled();
  });

  it("rejects a malformed proposal id", async () => {
    expect((await call({ decision: "accept" }, "nope")).status).toBe(400);
  });

  it("rejects an unknown decision verb", async () => {
    const res = await call({ decision: "maybe" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "INVALID_DECISION" });
    expect(h.proposalClaim).not.toHaveBeenCalled();
  });
});

describe("accepting", () => {
  it("writes ONLY the professional rate", async () => {
    const res = await call({ decision: "accept" });

    expect(res.status).toBe(200);
    const [, update] = h.profileUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, number> },
    ];
    expect(update.$set).toEqual({ "rates.solo.professionalRate": 165 });
    // KEY: the client price is the platform's to set, never the pro's to move.
    expect(JSON.stringify(update)).not.toContain("clientPrice");
  });

  it("claims the proposal atomically on status pending", async () => {
    await call({ decision: "accept" });

    const [filter] = h.proposalClaim.mock.calls[0] as [Record<string, unknown>];
    expect(filter).toMatchObject({ _id: PROPOSAL, status: "pending" });
  });

  it("does not apply the rate when another admin won the race", async () => {
    h.proposalClaim.mockResolvedValue(null);

    const res = await call({ decision: "accept" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "NOT_PENDING" });
    expect(h.profileUpdate).not.toHaveBeenCalled();
  });

  it("re-checks the ceiling at decision time", async () => {
    // Valid when submitted, but the client price dropped since.
    h.profileFindOne.mockResolvedValue({
      rates: { solo: { clientPrice: 150, professionalRate: 140 } },
    });

    const res = await call({ decision: "accept" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "RATE_EXCEEDS_CLIENT_PRICE" });
    expect(h.proposalClaim).not.toHaveBeenCalled();
    expect(h.profileUpdate).not.toHaveBeenCalled();
  });

  it("falls back to the platform default price for the ceiling check", async () => {
    h.profileFindOne.mockResolvedValue({ rates: {} });
    h.settingsFindOne.mockResolvedValue({ defaultPricing: { solo: 160 } });

    // 165 > 160 → refused.
    const res = await call({ decision: "accept" });
    expect(res.status).toBe(409);
  });

  it("accepts a rate equal to the client price (zero spread)", async () => {
    h.proposalFindById.mockResolvedValue({
      _id: PROPOSAL,
      professionalId: PRO,
      therapyType: "solo",
      proposedRate: 175,
      status: "pending",
    });
    h.proposalClaim.mockResolvedValue({
      _id: PROPOSAL,
      status: "accepted",
      proposedRate: 175,
      therapyType: "solo",
    });

    expect((await call({ decision: "accept" })).status).toBe(200);
  });
});

describe("rejecting", () => {
  it("does not touch the professional's rate", async () => {
    h.proposalClaim.mockResolvedValue({
      _id: PROPOSAL,
      status: "rejected",
      proposedRate: 165,
      therapyType: "solo",
    });

    const res = await call({ decision: "reject", decisionNote: "Trop élevé" });

    expect(res.status).toBe(200);
    expect(h.profileUpdate).not.toHaveBeenCalled();
  });

  it("stores the decision note", async () => {
    h.proposalClaim.mockResolvedValue({
      _id: PROPOSAL,
      status: "rejected",
      proposedRate: 165,
      therapyType: "solo",
    });

    await call({ decision: "reject", decisionNote: "  Trop élevé  " });

    const [, update] = h.proposalClaim.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.decisionNote).toBe("Trop élevé");
    expect(update.$set.status).toBe("rejected");
  });

  it("skips the ceiling check when rejecting", async () => {
    // A rate above the client price must still be rejectable.
    h.profileFindOne.mockResolvedValue({
      rates: { solo: { clientPrice: 100 } },
    });
    h.proposalClaim.mockResolvedValue({
      _id: PROPOSAL,
      status: "rejected",
      proposedRate: 165,
      therapyType: "solo",
    });

    expect((await call({ decision: "reject" })).status).toBe(200);
  });
});

describe("notifying the professional (AC-22)", () => {
  it("emails the professional in their own language on acceptance", async () => {
    await call({ decision: "accept" });
    await Promise.all(h.afterTasks);

    expect(h.sendDecision).toHaveBeenCalledTimes(1);
    const [arg] = h.sendDecision.mock.calls[0] as [Record<string, unknown>];
    expect(arg).toMatchObject({
      professionalEmail: "pro@example.com",
      accepted: true,
      proposedRate: 165,
      locale: "fr",
    });
  });

  it("emails on rejection too, carrying the decision note", async () => {
    h.proposalClaim.mockResolvedValue({
      _id: PROPOSAL,
      status: "rejected",
      proposedRate: 165,
      therapyType: "solo",
    });

    await call({ decision: "reject", decisionNote: "Trop élevé" });
    await Promise.all(h.afterTasks);

    const [arg] = h.sendDecision.mock.calls[0] as [Record<string, unknown>];
    expect(arg).toMatchObject({ accepted: false, decisionNote: "Trop élevé" });
  });

  it("does not notify when the decision was refused", async () => {
    h.proposalClaim.mockResolvedValue(null); // lost the race

    await call({ decision: "accept" });
    await Promise.all(h.afterTasks);

    expect(h.sendDecision).not.toHaveBeenCalled();
  });

  it("still returns 200 when the email throws", async () => {
    // A mail failure must not undo a decision that is already recorded.
    h.sendDecision.mockRejectedValue(new Error("SMTP down"));

    const res = await call({ decision: "accept" });
    await Promise.all(h.afterTasks);

    expect(res.status).toBe(200);
  });
});

describe("already decided", () => {
  it.each(["accepted", "rejected"])("refuses re-deciding a %s proposal", async (status) => {
    h.proposalFindById.mockResolvedValue({
      _id: PROPOSAL,
      professionalId: PRO,
      therapyType: "solo",
      proposedRate: 165,
      status,
    });

    const res = await call({ decision: "accept" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "NOT_PENDING" });
    expect(h.profileUpdate).not.toHaveBeenCalled();
  });

  it("404-equivalents a missing proposal with NOT_PENDING", async () => {
    h.proposalFindById.mockResolvedValue(null);
    expect((await call({ decision: "accept" })).status).toBe(409);
  });
});

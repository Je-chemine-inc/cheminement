/**
 * A professional's own rate-change requests.
 *
 * The rule that matters: submitting changes NOTHING. The live rate stands until
 * an admin accepts, so this route must never write to Profile.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO = "bbbbbbbbbbbbbbbbbbbbbbbb";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  profileFindOne: vi.fn(),
  profileUpdate: vi.fn(),
  settingsFindOne: vi.fn(),
  proposalCreate: vi.fn(),
  proposalFind: vi.fn(),
  sendAlert: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
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
  sendRateProposalSubmittedAlert: (...a: unknown[]) => h.sendAlert(...a),
}));
vi.mock("@/lib/pricing", () => ({
  getTherapyTypeLabel: (t: string) => t,
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => ({
      select: () => Promise.resolve({ firstName: "Sam", lastName: "Pro" }),
    }),
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
vi.mock("@/models/ProfessionalRateProposal", () => ({
  default: {
    create: (...a: unknown[]) => h.proposalCreate(...a),
    find: () => ({ sort: () => ({ limit: () => h.proposalFind() }) }),
  },
}));

import { GET, POST } from "@/app/api/profile/rate-proposal/route";

type Res = Promise<{ status: number; body: unknown }>;

const post = (body: unknown): Res =>
  POST({ json: async () => body } as never) as unknown as Res;

const get = (): Res => GET() as unknown as Res;

beforeEach(() => {
  vi.clearAllMocks();
  h.afterTasks = [];
  h.sendAlert.mockResolvedValue(undefined);
  h.getServerSession.mockResolvedValue({
    user: { id: PRO, role: "professional" },
  });
  h.profileFindOne.mockResolvedValue({
    rates: { solo: { clientPrice: 175, professionalRate: 150 } },
  });
  h.settingsFindOne.mockResolvedValue({
    defaultPricing: { solo: 175, couple: 200, group: 170 },
  });
  h.proposalCreate.mockResolvedValue({
    _id: "p1",
    therapyType: "solo",
    proposedRate: 165,
    status: "pending",
  });
  h.proposalFind.mockResolvedValue([]);
});

describe("auth gate", () => {
  it.each([
    ["a client", { user: { id: "c", role: "client" } }],
    ["an admin", { user: { id: "a", role: "admin" } }],
    ["anonymous", null],
  ])("rejects %s on POST", async (_l, session) => {
    h.getServerSession.mockResolvedValue(session);

    const res = await post({ therapyType: "solo", proposedRate: 165 });

    expect(res.status).toBe(401);
    expect(h.proposalCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-professional on GET", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: "c", role: "client" } });
    expect((await get()).status).toBe(401);
  });
});

describe("submitting", () => {
  it("creates a pending proposal", async () => {
    const res = await post({
      therapyType: "solo",
      proposedRate: 165,
      note: "5 ans d'expérience",
    });

    expect(res.status).toBe(201);
    const [doc] = h.proposalCreate.mock.calls[0] as [Record<string, unknown>];
    expect(doc).toMatchObject({
      professionalId: PRO,
      therapyType: "solo",
      proposedRate: 165,
      status: "pending",
    });
  });

  it("NEVER writes the live rate — that is what makes this a proposal", async () => {
    await post({ therapyType: "solo", proposedRate: 165 });

    expect(h.profileUpdate).not.toHaveBeenCalled();
  });

  it("records the current rate for context in the admin queue", async () => {
    await post({ therapyType: "solo", proposedRate: 165 });

    const [doc] = h.proposalCreate.mock.calls[0] as [Record<string, unknown>];
    expect(doc.currentRate).toBe(150);
  });

  it("refuses a rate above the pinned client price", async () => {
    const res = await post({ therapyType: "solo", proposedRate: 200 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "RATE_EXCEEDS_CLIENT_PRICE" });
    expect(h.proposalCreate).not.toHaveBeenCalled();
  });

  it("uses the platform default price as the ceiling when none is pinned", async () => {
    h.profileFindOne.mockResolvedValue({ rates: {} });

    const res = await post({ therapyType: "couple", proposedRate: 250 });

    // 250 > platform default 200 → refused.
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "RATE_EXCEEDS_CLIENT_PRICE" });
  });

  it("refuses an invalid therapy type", async () => {
    const res = await post({ therapyType: "massage", proposedRate: 100 });
    expect(res.status).toBe(400);
    expect(h.proposalCreate).not.toHaveBeenCalled();
  });

  it("refuses a negative rate", async () => {
    expect((await post({ therapyType: "solo", proposedRate: -5 })).status).toBe(400);
  });

  it("reports a duplicate pending request as 409, not 500", async () => {
    // The partial unique index rejects a second pending proposal per type.
    h.proposalCreate.mockRejectedValue({ code: 11000 });

    const res = await post({ therapyType: "solo", proposedRate: 165 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "ALREADY_PENDING" });
  });
});

describe("notifying admins (AC-22)", () => {
  it("alerts admins with the current and proposed rate", async () => {
    await post({ therapyType: "solo", proposedRate: 165, note: "Expérience" });
    await Promise.all(h.afterTasks);

    expect(h.sendAlert).toHaveBeenCalledTimes(1);
    const [arg] = h.sendAlert.mock.calls[0] as [Record<string, unknown>];
    expect(arg).toMatchObject({
      professionalName: "Sam Pro",
      currentRate: 150,
      proposedRate: 165,
      note: "Expérience",
    });
  });

  it("does not alert when the submission was refused", async () => {
    await post({ therapyType: "solo", proposedRate: 200 }); // above client price
    await Promise.all(h.afterTasks);

    expect(h.sendAlert).not.toHaveBeenCalled();
  });

  it("still returns 201 when the alert throws", async () => {
    // The professional's request is recorded; a mail failure must not lose it.
    h.sendAlert.mockRejectedValue(new Error("SMTP down"));

    const res = await post({ therapyType: "solo", proposedRate: 165 });
    await Promise.all(h.afterTasks);

    expect(res.status).toBe(201);
  });
});

describe("listing", () => {
  it("returns the professional's own proposals", async () => {
    h.proposalFind.mockResolvedValue([
      {
        _id: "p1",
        therapyType: "solo",
        proposedRate: 165,
        currentRate: 150,
        status: "pending",
        createdAt: new Date("2026-08-31"),
      },
    ]);

    const res = await get();

    expect(res.status).toBe(200);
    const { proposals } = res.body as { proposals: { id: string; status: string }[] };
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ id: "p1", status: "pending" });
  });
});

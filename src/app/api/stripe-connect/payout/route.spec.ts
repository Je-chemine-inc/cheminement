/**
 * Payout bundle H6-H9:
 *  H8 — eligibility query uses payment.status (was a non-existent top-level key)
 *  H9 — only card/direct_debit are eligible + totalPayout must be > 0
 *  H6 — the Connect account must be fully onboarded before transferring
 *  H7 — idempotency key on the transfer + nested payment.payoutTransferId write
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const transfersCreate = vi.fn().mockResolvedValue({ id: "tr_1" });
  const accountsRetrieve = vi.fn();
  const find = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({});
  const store: {
    professional: Record<string, unknown> | null;
    appointments: Array<Record<string, unknown>>;
  } = { professional: null, appointments: [] };
  return {
    getServerSession,
    transfersCreate,
    accountsRetrieve,
    find,
    updateMany,
    store,
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    transfers: { create: h.transfersCreate },
    accounts: { retrieve: h.accountsRetrieve },
  },
  toCents: (n: number) => Math.round(n * 100),
}));
vi.mock("@/models/User", () => ({
  default: { findById: () => Promise.resolve(h.store.professional) },
}));
vi.mock("@/models/Appointment", () => ({
  default: { find: h.find, updateMany: h.updateMany },
}));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: { create: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@/lib/ledger-cycle", () => ({
  getBiweeklyCycleKey: () => "2026-W01",
}));

import { POST as payoutPOST } from "@/app/api/stripe-connect/payout/route";

// 24-hex so the real mongoose ObjectId constructor (used for the M11 ledger
// debit) accepts it.
const PRO_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

const call = (body: unknown) =>
  payoutPOST({ json: async () => body } as never) as unknown as Promise<{
    status: number;
    body: Record<string, unknown>;
  }>;

beforeEach(() => {
  vi.clearAllMocks();
  h.getServerSession.mockResolvedValue({ user: { id: "admin1", role: "admin" } });
  h.store.professional = {
    _id: PRO_ID,
    role: "professional",
    stripeConnectAccountId: "acct_1",
  };
  h.store.appointments = [
    { _id: { toString: () => "a1" }, payment: { professionalPayout: 100 } },
  ];
  h.find.mockImplementation(() => Promise.resolve(h.store.appointments));
  h.accountsRetrieve.mockResolvedValue({
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
  });
});

describe("stripe-connect payout POST (H6-H9)", () => {
  it("happy path: transfers once with an idempotency key and writes the NESTED payout marker", async () => {
    const res = await call({ professionalId: PRO_ID, appointmentIds: ["a1"] });
    expect(res.status).toBe(200);

    // H8: query uses the dotted payment.* paths, not the bogus top-level key
    const filter = h.find.mock.calls[0][0] as Record<string, unknown>;
    expect(filter["payment.status"]).toBe("paid");
    expect(filter).not.toHaveProperty("paymentStatus");
    expect(filter["payment.method"]).toEqual({ $in: ["card", "direct_debit"] });
    // H7: eligibility excludes already-paid-out rows (unclaimed OR our token)
    expect(filter.$or).toEqual([
      { "payment.payoutTransferId": { $exists: false } },
      { "payment.payoutTransferId": expect.stringContaining("claim_") },
    ]);

    // H6: onboarding verified before transfer
    expect(h.accountsRetrieve).toHaveBeenCalledWith("acct_1");

    // H7: idempotency key on the transfer
    expect(h.transfersCreate).toHaveBeenCalledTimes(1);
    const [params, options] = h.transfersCreate.mock.calls[0] as [
      Record<string, unknown>,
      { idempotencyKey?: string },
    ];
    expect(params.amount).toBe(10000);
    expect(options.idempotencyKey).toBeTruthy();

    // H7: rows are CLAIMED first (claim token) then FINALIZED to the transfer id
    expect(h.updateMany).toHaveBeenCalledTimes(2);
    const claimSet = (
      h.updateMany.mock.calls[0][1] as { $set: Record<string, unknown> }
    ).$set;
    expect(String(claimSet["payment.payoutTransferId"])).toContain("claim_");
    const finalSet = (
      h.updateMany.mock.calls[1][1] as { $set: Record<string, unknown> }
    ).$set;
    expect(finalSet["payment.payoutTransferId"]).toBe("tr_1");
    expect(finalSet["payment.payoutDate"]).toBeInstanceOf(Date);
  });

  it("H6: rejects when the Connect account is not fully onboarded (no transfer)", async () => {
    h.accountsRetrieve.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    });
    const res = await call({ professionalId: PRO_ID, appointmentIds: ["a1"] });
    expect(res.status).toBe(400);
    expect(h.transfersCreate).not.toHaveBeenCalled();
  });

  it("H8: no eligible appointments → 400, no transfer", async () => {
    h.store.appointments = [];
    const res = await call({ professionalId: PRO_ID, appointmentIds: ["a1"] });
    expect(res.status).toBe(400);
    expect(h.transfersCreate).not.toHaveBeenCalled();
  });

  it("H9: non-positive total payout → 400, no transfer", async () => {
    h.store.appointments = [
      { _id: { toString: () => "a1" }, payment: { professionalPayout: 0 } },
    ];
    const res = await call({ professionalId: PRO_ID, appointmentIds: ["a1"] });
    expect(res.status).toBe(400);
    expect(h.transfersCreate).not.toHaveBeenCalled();
  });

  it("H7: idempotency key is stable regardless of appointment-id order", async () => {
    await call({ professionalId: PRO_ID, appointmentIds: ["a1", "a2"] });
    await call({ professionalId: PRO_ID, appointmentIds: ["a2", "a1"] });
    const k1 = (
      h.transfersCreate.mock.calls[0][1] as { idempotencyKey: string }
    ).idempotencyKey;
    const k2 = (
      h.transfersCreate.mock.calls[1][1] as { idempotencyKey: string }
    ).idempotencyKey;
    expect(k1).toBe(k2);
  });
});

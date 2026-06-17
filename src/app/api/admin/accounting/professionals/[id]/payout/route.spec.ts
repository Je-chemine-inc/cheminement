/**
 * "Marquer comme payé au professionnel" — archives a manual disbursement as a
 * debit ledger entry. Pins auth, the balance-owed computation, default
 * (full-balance) and partial payouts, and the over-balance / nothing-due guards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO = "b3b3b3b3b3b3b3b3b3b3b3b3";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const aggregate = vi.fn();
  const create = vi.fn().mockResolvedValue({});
  const store: {
    admin: Record<string, unknown> | null;
    user: Record<string, unknown> | null;
    profile: Record<string, unknown> | null;
    balance: { credits: number; debits: number };
  } = {
    admin: null,
    user: { role: "professional" },
    profile: { payoutMethod: "interac" },
    balance: { credits: 200, debits: 50 },
  };
  return { getServerSession, aggregate, create, store };
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
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/Admin", () => ({
  default: { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(h.store.admin) }) }) },
}));
vi.mock("@/models/User", () => ({
  default: { findById: () => ({ select: () => ({ lean: () => Promise.resolve(h.store.user) }) }) },
}));
vi.mock("@/models/Profile", () => ({
  default: { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(h.store.profile) }) }) },
}));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: { aggregate: h.aggregate, create: h.create },
}));
vi.mock("@/lib/ledger-cycle", () => ({ getBiweeklyCycleKey: () => "2026-06-A" }));

import { POST as payoutPOST } from "@/app/api/admin/accounting/professionals/[id]/payout/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;

const call = (
  body: unknown,
  session: unknown = { user: { id: "adm", role: "admin" } },
  id = PRO,
): Res => {
  h.getServerSession.mockResolvedValueOnce(session);
  return payoutPOST(
    { json: async () => body } as never,
    { params: Promise.resolve({ id }) },
  ) as unknown as Res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.admin = null;
  h.store.user = { role: "professional" };
  h.store.profile = { payoutMethod: "interac" };
  h.store.balance = { credits: 200, debits: 50 };
  h.aggregate.mockImplementation(() =>
    Promise.resolve([{ _id: null, ...h.store.balance }]),
  );
});

describe("POST /api/admin/accounting/professionals/[id]/payout", () => {
  it("rejects a non-admin (401)", async () => {
    const res = await call({}, { user: { id: "x", role: "client" } });
    expect(res.status).toBe(401);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("404 when the target is not a professional", async () => {
    h.store.user = { role: "client" };
    const res = await call({});
    expect(res.status).toBe(404);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("400 when nothing is owed", async () => {
    h.store.balance = { credits: 50, debits: 50 };
    const res = await call({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "NOTHING_DUE" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("pays the full balance owed by default (debit entry)", async () => {
    const res = await call({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paidAmountCad: 150, balanceOwedCad: 0 });
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entryKind: "debit",
        payoutAmountCad: 150,
        paymentChannel: "transfer", // interac payout method
      }),
    );
  });

  it("honours a partial amount", async () => {
    const res = await call({ amount: 60, reference: "ET-123" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paidAmountCad: 60, balanceOwedCad: 90 });
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ payoutAmountCad: 60, payoutReference: "ET-123" }),
    );
  });

  it("rejects an amount over the balance owed (400)", async () => {
    const res = await call({ amount: 500 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "OVER_BALANCE" });
    expect(h.create).not.toHaveBeenCalled();
  });
});

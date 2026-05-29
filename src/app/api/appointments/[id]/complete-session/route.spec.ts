/**
 * C2 regression (concurrency guard): session closure must atomically CLAIM the
 * appointment (findOneAndUpdate on sessionCompletedAt:null) BEFORE charging.
 * The loser of a concurrent close must NOT charge the card or re-run the
 * closure side effects; the winner charges exactly once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PRO_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const CLIENT_ID = "cccccccccccccccccccccccc";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const charge = vi.fn();
  const sideEffects = vi.fn().mockResolvedValue(undefined);
  const findOneAndUpdate = vi.fn();
  const store: { appointment: Record<string, unknown> } = { appointment: {} };

  const setDeep = (obj: Record<string, unknown>, set: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(set)) {
      if (k.includes(".")) {
        const parts = k.split(".");
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
          cur[parts[i]] = (cur[parts[i]] as Record<string, unknown>) || {};
          cur = cur[parts[i]] as Record<string, unknown>;
        }
        cur[parts[parts.length - 1]] = v;
      } else {
        obj[k] = v;
      }
    }
  };

  const makeQuery = (result: unknown) => ({
    populate() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
    catch(rej: (e: unknown) => unknown) {
      return Promise.resolve(result).catch(rej);
    },
  });

  return { getServerSession, charge, sideEffects, findOneAndUpdate, store, setDeep, makeQuery };
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
vi.mock("@/lib/stripe", () => ({
  calculatePlatformFee: (n: number) => Math.round(n * 0.1 * 100) / 100,
  calculateProfessionalPayout: (n: number) => n - Math.round(n * 0.1 * 100) / 100,
}));
vi.mock("@/lib/stripe-off-session-charge", () => ({
  chargeSavedPaymentMethodAfterSession: h.charge,
}));
vi.mock("@/lib/session-post-closure", () => ({
  runSessionClosureSideEffects: h.sideEffects,
}));
vi.mock("@/lib/interac-reference", () => ({
  buildInteracReferenceCode: () => "INT-TEST",
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => Promise.resolve({ stripeCustomerId: "cus_1" }),
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => h.makeQuery(h.store.appointment),
    findOneAndUpdate: h.findOneAndUpdate,
    findByIdAndUpdate: (_id: string, update: Record<string, unknown>) => {
      const u = update as Record<string, Record<string, unknown>>;
      if (u.$set) h.setDeep(h.store.appointment, u.$set);
      if (u.$unset)
        for (const k of Object.keys(u.$unset)) delete h.store.appointment[k];
      return h.makeQuery(h.store.appointment);
    },
  },
}));

import { POST as completePOST } from "@/app/api/appointments/[id]/complete-session/route";

const callClose = () =>
  completePOST(
    {
      json: async () => ({
        sessionOutcome: "completed",
        sessionActNature: "individual_psychotherapy",
      }),
    } as never,
    { params: Promise.resolve({ id: APPT_ID }) },
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>;

beforeEach(() => {
  vi.clearAllMocks();
  h.charge.mockResolvedValue({ paymentIntentId: "pi_1", settled: true });
  h.store.appointment = {
    _id: APPT_ID,
    clientId: CLIENT_ID,
    professionalId: PRO_ID,
    status: "scheduled",
    payment: {
      method: "card",
      price: 120,
      listPrice: 120,
      status: "pending",
      stripePaymentMethodId: "enc_pm",
    },
  };
  h.getServerSession.mockResolvedValue({
    user: { id: PRO_ID, role: "professional" },
  });
});

describe("complete-session atomic closure claim (C2)", () => {
  it("loser of a concurrent close gets 400 and never charges the card", async () => {
    // Another request already claimed the closure → our claim returns null.
    h.findOneAndUpdate.mockResolvedValueOnce(null);

    const res = await callClose();

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/already been closed/i);
    // KEY: the loser must not charge or re-run side effects
    expect(h.charge).not.toHaveBeenCalled();
    expect(h.sideEffects).not.toHaveBeenCalled();
  });

  it("winner claims first, then charges exactly once and finalizes", async () => {
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    const res = await callClose();

    expect(res.status).toBe(200);
    // KEY: claim filter is the atomic guard (sessionCompletedAt:null)
    expect(h.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter] = h.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({ _id: APPT_ID, sessionCompletedAt: null });
    // KEY: charged exactly once, status finalized
    expect(h.charge).toHaveBeenCalledTimes(1);
    expect(h.sideEffects).toHaveBeenCalledTimes(1);
    expect(h.store.appointment.status).toBe("completed");
    expect((h.store.appointment.payment as Record<string, unknown>).status).toBe(
      "paid",
    );
  });
});

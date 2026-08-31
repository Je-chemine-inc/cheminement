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

/**
 * Regression: closure must PRESERVE the split that was agreed at booking (or
 * set by an admin re-price), not re-derive it from a percentage.
 *
 * The bug: closure called calculatePlatformFee/calculateProfessionalPayout,
 * which read PLATFORM_FEE_PERCENTAGE from the ENV (10) — disagreeing with
 * PlatformSettings.platformFeePercentage (11) used at booking. An appointment
 * priced 175 / fee 25 / payout 150 was silently rebilled as 175 / 18 / 157 at
 * the exact moment the client was charged, so the platform lost its margin and
 * the receipt recorded the wrong split.
 */
const callCloseWith = (outcome: string) =>
  completePOST(
    {
      json: async () => ({
        sessionOutcome: outcome,
        sessionActNature: "individual_psychotherapy",
      }),
    } as never,
    { params: Promise.resolve({ id: APPT_ID }) },
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>;

const paymentAfterClose = () =>
  h.store.appointment.payment as Record<string, number | string>;

describe("complete-session preserves the stored fee split", () => {
  beforeEach(() => {
    // Admin-priced: client pays 175, pro keeps 150, platform keeps the 25 spread.
    // Deliberately NOT a 10% split, so a percentage recomputation is visible.
    h.store.appointment.payment = {
      method: "card",
      price: 175,
      platformFee: 25,
      professionalPayout: 150,
      status: "pending",
      stripePaymentMethodId: "enc_pm",
    };
  });

  it("keeps the agreed 175/25/150 split on a completed session", async () => {
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    await callCloseWith("completed");

    const p = paymentAfterClose();
    expect(p.price).toBe(175);
    // KEY: 25, not Math.round(175 * 0.10) = 18
    expect(p.platformFee).toBe(25);
    // KEY: 150, not 175 - 18 = 157
    expect(p.professionalPayout).toBe(150);
  });

  it("charges the client the stored price, not a recomputed one", async () => {
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    await callCloseWith("completed");

    expect(h.charge).toHaveBeenCalledTimes(1);
    const [args] = h.charge.mock.calls[0] as [{ amountCad: number }];
    expect(args.amountCad).toBe(175);
  });

  it("holds price === platformFee + professionalPayout after closure", async () => {
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    await callCloseWith("completed");

    const p = paymentAfterClose();
    expect(Number(p.price)).toBe(
      Number(p.platformFee) + Number(p.professionalPayout),
    );
  });

  it("zeroes both sides on a free 48h-plus cancellation (fraction 0)", async () => {
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    await callCloseWith("cancelled_48h_plus");

    const p = paymentAfterClose();
    expect(p.price).toBe(0);
    expect(p.platformFee).toBe(0);
    expect(p.professionalPayout).toBe(0);
    expect(p.status).toBe("cancelled");
    // KEY: nothing is charged when the fraction is 0
    expect(h.charge).not.toHaveBeenCalled();
  });

  it("does not touch an already-paid appointment", async () => {
    h.store.appointment.payment = {
      method: "card",
      price: 175,
      platformFee: 25,
      professionalPayout: 150,
      status: "paid",
      stripePaymentMethodId: "enc_pm",
    };
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    await callCloseWith("completed");

    const p = paymentAfterClose();
    expect(p.price).toBe(175);
    expect(p.platformFee).toBe(25);
    expect(p.professionalPayout).toBe(150);
    expect(p.status).toBe("paid");
    expect(h.charge).not.toHaveBeenCalled();
  });
});

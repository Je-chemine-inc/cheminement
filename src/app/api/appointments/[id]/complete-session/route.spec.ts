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
  const resolveCustomerPm = vi.fn();
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

  return { getServerSession, charge, sideEffects, findOneAndUpdate, resolveCustomerPm, store, setDeep, makeQuery };
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
  resolveCustomerChargeablePaymentMethod: h.resolveCustomerPm,
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
import { decryptPaymentMethodReference } from "@/lib/field-encryption";

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
  h.resolveCustomerPm.mockResolvedValue(null);
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

/**
 * Regression (JC-2026-000014): a session dated 9 September was closed as
 * "completed" on 31 August. Closing issues the invoice and starts the dunning
 * clock, so the client was billed $175 and chased through the whole reminder
 * cascade for a session she had not attended — while the session she HAD
 * attended was separately invoiced and paid. Closing must be refused before
 * anything is claimed or charged.
 */
describe("a future session cannot be closed", () => {
  const NINE_DAYS_MS = 9 * 24 * 60 * 60 * 1000;

  it("refuses to close a session dated days from now, and charges nothing", async () => {
    h.store.appointment.scheduledStartAt = new Date(Date.now() + NINE_DAYS_MS);

    const res = await callClose();

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SESSION_NOT_STARTED");
    // KEY: refused BEFORE the atomic claim, so nothing is billed or stamped.
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
    expect(h.charge).not.toHaveBeenCalled();
    expect(h.sideEffects).not.toHaveBeenCalled();
    expect(h.store.appointment.sessionCompletedAt).toBeUndefined();
  });

  it("still closes a session that has already happened", async () => {
    h.store.appointment.scheduledStartAt = new Date(Date.now() - 60 * 60 * 1000);
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    const res = await callClose();

    expect(res.status).toBe(200);
    expect(h.charge).toHaveBeenCalledTimes(1);
  });

  it("still closes an appointment with no date yet (manual invoicing)", async () => {
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    const res = await callClose();

    expect(res.status).toBe(200);
  });
});

/**
 * Regression: a saved card attaches to the Stripe CUSTOMER, and no booking
 * route ever copies a reference onto the appointment. A repeat booking by a
 * client who had already saved a card therefore reached closure with nothing
 * to charge, was soft-skipped as MISSING_PAYMENT_METHOD, and left the invoice
 * pending with a perfectly good card on file.
 */
describe("closure falls back to the customer's stored payment method", () => {
  it("charges the card Stripe holds when the appointment carries none", async () => {
    delete (h.store.appointment.payment as Record<string, unknown>)
      .stripePaymentMethodId;
    h.resolveCustomerPm.mockResolvedValue({
      paymentMethodId: "pm_from_customer",
      method: "card",
    });
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    const res = await callClose();

    expect(res.status).toBe(200);
    expect(h.charge).toHaveBeenCalledTimes(1);
    const [args] = h.charge.mock.calls[0] as [Record<string, unknown>];
    // Stored encrypted at rest, exactly as the setup routes store it — what
    // matters is that it decrypts back to the customer's real method.
    expect(
      decryptPaymentMethodReference(args.encryptedPaymentMethodId as string),
    ).toBe("pm_from_customer");
    // KEY: what we charged is recorded, so receipt/refund/dunning agree.
    const payment = h.store.appointment.payment as Record<string, unknown>;
    expect(
      decryptPaymentMethodReference(payment.stripePaymentMethodId as string),
    ).toBe("pm_from_customer");
    expect(payment.status).toBe("paid");
  });

  it("charges a PAD on its own rails, not the appointment's card method", async () => {
    // acss_debit charged as a card is rejected outright by Stripe.
    delete (h.store.appointment.payment as Record<string, unknown>)
      .stripePaymentMethodId;
    h.resolveCustomerPm.mockResolvedValue({
      paymentMethodId: "pm_pad",
      method: "direct_debit",
    });
    h.charge.mockResolvedValue({ paymentIntentId: "pi_2", settled: false });
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    const res = await callClose();

    expect(res.status).toBe(200);
    const [args] = h.charge.mock.calls[0] as [Record<string, unknown>];
    expect(args.method).toBe("direct_debit");
    const payment = h.store.appointment.payment as Record<string, unknown>;
    expect(payment.method).toBe("direct_debit");
    // ACSS confirms asynchronously — the webhook flips it to paid later.
    expect(payment.status).toBe("processing");
  });

  it("still closes softly when the client genuinely has nothing on file", async () => {
    delete (h.store.appointment.payment as Record<string, unknown>)
      .stripePaymentMethodId;
    h.resolveCustomerPm.mockResolvedValue(null);
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    const res = await callClose();

    // A billing gap must never block a professional from ending their session.
    expect(res.status).toBe(200);
    expect(h.charge).not.toHaveBeenCalled();
    expect((h.store.appointment.payment as Record<string, unknown>).status).toBe(
      "pending",
    );
  });

  it("does NOT consult the customer when the appointment has its own method", async () => {
    h.findOneAndUpdate.mockResolvedValueOnce(h.store.appointment);

    await callClose();

    expect(h.resolveCustomerPm).not.toHaveBeenCalled();
    const [args] = h.charge.mock.calls[0] as [Record<string, unknown>];
    expect(args.encryptedPaymentMethodId).toBe("enc_pm");
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

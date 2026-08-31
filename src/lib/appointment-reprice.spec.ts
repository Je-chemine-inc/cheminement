import { describe, it, expect } from "vitest";
import {
  canReprice,
  computeRepriceAmounts,
  LOCKED_PAYMENT_STATUSES,
  repriceSetPaths,
} from "./appointment-reprice";

describe("canReprice", () => {
  it.each(["pending", "failed", "cancelled", "overdue"])(
    "allows re-pricing while payment is %s",
    (status) => {
      expect(canReprice({ payment: { status } })).toEqual({ ok: true });
    },
  );

  it.each([...LOCKED_PAYMENT_STATUSES])("refuses when payment is %s", (status) => {
    expect(canReprice({ payment: { status } })).toEqual({
      ok: false,
      reason: "PAYMENT_LOCKED",
    });
  });

  it("treats `processing` as locked — an ACSS charge is already in flight", () => {
    // Confirms asynchronously, so the money has moved even though the status
    // is not yet `paid`.
    expect(canReprice({ payment: { status: "processing" } }).ok).toBe(false);
  });

  it("refuses once a fiscal receipt has been issued", () => {
    expect(
      canReprice({
        payment: { status: "pending" },
        fiscalReceiptIssuedAt: new Date(),
      }),
    ).toEqual({ ok: false, reason: "RECEIPT_ISSUED" });
  });

  it("defaults a missing payment status to pending (allowed)", () => {
    expect(canReprice({}).ok).toBe(true);
    expect(canReprice({ payment: null }).ok).toBe(true);
  });
});

describe("computeRepriceAmounts", () => {
  it("derives the platform fee from the price and payout", () => {
    const r = computeRepriceAmounts(175, 150);
    expect(r).toEqual({
      ok: true,
      amounts: { price: 175, professionalPayout: 150, platformFee: 25 },
    });
  });

  it("holds price === platformFee + professionalPayout", () => {
    const cases: [number, number][] = [
      [175, 150],
      [99.99, 33.33],
      [100, 66.666],
      [1, 0.01],
      [200, 0],
      [175, 175],
    ];

    for (const [price, payout] of cases) {
      const r = computeRepriceAmounts(price, payout);
      if (!r.ok) throw new Error("expected ok for " + price + "/" + payout);
      const { amounts } = r;
      expect(amounts.platformFee + amounts.professionalPayout).toBeCloseTo(
        amounts.price,
        10,
      );
    }
  });

  it("refuses a payout above the price — the platform would owe money it never took", () => {
    expect(computeRepriceAmounts(150, 175)).toEqual({
      ok: false,
      reason: "PAYOUT_EXCEEDS_PRICE",
    });
  });

  it("allows a zero spread and a zero payout", () => {
    expect(computeRepriceAmounts(175, 175).ok).toBe(true);
    expect(computeRepriceAmounts(175, 0).ok).toBe(true);
  });

  it.each([0, -1, "abc", null, undefined, "", Number.NaN, 2_000_000])(
    "refuses an invalid client price: %s",
    (bad) => {
      const r = computeRepriceAmounts(bad, 10);
      expect(r.ok).toBe(false);
    },
  );

  it.each([-1, "abc", null, undefined, Number.NaN])(
    "refuses an invalid payout: %s",
    (bad) => {
      const r = computeRepriceAmounts(175, bad);
      expect(r.ok).toBe(false);
    },
  );

  it("accepts numeric strings from a form", () => {
    expect(computeRepriceAmounts("175", "150")).toEqual({
      ok: true,
      amounts: { price: 175, professionalPayout: 150, platformFee: 25 },
    });
  });

  it("rounds to cents", () => {
    const r = computeRepriceAmounts(175.004, 150.005);
    expect(r).toEqual({
      ok: true,
      amounts: { price: 175, professionalPayout: 150.01, platformFee: 24.99 },
    });
  });
});

describe("repriceSetPaths", () => {
  it("writes only the money fields, and realigns listPrice", () => {
    const paths = repriceSetPaths({
      price: 175,
      platformFee: 25,
      professionalPayout: 150,
    });

    expect(paths).toEqual({
      "payment.price": 175,
      "payment.platformFee": 25,
      "payment.professionalPayout": 150,
      // A later prorated closure must prorate the NEW full price, not the
      // superseded one.
      "payment.listPrice": 175,
    });
  });

  it("touches nothing outside payment", () => {
    const paths = repriceSetPaths({
      price: 100,
      platformFee: 10,
      professionalPayout: 90,
    });
    for (const key of Object.keys(paths)) {
      expect(key.startsWith("payment.")).toBe(true);
    }
  });
});

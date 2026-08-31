import { describe, it, expect } from "vitest";
import {
  rateFromSpreadPercentage,
  ratesToSetPaths,
  ratesToUnsetPaths,
  spreadOf,
  validateRatesInput,
} from "./professional-pricing";

describe("validateRatesInput", () => {
  it("accepts a valid client price / professional rate pair", () => {
    const r = validateRatesInput({
      solo: { clientPrice: 175, professionalRate: 150 },
    });

    expect(r).toEqual({
      ok: true,
      rates: { solo: { clientPrice: 175, professionalRate: 150 } },
    });
  });

  it("rejects a professional rate above the client price", () => {
    // The platform would pay out more than it collected.
    const r = validateRatesInput({
      solo: { clientPrice: 175, professionalRate: 200 },
    });

    expect(r).toEqual({
      ok: false,
      error: "RATE_EXCEEDS_CLIENT_PRICE",
      field: "solo",
    });
  });

  it("permits a spread of exactly zero", () => {
    // nbourgeau's live case — allowed, but the UI must warn (AC-17).
    const r = validateRatesInput({
      solo: { clientPrice: 175, professionalRate: 175 },
    });

    expect(r.ok).toBe(true);
  });

  it("validates a partial update against the stored value", () => {
    // Changing only the rate must still be checked against the stored price.
    const r = validateRatesInput(
      { solo: { professionalRate: 200 } },
      { solo: { clientPrice: 175, professionalRate: 150 } },
    );

    expect(r).toEqual({
      ok: false,
      error: "RATE_EXCEEDS_CLIENT_PRICE",
      field: "solo",
    });
  });

  it("allows lowering the client price to exactly the stored rate", () => {
    const r = validateRatesInput(
      { solo: { clientPrice: 150 } },
      { solo: { clientPrice: 175, professionalRate: 150 } },
    );

    expect(r.ok).toBe(true);
  });

  it("rejects lowering the client price below the stored rate", () => {
    const r = validateRatesInput(
      { solo: { clientPrice: 140 } },
      { solo: { clientPrice: 175, professionalRate: 150 } },
    );

    expect(r).toEqual({
      ok: false,
      error: "RATE_EXCEEDS_CLIENT_PRICE",
      field: "solo",
    });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000])(
    "rejects an out-of-range client price: %s",
    (bad) => {
      const r = validateRatesInput({ solo: { clientPrice: bad } });
      expect(r.ok).toBe(false);
    },
  );

  it("rejects a client price of zero", () => {
    const r = validateRatesInput({ solo: { clientPrice: 0 } });
    expect(r).toEqual({
      ok: false,
      error: "CLIENT_PRICE_MUST_BE_POSITIVE",
      field: "solo",
    });
  });

  it("allows a professional rate of zero (pro bono / platform keeps all)", () => {
    const r = validateRatesInput({
      solo: { clientPrice: 175, professionalRate: 0 },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown therapy type", () => {
    const r = validateRatesInput({ nope: { clientPrice: 100 } });
    expect(r).toEqual({
      ok: false,
      error: "UNKNOWN_THERAPY_TYPE",
      field: "nope",
    });
  });

  it("rejects a non-object payload", () => {
    expect(validateRatesInput(null).ok).toBe(false);
    expect(validateRatesInput("175").ok).toBe(false);
    expect(validateRatesInput(42).ok).toBe(false);
  });

  it("coerces numeric strings from a form input", () => {
    const r = validateRatesInput({
      solo: { clientPrice: "175", professionalRate: "150" },
    } as unknown);

    expect(r).toEqual({
      ok: true,
      rates: { solo: { clientPrice: 175, professionalRate: 150 } },
    });
  });

  it("treats null and empty string as an explicit clear", () => {
    const r = validateRatesInput({
      solo: { clientPrice: null, professionalRate: "" },
    } as unknown);

    expect(r).toEqual({
      ok: true,
      rates: { solo: { clientPrice: null, professionalRate: null } },
    });
  });

  it("rounds money to cents", () => {
    const r = validateRatesInput({
      solo: { clientPrice: 175.005, professionalRate: 150.004 },
    });

    expect(r).toMatchObject({
      ok: true,
      rates: { solo: { clientPrice: 175.01, professionalRate: 150 } },
    });
  });
});

describe("spreadOf", () => {
  it("returns the amount and percentage the platform keeps", () => {
    expect(spreadOf(175, 150)).toEqual({ amount: 25, percentage: 14.29 });
  });

  it("returns zero for an equal price and rate", () => {
    expect(spreadOf(175, 175)).toEqual({ amount: 0, percentage: 0 });
  });

  it("does not divide by zero", () => {
    expect(spreadOf(0, 0)).toEqual({ amount: 0, percentage: 0 });
    expect(spreadOf(undefined, undefined)).toEqual({
      amount: 0,
      percentage: 0,
    });
  });

  it("reports a negative spread rather than hiding it", () => {
    // Validation blocks this on write, but stored legacy data could still
    // produce it — the UI needs to see it to warn.
    expect(spreadOf(150, 175).amount).toBe(-25);
  });
});

describe("rateFromSpreadPercentage", () => {
  it("back-computes the rate from a spread percentage", () => {
    expect(rateFromSpreadPercentage(175, 20)).toBe(140);
    expect(rateFromSpreadPercentage(200, 25)).toBe(150);
  });

  it("round-trips close to the original spread", () => {
    const rate = rateFromSpreadPercentage(175, 14.29);
    expect(spreadOf(175, rate).percentage).toBeCloseTo(14.29, 1);
  });

  it("clamps the percentage to 0..100", () => {
    expect(rateFromSpreadPercentage(175, -50)).toBe(175);
    expect(rateFromSpreadPercentage(175, 150)).toBe(0);
  });

  it("returns 0 for a non-positive client price", () => {
    expect(rateFromSpreadPercentage(0, 20)).toBe(0);
    expect(rateFromSpreadPercentage(Number.NaN, 20)).toBe(0);
  });
});

describe("ratesToSetPaths / ratesToUnsetPaths", () => {
  it("builds dotted $set paths for provided amounts", () => {
    expect(
      ratesToSetPaths({
        solo: { clientPrice: 175, professionalRate: 150 },
        couple: { professionalRate: 160 },
      }),
    ).toEqual({
      "rates.solo.clientPrice": 175,
      "rates.solo.professionalRate": 150,
      "rates.couple.professionalRate": 160,
    });
  });

  it("builds $unset paths for explicitly cleared fields", () => {
    expect(
      ratesToUnsetPaths({
        solo: { clientPrice: null },
        group: { professionalRate: null },
      }),
    ).toEqual({
      "rates.solo.clientPrice": "",
      "rates.group.professionalRate": "",
    });
  });

  it("never puts the same path in both $set and $unset", () => {
    const rates = { solo: { clientPrice: 175, professionalRate: null } };
    const set = ratesToSetPaths(rates);
    const unset = ratesToUnsetPaths(rates);

    for (const key of Object.keys(set)) {
      expect(unset).not.toHaveProperty(key);
    }
  });
});

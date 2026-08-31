import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
}));

vi.mock("@/models/PlatformSettings", () => ({
  default: { findOne: () => Promise.resolve(h.settings) },
}));
vi.mock("@/models/Profile", () => ({
  default: { findOne: () => Promise.resolve(null) },
}));

import {
  formatPrice,
  getTherapyTypeLabel,
  splitPriceByPlatformFee,
} from "./pricing";

/**
 * Regression: the split used to come from `process.env.PLATFORM_FEE_PERCENTAGE`
 * (via lib/stripe.ts) while booking used `PlatformSettings.platformFeePercentage`.
 * In production those were 10 and 11, so the admin's configured percentage was
 * discarded at the moment money moved. There must be one source of truth.
 */
describe("splitPriceByPlatformFee", () => {
  beforeEach(() => {
    h.settings = null;
  });

  it("uses the percentage configured in PlatformSettings, not the env var", async () => {
    h.settings = { platformFeePercentage: 11 };

    const { platformFee, professionalPayout, platformFeePercentage } =
      await splitPriceByPlatformFee(175);

    // KEY: 11% of 175 = 19.25 — not the env's 10% (17.50).
    expect(platformFeePercentage).toBe(11);
    expect(platformFee).toBe(19.25);
    expect(professionalPayout).toBe(155.75);
  });

  it("holds price === platformFee + professionalPayout", async () => {
    // Percentages and prices chosen to round badly.
    const cases: [number, number][] = [
      [175, 11],
      [150, 11],
      [99.99, 13],
      [33.33, 33],
      [120, 10],
      [1, 7],
    ];

    for (const [price, pct] of cases) {
      h.settings = { platformFeePercentage: pct };
      const { platformFee, professionalPayout } =
        await splitPriceByPlatformFee(price);

      expect(platformFee + professionalPayout).toBeCloseTo(price, 10);
    }
  });

  it("falls back to 10% when no settings row exists", async () => {
    h.settings = null;

    const { platformFee, professionalPayout } =
      await splitPriceByPlatformFee(200);

    expect(platformFee).toBe(20);
    expect(professionalPayout).toBe(180);
  });

  it("respects a configured 0% (platform takes nothing)", async () => {
    // `?? 10` not `|| 10` — a deliberate 0 must not fall back to 10.
    h.settings = { platformFeePercentage: 0 };

    const { platformFee, professionalPayout } =
      await splitPriceByPlatformFee(175);

    expect(platformFee).toBe(0);
    expect(professionalPayout).toBe(175);
  });

  it("handles a zero price without producing a negative payout", async () => {
    h.settings = { platformFeePercentage: 11 };

    const { platformFee, professionalPayout } =
      await splitPriceByPlatformFee(0);

    expect(platformFee).toBe(0);
    expect(professionalPayout).toBe(0);
  });
});

describe("pricing helpers", () => {
  describe("formatPrice", () => {
    it("should format price for CAD correctly", () => {
      // In Intl.NumberFormat with en-CA, it should be $120
      // Note: white spaces might be tricky, so we use a fuzzy check or check parts
      const formatted = formatPrice(120, "CAD");
      expect(formatted).toContain("$120");
    });

    it("should handle custom currency", () => {
      const formatted = formatPrice(50, "USD");
      expect(formatted).toContain("US$50");
    });
  });

  describe("getTherapyTypeLabel", () => {
    it("should return correct label for each type", () => {
      expect(getTherapyTypeLabel("solo")).toBe("Individual Therapy");
      expect(getTherapyTypeLabel("couple")).toBe("Couple Therapy");
      expect(getTherapyTypeLabel("group")).toBe("Group Therapy");
    });
  });
});

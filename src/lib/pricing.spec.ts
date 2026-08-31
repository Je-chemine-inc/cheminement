import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
}));

vi.mock("@/models/PlatformSettings", () => ({
  default: { findOne: () => Promise.resolve(h.settings) },
}));
vi.mock("@/models/Profile", () => ({
  default: { findOne: () => Promise.resolve(h.profile) },
}));

import {
  calculateAppointmentPricing,
  formatPrice,
  getTherapyTypeLabel,
  splitPriceByPlatformFee,
} from "./pricing";

/**
 * calculateAppointmentPricing decides what every client is charged and every
 * professional is paid, and had NO test coverage — which is how the two
 * disagreeing fee sources survived in production. These tests pin the model:
 * the client pays the platform/client price, the professional receives their
 * negotiated rate, and the platform keeps the spread.
 */
describe("calculateAppointmentPricing", () => {
  const PRO = "pro-1";

  beforeEach(() => {
    h.settings = {
      defaultPricing: { solo: 175, couple: 200, group: 170 },
      platformFeePercentage: 11,
      currency: "CAD",
    };
    h.profile = null;
  });

  describe("admin-configured rates", () => {
    it("client pays the client price, pro gets their rate, platform keeps the spread", async () => {
      h.profile = {
        rates: { solo: { clientPrice: 175, professionalRate: 150 } },
      };

      const r = await calculateAppointmentPricing(PRO, "solo");

      expect(r.sessionPrice).toBe(175);
      expect(r.professionalPayout).toBe(150);
      expect(r.platformFee).toBe(25);
      expect(r.source).toBe("professional");
      expect(r.rateClamped).toBe(false);
    });

    it("falls back to the platform default price when only a rate is configured", async () => {
      h.profile = { rates: { solo: { professionalRate: 150 } } };

      const r = await calculateAppointmentPricing(PRO, "solo");

      expect(r.sessionPrice).toBe(175); // platform default
      expect(r.professionalPayout).toBe(150);
      expect(r.platformFee).toBe(25);
    });

    it("resolves each therapy type independently", async () => {
      h.profile = {
        rates: {
          solo: { clientPrice: 175, professionalRate: 150 },
          couple: { clientPrice: 200, professionalRate: 160 },
        },
      };

      expect((await calculateAppointmentPricing(PRO, "solo")).platformFee).toBe(25);
      expect((await calculateAppointmentPricing(PRO, "couple")).platformFee).toBe(40);
      // group unconfigured → platform default + percentage
      const group = await calculateAppointmentPricing(PRO, "group");
      expect(group.sessionPrice).toBe(170);
      expect(group.source).toBe("platform");
    });
  });

  describe("legacy pricing (pre-migration)", () => {
    it("reads the legacy single number as the professional's rate", async () => {
      // The live shape before spec 001's migration.
      h.profile = {
        pricing: { individualSession: 160, coupleSession: 0, groupSession: 0 },
      };

      const r = await calculateAppointmentPricing(PRO, "solo");

      expect(r.sessionPrice).toBe(175); // platform price, NOT the pro's 160
      expect(r.professionalPayout).toBe(160);
      expect(r.platformFee).toBe(15);
      expect(r.source).toBe("professional");
    });

    it("treats a legacy 0 as unset, never as a zero payout", async () => {
      // Two live profiles carry coupleSession: 0 / groupSession: 0.
      h.profile = {
        pricing: { individualSession: 145, coupleSession: 0, groupSession: 0 },
      };

      const couple = await calculateAppointmentPricing(PRO, "couple");

      expect(couple.source).toBe("platform");
      expect(couple.sessionPrice).toBe(200);
      // 11% of 200 = 22 — NOT a payout of 0.
      expect(couple.platformFee).toBe(22);
      expect(couple.professionalPayout).toBe(178);
    });

    it("prefers an admin rate over the legacy number", async () => {
      h.profile = {
        pricing: { individualSession: 160, coupleSession: 0, groupSession: 0 },
        rates: { solo: { clientPrice: 190, professionalRate: 150 } },
      };

      const r = await calculateAppointmentPricing(PRO, "solo");

      expect(r.sessionPrice).toBe(190);
      expect(r.professionalPayout).toBe(150);
      expect(r.platformFee).toBe(40);
    });
  });

  describe("unconfigured professional (AC-4 fallback)", () => {
    it("uses the platform default price split by the configured percentage", async () => {
      h.profile = {};

      const r = await calculateAppointmentPricing(PRO, "solo");

      expect(r.sessionPrice).toBe(175);
      expect(r.platformFee).toBe(19.25); // 11% of 175
      expect(r.professionalPayout).toBe(155.75);
      expect(r.source).toBe("platform");
    });

    it("handles no profile at all (unassigned appointment)", async () => {
      h.profile = null;

      const r = await calculateAppointmentPricing(null, "solo");

      expect(r.sessionPrice).toBe(175);
      expect(r.source).toBe("platform");
    });
  });

  describe("misconfiguration guards", () => {
    it("caps a professional rate above the client price and flags it", async () => {
      // The pro's self-serve form can still produce this until the admin
      // editor replaces it. The platform must never owe more than it collected.
      h.profile = {
        rates: { solo: { clientPrice: 175, professionalRate: 300 } },
      };

      const r = await calculateAppointmentPricing(PRO, "solo");

      expect(r.professionalPayout).toBe(175);
      expect(r.platformFee).toBe(0); // never negative
      expect(r.rateClamped).toBe(true);
    });

    it("permits a deliberate zero spread without flagging it", async () => {
      // nbourgeau's live case: rate equals the platform price.
      h.profile = {
        rates: { solo: { clientPrice: 175, professionalRate: 175 } },
      };

      const r = await calculateAppointmentPricing(PRO, "solo");

      expect(r.platformFee).toBe(0);
      expect(r.professionalPayout).toBe(175);
      expect(r.rateClamped).toBe(false);
    });
  });

  describe("the invariant", () => {
    it("holds sessionPrice === platformFee + professionalPayout everywhere", async () => {
      const cases: Record<string, unknown>[] = [
        { rates: { solo: { clientPrice: 175, professionalRate: 150 } } },
        { rates: { solo: { clientPrice: 99.99, professionalRate: 33.33 } } },
        { rates: { solo: { clientPrice: 100, professionalRate: 66.666 } } },
        { rates: { solo: { clientPrice: 175, professionalRate: 300 } } },
        { pricing: { individualSession: 160, coupleSession: 0, groupSession: 0 } },
        {},
      ];

      for (const pct of [0, 7, 11, 13, 33, 100]) {
        for (const profile of cases) {
          h.profile = profile;
          h.settings = {
            defaultPricing: { solo: 175, couple: 200, group: 170 },
            platformFeePercentage: pct,
            currency: "CAD",
          };

          const r = await calculateAppointmentPricing(PRO, "solo");

          expect(r.platformFee + r.professionalPayout).toBeCloseTo(
            r.sessionPrice,
            10,
          );
          expect(r.platformFee).toBeGreaterThanOrEqual(0);
          expect(r.professionalPayout).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("platform settings edge cases", () => {
    it("respects a configured 0% fee for an unconfigured pro", async () => {
      h.profile = {};
      h.settings = {
        defaultPricing: { solo: 175, couple: 200, group: 170 },
        platformFeePercentage: 0,
        currency: "CAD",
      };

      const r = await calculateAppointmentPricing(PRO, "solo");

      expect(r.platformFee).toBe(0);
      expect(r.professionalPayout).toBe(175);
    });

    it("returns the configured currency", async () => {
      h.profile = {};
      const r = await calculateAppointmentPricing(PRO, "solo");
      expect(r.currency).toBe("CAD");
    });
  });
});

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

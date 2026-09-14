import { describe, it, expect } from "vitest";
import {
  DEFAULT_TPS_RATE_PERCENT,
  DEFAULT_TVQ_RATE_PERCENT,
  parseTaxNumber,
  parseTaxRatePercent,
  saleTaxBreakdown,
  salesTaxSettingsOf,
  salesTaxesApply,
  taxOnCents,
} from "@/lib/sales-taxes";

const on = salesTaxSettingsOf({
  enabled: true,
  tpsRatePercent: 5,
  tvqRatePercent: 9.975,
  tpsNumber: "123456789 RT0001",
  tvqNumber: "1234567890 TQ0001",
});

describe("tax arithmetic", () => {
  it("adds TPS and TVQ on top of the price, each rounded to the cent", () => {
    expect(saleTaxBreakdown(4900, on)).toEqual({
      subtotalCents: 4900,
      tpsCents: 245,
      tvqCents: 489,
      totalCents: 5634,
      tpsRatePercent: 5,
      tvqRatePercent: 9.975,
      tpsNumber: "123456789 RT0001",
      tvqNumber: "1234567890 TQ0001",
    });
    // 189,525 ¢ of TVQ rounds up; 50,5 ¢ rounds up; 50,4 ¢ rounds down.
    expect(saleTaxBreakdown(1900, on)).toMatchObject({ tpsCents: 95, tvqCents: 190, totalCents: 2185 });
    expect(taxOnCents(1010, 5)).toBe(51);
    expect(taxOnCents(1008, 5)).toBe(50);
    expect(taxOnCents(100_000, 9.975)).toBe(9975);
  });

  it("keeps total = subtotal + TPS + TVQ for every price in the allowed range", () => {
    for (let cents = 500; cents <= 100_000; cents += 7) {
      const b = saleTaxBreakdown(cents, on)!;
      expect(b.totalCents).toBe(b.subtotalCents + b.tpsCents + b.tvqCents);
      expect(Number.isInteger(b.tpsCents) && Number.isInteger(b.tvqCents)).toBe(true);
      expect(Math.abs(b.tpsCents - (cents * 5) / 100)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(b.tvqCents - (cents * 9.975) / 100)).toBeLessThanOrEqual(0.5);
    }
  });

  it("charges nothing extra while switched off or without both numbers", () => {
    expect(saleTaxBreakdown(4900, { ...on, enabled: false })).toBeNull();
    expect(saleTaxBreakdown(4900, { ...on, tpsNumber: "" })).toBeNull();
    expect(saleTaxBreakdown(4900, { ...on, tvqNumber: "" })).toBeNull();
    expect(salesTaxesApply(on)).toBe(true);
  });

  it("computes with the rates it is given, a zero rate included", () => {
    expect(saleTaxBreakdown(10_000, { ...on, tpsRatePercent: 0, tvqRatePercent: 10 })).toMatchObject({
      tpsCents: 0,
      tvqCents: 1000,
      totalCents: 11_000,
    });
  });
});

describe("what an admin may save", () => {
  it("accepts rates from 0 to 20 % with at most three decimals", () => {
    expect(parseTaxRatePercent(9.975)).toBe(9.975);
    expect(parseTaxRatePercent(0)).toBe(0);
    expect(parseTaxRatePercent(20)).toBe(20);
    for (const bad of [-1, 20.001, 9.9751, Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined]) {
      expect(parseTaxRatePercent(bad)).toBeNull();
    }
  });

  it("accepts registration numbers made of letters, digits, spaces and hyphens", () => {
    expect(parseTaxNumber("  123456789  RT0001 ")).toBe("123456789 RT0001");
    expect(parseTaxNumber("")).toBe("");
    expect(parseTaxNumber(undefined)).toBe("");
    expect(parseTaxNumber("1234567890-TQ-0001")).toBe("1234567890-TQ-0001");
    for (const bad of ["<b>1</b>", "x".repeat(31), 42]) expect(parseTaxNumber(bad)).toBeNull();
  });

  it("falls back to the official rates when nothing valid is saved, and stays off", () => {
    for (const raw of [undefined, null, {}, { tpsRatePercent: "abc", tvqRatePercent: 99 }]) {
      expect(salesTaxSettingsOf(raw)).toEqual({
        enabled: false,
        tpsRatePercent: DEFAULT_TPS_RATE_PERCENT,
        tvqRatePercent: DEFAULT_TVQ_RATE_PERCENT,
        tpsNumber: "",
        tvqNumber: "",
      });
    }
    expect(salesTaxSettingsOf({ enabled: "yes" }).enabled).toBe(false);
  });
});

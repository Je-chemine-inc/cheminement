import { describe, it, expect } from "vitest";
import { NO_PRICE, formatCad } from "./format-currency";

/**
 * Which non-breaking space ICU emits before the "$" differs between Node and
 * browser versions (U+00A0 vs U+202F), so every assertion compares against
 * normalized whitespace. Pinning the byte would make this spec fail on a Node
 * upgrade for no real reason.
 */
const norm = (s: string) => s.replace(/[\s  ]/g, " ");

describe("formatCad", () => {
  it("formats whole dollars without decimals", () => {
    expect(norm(formatCad(1900, "fr"))).toBe("19 $");
    expect(norm(formatCad(1900, "en"))).toBe("$19");
  });

  it("keeps cents when the price is not round", () => {
    expect(norm(formatCad(1999, "fr"))).toBe("19,99 $");
    expect(norm(formatCad(1999, "en"))).toBe("$19.99");
  });

  it("puts the symbol where each language expects it", () => {
    // The whole reason this helper exists: fr-CA trails the $, en-CA leads it.
    expect(formatCad(4500, "fr").trim().endsWith("$")).toBe(true);
    expect(formatCad(4500, "en").startsWith("$")).toBe(true);
  });

  it("groups thousands", () => {
    expect(norm(formatCad(150000, "fr"))).toBe("1 500 $");
    expect(norm(formatCad(150000, "en"))).toBe("$1,500");
  });

  it("treats any non-fr locale as English", () => {
    // useLocale() only ever yields "fr" | "en", but the prop is a plain string.
    expect(formatCad(1900, "en-CA")).toBe(formatCad(1900, "en"));
    expect(formatCad(1900, "")).toBe(formatCad(1900, "en"));
  });

  it("handles a single cent and a zero price", () => {
    expect(norm(formatCad(1, "fr"))).toBe("0,01 $");
    expect(norm(formatCad(0, "fr"))).toBe("0 $");
  });

  it("returns a dash instead of NaN", () => {
    expect(formatCad(NaN, "fr")).toBe(NO_PRICE);
    expect(formatCad(Infinity, "en")).toBe(NO_PRICE);
    expect(formatCad(undefined as unknown as number, "fr")).toBe(NO_PRICE);
  });

  it("never renders a bare float artifact", () => {
    // 1/3-style drift must not surface; cents in, at most 2 decimals out.
    expect(formatCad(3333, "en")).toBe("$33.33");
  });
});

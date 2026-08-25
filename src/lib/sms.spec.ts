/**
 * Phone → E.164 normalization for Twilio. Regression: a bare 10-digit Québec
 * number (e.g. 4385550189) must become +14385550189, not +4385550189 — the
 * latter is invalid and made SMS 2FA fail for professionals.
 */
import { describe, it, expect } from "vitest";
import { toE164 } from "./sms";

describe("toE164", () => {
  it("prefixes +1 for a bare 10-digit North American number", () => {
    expect(toE164("4385550189")).toBe("+14385550189");
    expect(toE164("(438) 555-0189")).toBe("+14385550189");
    expect(toE164("514 555 0117")).toBe("+15145550117");
  });

  it("keeps an 11-digit number that already has the leading 1", () => {
    expect(toE164("15145550117")).toBe("+15145550117");
    expect(toE164("1-514-555-0117")).toBe("+15145550117");
  });

  it("returns a +-prefixed number unchanged", () => {
    expect(toE164("+15145550117")).toBe("+15145550117");
    expect(toE164("+213540687123")).toBe("+213540687123");
  });

  it("converts a 00 international prefix to +", () => {
    expect(toE164("00213540687123")).toBe("+213540687123");
  });

  it("prefixes + for other-length international numbers", () => {
    expect(toE164("213540687123")).toBe("+213540687123");
  });
});

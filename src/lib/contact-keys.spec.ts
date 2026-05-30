import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  phoneLookupHash,
  normalizeFullName,
} from "@/lib/contact-keys";

describe("normalizePhone", () => {
  it("strips formatting down to the last 10 digits", () => {
    expect(normalizePhone("(514) 555-1234")).toBe("5145551234");
    expect(normalizePhone("514.555.1234")).toBe("5145551234");
    expect(normalizePhone("+1 514 555 1234")).toBe("5145551234");
    expect(normalizePhone("1-514-555-1234")).toBe("5145551234");
  });

  it("returns null for empty or too-short input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("phoneLookupHash", () => {
  it("is deterministic and equal across equivalent formats", () => {
    const a = phoneLookupHash("(514) 555-1234");
    const b = phoneLookupHash("+1 514-555-1234");
    expect(typeof a).toBe("string");
    expect(a).toBe(b);
  });

  it("differs for different numbers", () => {
    expect(phoneLookupHash("5145551234")).not.toBe(
      phoneLookupHash("5145559999"),
    );
  });

  it("is null for unusable input", () => {
    expect(phoneLookupHash("123")).toBeNull();
    expect(phoneLookupHash(undefined)).toBeNull();
  });
});

describe("normalizeFullName", () => {
  it("lowercases, strips accents, and collapses whitespace", () => {
    expect(normalizeFullName("Joël", "Tremblay")).toBe("joel tremblay");
    expect(normalizeFullName("  Marie  ", " Roy ")).toBe("marie roy");
    expect(normalizeFullName("José", "GARCÍA")).toBe("jose garcia");
  });

  it("returns null when empty", () => {
    expect(normalizeFullName("", "")).toBeNull();
    expect(normalizeFullName(undefined, undefined)).toBeNull();
  });
});

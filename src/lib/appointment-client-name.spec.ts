/**
 * Regression: a professional could not open their schedule at all. Two of their
 * appointments referenced a DELETED client, so `clientId` populated to null and
 * `appointment.clientId.firstName` threw during render — white screen, in every
 * browser, because the cause was the data rather than the cache.
 */
import { describe, it, expect } from "vitest";
import { clientDisplayName } from "./appointment-client-name";

const FALLBACK = "Client supprimé";

describe("clientDisplayName", () => {
  it("returns the full name when the client exists", () => {
    expect(
      clientDisplayName({ firstName: "Marie", lastName: "Tremblay" }, FALLBACK),
    ).toBe("Marie Tremblay");
  });

  it("returns the fallback for a deleted client (populate yielded null)", () => {
    // KEY: this is the crash. It must never throw.
    expect(clientDisplayName(null, FALLBACK)).toBe(FALLBACK);
    expect(clientDisplayName(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("handles a partial name", () => {
    expect(clientDisplayName({ firstName: "Marie" }, FALLBACK)).toBe("Marie");
    expect(clientDisplayName({ lastName: "Tremblay" }, FALLBACK)).toBe(
      "Tremblay",
    );
  });

  it("falls back when the record exists but carries no usable name", () => {
    expect(clientDisplayName({}, FALLBACK)).toBe(FALLBACK);
    expect(clientDisplayName({ firstName: "  ", lastName: "" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(clientDisplayName({ firstName: null, lastName: null }, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("trims stray whitespace rather than rendering it", () => {
    expect(
      clientDisplayName({ firstName: " Marie ", lastName: " Tremblay " }, FALLBACK),
    ).toBe("Marie Tremblay");
  });

  it("never throws for any shape", () => {
    const shapes = [null, undefined, {}, { firstName: 42 }, { lastName: [] }];
    for (const s of shapes) {
      expect(() =>
        clientDisplayName(s as unknown as { firstName?: string }, FALLBACK),
      ).not.toThrow();
    }
  });
});

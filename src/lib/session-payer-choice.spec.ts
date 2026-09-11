import { describe, it, expect } from "vitest";
import { overrideFor, payerChoice } from "@/lib/session-payer-choice";

/**
 * The owner: « pour le choix de paiement, mettre par défaut que ce soit le
 * client lui-même qui paie ». The choice read « Choisir le payeur » on closed
 * sessions and « Selon la couverture » on every upcoming one, so an admin set
 * « Client » by hand on JC-2026-000014.
 */
const base = {
  closed: false,
  payerKind: null,
  billingOverride: null,
  coverageApplies: false,
  organizationBilling: true,
} as const;

describe("payerChoice — the client pays by default", () => {
  it("a closed session with no payer record shows the client, not an empty choice", () => {
    expect(payerChoice({ ...base, closed: true }).value).toBe("client");
    expect(payerChoice({ ...base, closed: true, organizationBilling: false }).value).toBe("client");
  });

  it("a closed session shows who paid when it is on record", () => {
    expect(payerChoice({ ...base, closed: true, payerKind: "organization" }).value).toBe("organization");
    expect(payerChoice({ ...base, closed: true, payerKind: "external" }).value).toBe("external");
  });

  it("an upcoming session with no coverage shows the client and offers no « Selon la couverture »", () => {
    const c = payerChoice(base);
    expect(c.value).toBe("client");
    expect(c.options).not.toContain("auto");
    expect(c.options).toEqual(["organization", "client", "external"]);
  });

  it("« Selon la couverture » is the default only when a coverage applies", () => {
    const c = payerChoice({ ...base, coverageApplies: true });
    expect(c.value).toBe("auto");
    expect(c.options[0]).toBe("auto");
  });

  it("a payer chosen ahead is shown", () => {
    expect(payerChoice({ ...base, billingOverride: "external" }).value).toBe("external");
    expect(payerChoice({ ...base, coverageApplies: true, billingOverride: "client" }).value).toBe("client");
  });
});

describe("payerChoice — while organization billing is off", () => {
  it("an upcoming session offers only the client: closure would ignore anything else", () => {
    expect(payerChoice({ ...base, organizationBilling: false })).toEqual({ value: "client", options: ["client"] });
    expect(
      payerChoice({ ...base, organizationBilling: false, billingOverride: "external", coverageApplies: true }),
    ).toEqual({ value: "client", options: ["client"] });
  });

  it("a closed session can still be marked paid outside the platform", () => {
    expect(payerChoice({ ...base, closed: true, organizationBilling: false }).options).toEqual(["client", "external"]);
  });

  it("a payer on record stays visible even when no longer offered", () => {
    const c = payerChoice({ ...base, closed: true, organizationBilling: false, payerKind: "organization" });
    expect(c.value).toBe("organization");
    expect(c.options).toContain("organization");
  });
});

describe("overrideFor — what an upcoming session stores", () => {
  it("the default stores nothing, so a coverage added later still applies", () => {
    expect(overrideFor("auto", true)).toBeNull();
    expect(overrideFor("client", false)).toBeNull();
  });

  it("anything else is stored", () => {
    expect(overrideFor("client", true)).toBe("client");
    expect(overrideFor("organization", false)).toBe("organization");
    expect(overrideFor("external", false)).toBe("external");
  });
});

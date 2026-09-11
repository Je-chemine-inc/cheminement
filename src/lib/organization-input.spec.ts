import { describe, it, expect } from "vitest";
import {
  parseBeneficiary,
  parseConsentAction,
  parseCoverageTerms,
  parseDay,
  parseDollarsToCents,
  parseOrganizationInput,
} from "@/lib/organization-input";

/**
 * Spec 002 — what an admin may type into an organization or a coverage. These
 * are allow-lists: anything not listed never reaches the database.
 */

describe("parseOrganizationInput", () => {
  it("requires a name on create", () => {
    expect(parseOrganizationInput({}, { partial: false })).toMatchObject({ ok: false });
    expect(parseOrganizationInput({ name: "   " }, { partial: false })).toMatchObject({ ok: false });
  });

  it("stores the negotiated rate in cents, and null clears it", () => {
    const r = parseOrganizationInput({ name: "PAE X", negotiatedRate: "95,50" }, { partial: false });
    expect(r).toMatchObject({ ok: true, value: { negotiatedRateCents: 9550 } });
    expect(parseOrganizationInput({ negotiatedRate: null }, { partial: true })).toMatchObject({
      ok: true,
      value: { negotiatedRateCents: null },
    });
    expect(parseOrganizationInput({ negotiatedRate: "-5" }, { partial: true })).toMatchObject({ ok: false });
    expect(parseOrganizationInput({ negotiatedRate: "abc" }, { partial: true })).toMatchObject({ ok: false });
  });

  it("drops fields that are not on the allow-list (no mass assignment)", () => {
    const r = parseOrganizationInput(
      { name: "PAE X", active: false, stripeCustomerId: "cus_1", createdBy: "x", $set: { a: 1 } },
      { partial: false },
    );
    expect(r.ok && Object.keys(r.value)).toEqual(["name"]);
  });

  it("accepts up to five valid billing emails, deduplicated and lower-cased", () => {
    const r = parseOrganizationInput(
      { billingEmails: "Facturation@PAE.ca, facturation@pae.ca; rh@pae.ca" },
      { partial: true },
    );
    expect(r).toMatchObject({ ok: true, value: { billingEmails: ["facturation@pae.ca", "rh@pae.ca"] } });
    expect(parseOrganizationInput({ billingEmails: ["not-an-email"] }, { partial: true })).toMatchObject({ ok: false });
    expect(
      parseOrganizationInput({ billingEmails: ["a@x.ca", "b@x.ca", "c@x.ca", "d@x.ca", "e@x.ca", "f@x.ca"] }, { partial: true }),
    ).toMatchObject({ ok: false });
  });

  it("rejects values outside the enums", () => {
    expect(parseOrganizationInput({ gapPolicy: "free" }, { partial: true })).toMatchObject({ ok: false });
    expect(parseOrganizationInput({ billingCycle: "weekly" }, { partial: true })).toMatchObject({ ok: false });
    expect(parseOrganizationInput({ paymentTermsDays: 400 }, { partial: true })).toMatchObject({ ok: false });
    expect(parseOrganizationInput({ autoSendPerSession: "yes" }, { partial: true })).toMatchObject({ ok: false });
  });
});

describe("parseCoverageTerms", () => {
  it("defaults to full coverage", () => {
    expect(parseCoverageTerms({}, { partial: false })).toMatchObject({ ok: true, value: { mode: "full" } });
  });

  it("needs the organization's share for a split", () => {
    expect(parseCoverageTerms({ mode: "split" }, { partial: false })).toMatchObject({ ok: false });
    expect(
      parseCoverageTerms({ mode: "split", split: { type: "percent", value: 80 } }, { partial: false }),
    ).toMatchObject({ ok: true, value: { split: { type: "percent", value: 80 } } });
    expect(
      parseCoverageTerms({ mode: "split", split: { type: "fixed", value: "90" } }, { partial: false }),
    ).toMatchObject({ ok: true, value: { split: { type: "fixed", value: 9000 } } });
    expect(parseCoverageTerms({ split: { type: "percent", value: 150 } }, { partial: true })).toMatchObject({ ok: false });
  });

  it("takes a whole session cap, or null for none", () => {
    expect(parseCoverageTerms({ maxSessions: "6" }, { partial: true })).toMatchObject({ ok: true, value: { maxSessions: 6 } });
    expect(parseCoverageTerms({ maxSessions: "" }, { partial: true })).toMatchObject({ ok: true, value: { maxSessions: null } });
    expect(parseCoverageTerms({ maxSessions: 2.5 }, { partial: true })).toMatchObject({ ok: false });
    expect(parseCoverageTerms({ maxSessions: 0 }, { partial: true })).toMatchObject({ ok: false });
  });

  it("covers whole days, so a session on the last day is still covered", () => {
    const r = parseCoverageTerms({ validFrom: "2026-09-01", validUntil: "2026-09-30" }, { partial: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Session dates are anchored at UTC noon (parseAppointmentDate).
    const lastDaySession = new Date("2026-09-30T12:00:00Z");
    const firstDaySession = new Date("2026-09-01T12:00:00Z");
    expect(lastDaySession <= r.value.validUntil!).toBe(true);
    expect(firstDaySession >= r.value.validFrom!).toBe(true);
    expect(parseCoverageTerms({ validFrom: "2026-09-30", validUntil: "2026-09-01" }, { partial: true })).toMatchObject({ ok: false });
  });
});

describe("small parsers", () => {
  it("parseDay rejects impossible dates", () => {
    expect(Number.isNaN(parseDay("2026-02-31", "start")!.getTime())).toBe(true);
    expect(Number.isNaN(parseDay("31/01/2026", "start")!.getTime())).toBe(true);
    expect(parseDay("", "end")).toBeNull();
  });

  it("parseDollarsToCents rounds to the cent and caps absurd amounts", () => {
    expect(parseDollarsToCents(120.005)).toBe(12001);
    expect(Number.isNaN(parseDollarsToCents(1_000_000)!)).toBe(true);
  });

  it("consent always needs a note, and a known method to record it", () => {
    expect(parseConsentAction({ action: "give", method: "written" })).toMatchObject({ ok: false });
    expect(parseConsentAction({ action: "give", method: "telepathy", note: "x" })).toMatchObject({ ok: false });
    expect(parseConsentAction({ action: "give", method: "verbal", note: "Au téléphone le 11/09" })).toMatchObject({ ok: true });
    expect(parseConsentAction({ action: "withdraw", note: "Courriel du client" })).toMatchObject({ ok: true });
  });

  it("parseBeneficiary is the client themself or a named loved one", () => {
    expect(parseBeneficiary(undefined)).toEqual({ ok: true, value: "self" });
    expect(parseBeneficiary({ firstName: "Léa", lastName: "Roy" })).toMatchObject({ ok: true });
    expect(parseBeneficiary({})).toMatchObject({ ok: false });
  });
});

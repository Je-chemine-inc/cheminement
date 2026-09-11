import { describe, it, expect } from "vitest";
import {
  resolveSessionPayers,
  wouldConsumeCapSlot,
  type CapSlot,
  type CoverageMode,
  type CoverageTerms,
  type GapPolicy,
  type OrgTerms,
  type PayerInput,
  type PayerOverride,
  type PayerPlan,
  type SessionOutcome,
} from "@/lib/third-party-billing";

/**
 * The single "who pays" decision for spec 002. Examples use the owner's
 * reference numbers: a $120 session, professional share 90 %, and a PAE whose
 * negotiated rate is $90.
 */

const LIST = 12000;
const RATIO = 0.9;

const coverage = (over: Partial<CoverageTerms> = {}): CoverageTerms => ({
  id: "cov-1",
  mode: "full",
  consentGiven: true,
  hasCap: false,
  caseNumber: "PAE-4471",
  ...over,
});

const org = (over: Partial<OrgTerms> = {}): OrgTerms => ({
  id: "org-1",
  name: "PAE Desjardins",
  gapPolicy: "client_copay",
  ...over,
});

const input = (over: Partial<PayerInput> = {}): PayerInput => ({
  outcome: "completed",
  listPriceCents: LIST,
  proShareRatio: RATIO,
  coverage: coverage(),
  org: org(),
  override: null,
  declarationPending: false,
  capSlot: "not_needed",
  ...over,
});

const plan = (over: Partial<PayerInput> = {}) => resolveSessionPayers(input(over));

describe("the owner's decision table", () => {
  it("full coverage, no negotiated rate: org pays 120, client 0", () => {
    const p = plan();
    expect(p).toMatchObject({ kind: "organization", state: "confirmed", reason: "org_full" });
    expect(p.org.priceCents).toBe(12000);
    expect(p.client.priceCents).toBe(0);
    expect(p.clientPaymentStatus).toBe("covered");
    expect(p.proPayoutTotalCents).toBe(10800);
  });

  it("rate below price, client pays the gap: org 90, client 30, pro on 120", () => {
    const p = plan({ org: org({ negotiatedRateCents: 9000, gapPolicy: "client_copay" }) });
    expect(p.org.priceCents).toBe(9000);
    expect(p.client.priceCents).toBe(3000);
    expect(p.clientPaymentStatus).toBe("pending"); // the client's 30 is charged normally
    expect(p.proPayoutTotalCents).toBe(10800);
    expect(p.client).toEqual({
      priceCents: 3000,
      professionalPayoutCents: 2700,
      platformFeeCents: 300,
    });
  });

  it("rate below price, clinic absorbs, pro paid in full: org 90, pro 108, fee −18", () => {
    const p = plan({
      org: org({ negotiatedRateCents: 9000, gapPolicy: "clinic_absorbs_pro_full" }),
    });
    expect(p.org.priceCents).toBe(9000);
    expect(p.client.priceCents).toBe(0);
    expect(p.clinicAbsorbedCents).toBe(3000);
    expect(p.proPayoutTotalCents).toBe(10800);
    expect(p.platformFeeTotalCents).toBe(-1800);
  });

  it("rate below price, clinic absorbs, pro paid on the org rate: pro 81", () => {
    const p = plan({
      org: org({ negotiatedRateCents: 9000, gapPolicy: "clinic_absorbs_pro_org_rate" }),
    });
    expect(p.org.priceCents).toBe(9000);
    expect(p.proBasisCents).toBe(9000);
    expect(p.proPayoutTotalCents).toBe(8100);
    expect(p.platformFeeTotalCents).toBe(900);
  });

  it("rate ABOVE price: org billed 140, pro paid on 120, clinic keeps 20", () => {
    const p = plan({ org: org({ negotiatedRateCents: 14000 }) });
    expect(p.reason).toBe("org_rate_above_list");
    expect(p.org.priceCents).toBe(14000);
    expect(p.clinicSurplusCents).toBe(2000);
    expect(p.proBasisCents).toBe(12000);
    expect(p.proPayoutTotalCents).toBe(10800);
  });

  it("a patient-specific rate beats the organization's rate", () => {
    const p = plan({
      coverage: coverage({ rateCentsOverride: 10000 }),
      org: org({ negotiatedRateCents: 9000 }),
    });
    expect(p.org.priceCents).toBe(10000);
    expect(p.client.priceCents).toBe(2000);
  });

  it("split 80 %: org 96, client 24, pro on 120, gap policy ignored", () => {
    const p = plan({
      coverage: coverage({ mode: "split", split: { type: "percent", value: 80 } }),
      org: org({ negotiatedRateCents: 5000, gapPolicy: "clinic_absorbs_pro_full" }),
    });
    expect(p.reason).toBe("org_split");
    expect(p.org.priceCents).toBe(9600);
    expect(p.client.priceCents).toBe(2400);
    expect(p.proPayoutTotalCents).toBe(10800);
  });

  it("split fixed $50: org 50, client 70; a fixed amount can't exceed the price", () => {
    const fixed = plan({
      coverage: coverage({ mode: "split", split: { type: "fixed", value: 5000 } }),
    });
    expect(fixed.org.priceCents).toBe(5000);
    expect(fixed.client.priceCents).toBe(7000);
    const capped = plan({
      coverage: coverage({ mode: "split", split: { type: "fixed", value: 99999 } }),
    });
    expect(capped.org.priceCents).toBe(12000);
    expect(capped.client.priceCents).toBe(0);
  });

  it("handled externally: client recorded as paid by hand, labelled with the org", () => {
    const p = plan({ coverage: coverage({ mode: "external" }) });
    expect(p).toMatchObject({
      kind: "external",
      clientPaymentStatus: "paid",
      clientPaymentMethod: "manual",
      externalPayerLabel: "PAE Desjardins",
    });
    expect(p.client.priceCents).toBe(12000);
    expect(p.org.priceCents).toBe(0);
    expect(p.proPayoutTotalCents).toBe(10800);
  });

  it("an external override without an organization gets a neutral label", () => {
    const p = plan({ coverage: null, org: null, override: "external" });
    expect(p.externalPayerLabel).toBe("Hors plateforme");
  });
});

describe("no-show and late cancellation always go to the client", () => {
  for (const outcome of ["no_show", "cancelled_late"] as const) {
    it(`${outcome}: full price to the client, nothing to the org, no cap slot`, () => {
      for (const mode of ["full", "split", "per_session", "external"] as const) {
        const p = plan({ outcome, coverage: coverage({ mode, hasCap: true }), override: "organization" });
        expect(p.kind).toBe("client");
        expect(p.reason).toBe("late_or_no_show");
        expect(p.client.priceCents).toBe(12000);
        expect(p.org.priceCents).toBe(0);
        expect(p.consumesCapSlot).toBe(false);
        expect(p.clientPaymentStatus).toBe("pending");
      }
    });
  }

  it("a free cancellation (48 h or more) owes nothing to anyone", () => {
    const p = plan({ outcome: "cancelled_48h_plus" });
    expect(p.client.priceCents).toBe(0);
    expect(p.org.priceCents).toBe(0);
    expect(p.proPayoutTotalCents).toBe(0);
    expect(p.clientPaymentStatus).toBe("cancelled");
    expect(p.consumesCapSlot).toBe(false);
  });
});

describe("session cap (first N sessions)", () => {
  it("a capped coverage needs a slot for an org-paid session", () => {
    expect(wouldConsumeCapSlot(input({ coverage: coverage({ hasCap: true }) }))).toBe(true);
  });

  it("slot granted: the organization pays and the slot is consumed", () => {
    const p = plan({ coverage: coverage({ hasCap: true }), capSlot: "granted" });
    expect(p.kind).toBe("organization");
    expect(p.consumesCapSlot).toBe(true);
  });

  it("slot denied (cap reached): the client pays as today", () => {
    const p = plan({ coverage: coverage({ hasCap: true }), capSlot: "denied" });
    expect(p.kind).toBe("client");
    expect(p.reason).toBe("cap_exhausted");
    expect(p.client.priceCents).toBe(12000);
  });

  it("an external session also counts against the cap", () => {
    expect(
      wouldConsumeCapSlot(input({ coverage: coverage({ mode: "external", hasCap: true }) })),
    ).toBe(true);
  });

  it("no-show, late cancellation, client override and undecided sessions never take a slot", () => {
    const capped = coverage({ hasCap: true });
    expect(wouldConsumeCapSlot(input({ outcome: "no_show", coverage: capped }))).toBe(false);
    expect(wouldConsumeCapSlot(input({ outcome: "cancelled_late", coverage: capped }))).toBe(false);
    expect(wouldConsumeCapSlot(input({ override: "client", coverage: capped }))).toBe(false);
    expect(
      wouldConsumeCapSlot(input({ coverage: coverage({ mode: "per_session", hasCap: true }) })),
    ).toBe(false);
  });
});

describe("held for an admin decision — nothing charged", () => {
  const expectHeld = (p: PayerPlan, reason: string) => {
    expect(p.state).toBe("awaiting_decision");
    expect(p.reason).toBe(reason);
    expect(p.client.priceCents).toBe(0);
    expect(p.clientPaymentStatus).toBe("covered");
    // The professional is still credited, provisionally on the full price.
    expect(p.proPayoutTotalCents).toBe(10800);
  };

  it("a declaration the admin hasn't confirmed yet", () => {
    expectHeld(plan({ coverage: null, org: null, declarationPending: true }), "declaration_pending");
  });

  it("a 'chosen per session' patient with no choice made", () => {
    expectHeld(plan({ coverage: coverage({ mode: "per_session" }) }), "per_session_undecided");
  });

  it("consent not recorded (Loi 25)", () => {
    expectHeld(plan({ coverage: coverage({ consentGiven: false }) }), "consent_missing");
  });

  it("an admin chose 'organization' but no coverage is attached", () => {
    expectHeld(plan({ coverage: null, override: "organization" }), "organization_without_coverage");
  });

  it("an admin choosing 'organization' settles a per-session patient", () => {
    const p = plan({ coverage: coverage({ mode: "per_session" }), override: "organization" });
    expect(p.state).toBe("confirmed");
    expect(p.kind).toBe("organization");
  });
});

describe("with no coverage at all, nothing changes", () => {
  it("the client pays exactly as before", () => {
    const p = plan({ coverage: null, org: null });
    expect(p).toMatchObject({ kind: "client", reason: "no_coverage", clientPaymentStatus: "pending" });
    expect(p.client).toEqual({
      priceCents: 12000,
      professionalPayoutCents: 10800,
      platformFeeCents: 1200,
    });
  });

  it("matches today's closure rounding for an awkward price", () => {
    // complete-session: payout = roundMoney(price × ratio), fee = price − payout.
    const price = 97.35;
    const ratio = 88.12 / 97.9;
    const todayPayout = Math.round(price * ratio * 100) / 100;
    const p = resolveSessionPayers(
      input({ coverage: null, org: null, listPriceCents: 9735, proShareRatio: ratio }),
    );
    expect(p.client.professionalPayoutCents).toBe(Math.round(todayPayout * 100));
  });
});

describe("money invariants, across every combination", () => {
  const outcomes: SessionOutcome[] = ["completed", "cancelled_48h_plus", "cancelled_late", "no_show"];
  const modes: CoverageMode[] = ["full", "split", "per_session", "external"];
  const gaps: GapPolicy[] = ["client_copay", "clinic_absorbs_pro_full", "clinic_absorbs_pro_org_rate"];
  const overrides: (PayerOverride | null)[] = [null, "organization", "client", "external"];
  const slots: CapSlot[] = ["not_needed", "granted", "denied"];
  const rates: (number | undefined)[] = [undefined, 0, 9000, 12000, 14000];
  const prices = [12000, 9735, 1, 0];
  const ratios = [0.9, 0.73, 1, 0];

  const cases: PayerPlan[] = [];
  for (const outcome of outcomes)
    for (const mode of modes)
      for (const gapPolicy of gaps)
        for (const override of overrides)
          for (const capSlot of slots)
            for (const rate of rates)
              for (const listPriceCents of prices)
                for (const proShareRatio of ratios)
                  for (const consentGiven of [true, false])
                    cases.push(
                      resolveSessionPayers({
                        outcome,
                        listPriceCents,
                        proShareRatio,
                        coverage: coverage({
                          mode,
                          consentGiven,
                          hasCap: capSlot !== "not_needed",
                          split: { type: "percent", value: 80 },
                        }),
                        org: org({ negotiatedRateCents: rate, gapPolicy }),
                        override,
                        declarationPending: false,
                        capSlot,
                      }),
                    );

  it(`holds for all ${cases.length} plans`, () => {
    for (const p of cases) {
      const sides = [p.client, p.org];
      for (const s of sides) {
        // Every amount is whole cents.
        for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true);
        // Each side balances: price = fee + payout.
        expect(s.priceCents).toBe(s.platformFeeCents + s.professionalPayoutCents);
        expect(s.priceCents).toBeGreaterThanOrEqual(0);
      }
      // The client side (Appointment.payment) never carries a negative fee.
      expect(p.client.platformFeeCents).toBeGreaterThanOrEqual(0);
      expect(p.client.professionalPayoutCents).toBeGreaterThanOrEqual(0);
      // The professional's total is exactly the two sides' payouts.
      expect(p.client.professionalPayoutCents + p.org.professionalPayoutCents).toBe(
        p.proPayoutTotalCents,
      );
      // The clinic's fee is what is billed minus what the professional earns.
      expect(p.platformFeeTotalCents).toBe(
        p.client.priceCents + p.org.priceCents - p.proPayoutTotalCents,
      );
      // A client-only or external plan bills the organization nothing.
      if (p.kind !== "organization") expect(p.org.priceCents).toBe(0);
      // Only the organization side may go negative, and only by absorbing.
      if (p.org.platformFeeCents < 0) expect(p.gapPolicy).toBe("clinic_absorbs_pro_full");
      // A no-show or late cancellation is never the organization's.
      if (p.reason === "late_or_no_show") expect(p.kind).toBe("client");
      // Awaiting a decision never charges the client.
      if (p.state === "awaiting_decision") expect(p.client.priceCents).toBe(0);
    }
  });

  it("client + org + absorbed − surplus always equals the billed price", () => {
    for (const outcome of outcomes)
      for (const rate of rates)
        for (const gapPolicy of gaps)
          for (const mode of ["full", "split"] as const) {
            const p = resolveSessionPayers(
              input({
                outcome,
                coverage: coverage({ mode, split: { type: "fixed", value: 4321 } }),
                org: org({ negotiatedRateCents: rate, gapPolicy }),
              }),
            );
            const billed = outcome === "cancelled_48h_plus" ? 0 : LIST;
            expect(
              p.client.priceCents + p.org.priceCents + p.clinicAbsorbedCents - p.clinicSurplusCents,
            ).toBe(billed);
          }
  });
});

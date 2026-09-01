import { describe, it, expect } from "vitest";
import {
  acceptanceSetPaths,
  canDecide,
  parseProposal,
} from "./rate-proposal";

describe("parseProposal", () => {
  it("accepts a valid submission", () => {
    const r = parseProposal(
      { therapyType: "solo", proposedRate: 165, note: "  5 ans d'expérience  " },
      175,
    );

    expect(r).toEqual({
      ok: true,
      proposal: {
        therapyType: "solo",
        proposedRate: 165,
        note: "5 ans d'expérience",
      },
    });
  });

  it("refuses a rate above the client price", () => {
    // Could never be granted — the platform cannot pay out more than it
    // collects — so say so at submission rather than after an admin reviews it.
    expect(parseProposal({ therapyType: "solo", proposedRate: 200 }, 175)).toEqual(
      { ok: false, reason: "RATE_EXCEEDS_CLIENT_PRICE" },
    );
  });

  it("allows a rate equal to the client price (zero spread)", () => {
    expect(parseProposal({ therapyType: "solo", proposedRate: 175 }, 175).ok).toBe(
      true,
    );
  });

  it("skips the ceiling check when no client price is known", () => {
    expect(
      parseProposal({ therapyType: "group", proposedRate: 500 }, undefined).ok,
    ).toBe(true);
  });

  it.each(["massage", "", null, undefined, 42])(
    "refuses therapy type %s",
    (bad) => {
      expect(parseProposal({ therapyType: bad, proposedRate: 100 }, 175)).toEqual({
        ok: false,
        reason: "INVALID_THERAPY_TYPE",
      });
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 200_000, "abc", null, undefined])(
    "refuses rate %s",
    (bad) => {
      const r = parseProposal({ therapyType: "solo", proposedRate: bad }, 1_000);
      expect(r).toEqual({ ok: false, reason: "INVALID_RATE" });
    },
  );

  it("allows a rate of zero", () => {
    expect(parseProposal({ therapyType: "solo", proposedRate: 0 }, 175).ok).toBe(
      true,
    );
  });

  it("coerces a numeric string from a form", () => {
    const r = parseProposal({ therapyType: "solo", proposedRate: "165" }, 175);
    expect(r).toMatchObject({ ok: true, proposal: { proposedRate: 165 } });
  });

  it("rounds to cents", () => {
    const r = parseProposal({ therapyType: "solo", proposedRate: 165.004 }, 175);
    expect(r).toMatchObject({ ok: true, proposal: { proposedRate: 165 } });
  });

  it("drops an empty note rather than storing whitespace", () => {
    const r = parseProposal(
      { therapyType: "solo", proposedRate: 165, note: "   " },
      175,
    );
    expect(r).toMatchObject({ ok: true, proposal: { note: undefined } });
  });

  it("refuses an over-long note", () => {
    const r = parseProposal(
      { therapyType: "solo", proposedRate: 165, note: "x".repeat(1001) },
      175,
    );
    expect(r).toEqual({ ok: false, reason: "NOTE_TOO_LONG" });
  });

  it("refuses a non-object payload", () => {
    expect(parseProposal(null, 175).ok).toBe(false);
    expect(parseProposal("165", 175).ok).toBe(false);
  });
});

describe("canDecide", () => {
  it("allows deciding a pending proposal", () => {
    expect(canDecide({ status: "pending" })).toEqual({ ok: true });
  });

  it.each(["accepted", "rejected"])("refuses re-deciding a %s proposal", (status) => {
    expect(canDecide({ status })).toEqual({ ok: false, reason: "NOT_PENDING" });
  });

  it("refuses a missing proposal", () => {
    expect(canDecide(null)).toEqual({ ok: false, reason: "NOT_PENDING" });
    expect(canDecide({})).toEqual({ ok: false, reason: "NOT_PENDING" });
  });
});

describe("acceptanceSetPaths", () => {
  it("writes only the professional rate for that therapy type", () => {
    expect(acceptanceSetPaths("couple", 160)).toEqual({
      "rates.couple.professionalRate": 160,
    });
  });

  it("never touches the client price — that is the platform's to set", () => {
    const paths = acceptanceSetPaths("solo", 150);
    expect(Object.keys(paths)).toEqual(["rates.solo.professionalRate"]);
    expect(JSON.stringify(paths)).not.toContain("clientPrice");
  });
});

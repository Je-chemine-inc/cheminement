import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import {
  blockedLines,
  buildInvoiceLine,
  patientNameFor,
  periodBounds,
  periodKeyOf,
  previousPeriodKey,
  sumLineCents,
} from "@/lib/organization-invoice-lines";

/**
 * Spec 002, Loi 25 — what an organization's invoice may say about a session.
 * The owner approved: patient name, case number, professional name/title/
 * licence, date, duration, amount. Nothing clinical, ever.
 */

const APT = "0123456789abcdef01234569";
const COV = "0123456789abcdef01234568";

/** A source object stuffed with everything an appointment knows. */
const richSource = () =>
  ({
    appointmentId: APT,
    coverageId: COV,
    sessionDate: new Date("2026-09-10T12:00:00Z"),
    patientFullName: "Léa Roy",
    caseNumber: "PAE-4471",
    professionalName: "Sam Pro",
    professionalTitle: "Psychothérapeute",
    professionalLicence: "OPQ-12345",
    durationMinutes: 50,
    amountCents: 12000,
    // Everything below must never reach the organization.
    issueType: "Idées suicidaires",
    needs: ["Dépression"],
    sessionActNature: "individual_psychotherapy",
    therapyType: "couple",
    notes: "Notes cliniques",
    clientEmail: "lea@example.com",
    phone: "+15145550100",
  }) as Parameters<typeof buildInvoiceLine>[0];

describe("buildInvoiceLine", () => {
  it("keeps exactly the approved fields, never a clinical one", () => {
    const line = buildInvoiceLine(richSource());
    expect(Object.keys(line).sort()).toEqual(
      [
        "appointmentId",
        "amountCents",
        "caseNumber",
        "coverageId",
        "durationMinutes",
        "patientFullName",
        "professionalLicence",
        "professionalName",
        "professionalTitle",
        "sessionDate",
      ].sort(),
    );
    const serialized = JSON.stringify(line);
    for (const word of ["suicidaires", "Dépression", "psychotherapy", "couple", "Notes cliniques", "lea@example.com", "5550100"]) {
      expect(serialized).not.toContain(word);
    }
  });

  it("is accepted by the invoice model, whose line schema throws on any other field", () => {
    const doc = new OrganizationInvoice({
      kind: "session",
      organizationId: new mongoose.Types.ObjectId(),
      draftKey: "x",
      lines: [buildInvoiceLine(richSource())],
    });
    expect(doc.validateSync()).toBeUndefined();

    // A line carrying anything else can never be saved: the constructor records
    // a validation error, and pushes and updates throw outright.
    const leaky = { ...buildInvoiceLine(richSource()), issueType: "Anxiété" };
    const bad = new OrganizationInvoice({
      kind: "session",
      organizationId: new mongoose.Types.ObjectId(),
      draftKey: "y",
      lines: [leaky],
    });
    expect(bad.validateSync()?.errors).toHaveProperty("lines");
    expect(() => doc.lines.push(leaky as never)).toThrow(/not in schema/);
  });

  it("refuses fractional or negative cents", () => {
    expect(() => buildInvoiceLine({ ...richSource(), amountCents: 120.5 })).toThrow();
    expect(() => buildInvoiceLine({ ...richSource(), amountCents: -1 })).toThrow();
  });
});

describe("helpers", () => {
  it("names the person who received the care, not the guardian's account", () => {
    expect(patientNameFor({ bookingFor: "self" }, { firstName: "Léa", lastName: "Roy" })).toBe("Léa Roy");
    expect(
      patientNameFor(
        { bookingFor: "loved-one", lovedOneInfo: { firstName: "Léo", lastName: "Roy" } },
        { firstName: "Léa", lastName: "Roy" },
      ),
    ).toBe("Léo Roy");
  });

  it("blocks lines whose coverage has no consent, or no coverage at all", () => {
    const lines = [
      { coverageId: new mongoose.Types.ObjectId(COV) },
      { coverageId: new mongoose.Types.ObjectId("0123456789abcdef0123456a") },
      { coverageId: undefined },
    ];
    const blocked = blockedLines(lines, new Map([[COV, true], ["0123456789abcdef0123456a", false]]));
    expect(blocked).toHaveLength(2);
    expect(blocked).not.toContain(lines[0]);
  });

  it("sums cents", () => {
    expect(sumLineCents([{ amountCents: 9000 }, { amountCents: 3050 }])).toBe(12050);
  });

  it("puts a session in the month its calendar day says — noon or legacy midnight anchor", () => {
    expect(periodKeyOf(new Date("2026-10-01T12:00:00Z"))).toBe("2026-10");
    expect(periodKeyOf(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10");
    const { start, end } = periodBounds("2026-12");
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(previousPeriodKey(new Date("2027-01-01T13:00:00Z"))).toBe("2026-12");
    // 00:30 UTC on 1 October is still 30 September in Montréal.
    expect(previousPeriodKey(new Date("2026-10-01T00:30:00Z"))).toBe("2026-08");
    expect(previousPeriodKey(new Date("2026-10-01T12:00:00Z"))).toBe("2026-09");
    expect(() => periodBounds("2026-13")).toThrow();
  });
});

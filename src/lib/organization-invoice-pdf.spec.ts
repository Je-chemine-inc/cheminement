import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildOrganizationInvoicePdfBuffer,
  formatMoney,
  type OrganizationInvoicePdfInput,
} from "@/lib/organization-invoice-pdf";

/**
 * Spec 002, Loi 25 — the PDF an organization receives. Even when handed line
 * objects that carry clinical fields (a future bug upstream), the document
 * prints none of them: it reads lines field by field.
 */

const clinicalLine = (i: number) =>
  ({
    sessionDate: new Date(Date.UTC(2026, 8, 1 + (i % 28), 12)),
    patientFullName: `Patient${i} Roy`,
    caseNumber: `CASE${i}`,
    professionalName: "Sam Pro",
    professionalTitle: "Psychotherapeute",
    professionalLicence: "OPQ12345",
    durationMinutes: 50,
    amountCents: 9000,
    // Smuggled in: none of this may be printed.
    issueType: "SUICIDAIRE",
    sessionActNature: "PSYCHOTHERAPIE",
    therapyType: "COUPLETHERAPY",
    notes: "NOTESCLINIQUES",
    clientEmail: "SECRETMAIL@example.com",
  }) as unknown as OrganizationInvoicePdfInput["lines"][number];

const input = (over: Partial<OrganizationInvoicePdfInput> = {}): OrganizationInvoicePdfInput => ({
  language: "fr",
  kind: "statement",
  number: "JCO-2026-000007",
  issuedAt: new Date("2026-10-01T13:00:00Z"),
  dueAt: new Date("2026-10-31T13:00:00Z"),
  periodLabel: "2026-09",
  billTo: { name: "PAE Desjardins", contactName: "Marie", addressLines: ["1 rue X", "Montreal QC"] },
  platform: { name: "Je chemine", addressLines: ["2 rue Y"], phone: "5145550100", email: "support@jechemine.ca" },
  lines: [clinicalLine(1), clinicalLine(2)],
  totalCents: 18000,
  paidCents: 0,
  balanceCents: 18000,
  interacEmail: "paiement@jechemine.ca",
  ...over,
});

const textOf = (buf: Buffer) => buf.toString("latin1");

describe("the organization's PDF", () => {
  it("prints the approved facts: names, case numbers, professional, number and balance", () => {
    const pdf = textOf(buildOrganizationInvoicePdfBuffer(input()));
    for (const word of ["JCO-2026-000007", "Patient1 Roy", "CASE1", "Patient2 Roy", "Sam Pro", "OPQ12345", "PAE Desjardins", "paiement@jechemine.ca"]) {
      expect(pdf).toContain(word);
    }
  });

  it("never prints anything clinical or a client's contact details", () => {
    const pdf = textOf(buildOrganizationInvoicePdfBuffer(input()));
    for (const word of ["SUICIDAIRE", "PSYCHOTHERAPIE", "COUPLETHERAPY", "NOTESCLINIQUES", "SECRETMAIL"]) {
      expect(pdf).not.toContain(word);
    }
  });

  it("spreads a long statement over several pages without losing a line", () => {
    const lines = Array.from({ length: 60 }, (_, i) => clinicalLine(i));
    const pdf = textOf(buildOrganizationInvoicePdfBuffer(input({ lines, totalCents: 540000, balanceCents: 540000 })));
    expect(pdf).toContain("Patient0 Roy");
    expect(pdf).toContain("Patient59 Roy");
    expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it("speaks the organization's language", () => {
    expect(textOf(buildOrganizationInvoicePdfBuffer(input({ language: "en", kind: "session" })))).toContain("INVOICE");
    expect(formatMoney(12050, "fr")).toBe("120,50 $");
    expect(formatMoney(12050, "en")).toBe("$120.50");
  });

  it("shows a credit (a refund marked « plus dû ») as taken off, so the lines add up", () => {
    const pdf = textOf(
      buildOrganizationInvoicePdfBuffer(input({ totalCents: 18000, creditedCents: 5000, paidCents: 13000, balanceCents: 0 })),
    );
    expect(pdf).toMatch(/Cr.dit/);
    expect(pdf).toContain("-50,00 $");
    const without = textOf(buildOrganizationInvoicePdfBuffer(input()));
    expect(without).not.toMatch(/Cr.dit/);
    expect(without).not.toContain("-50,00 $");
  });
});

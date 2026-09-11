import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import {
  decideFormForSend,
  isFormEditable,
  linesFingerprint,
  organizationFormFileName,
  sha256Hex,
  storedFileBytes,
} from "@/lib/organization-invoice-form";

/**
 * Spec 002 phase 7 — the organization's own claim form: when it matches the
 * invoice, what goes out, and under which name.
 */

const A1 = new mongoose.Types.ObjectId("0123456789abcdef01234561");
const A2 = new mongoose.Types.ObjectId("0123456789abcdef01234562");
const line = (appointmentId: mongoose.Types.ObjectId, over: Record<string, unknown> = {}) => ({
  appointmentId,
  sessionDate: new Date("2026-09-10T12:00:00Z"),
  patientFullName: "Léa Roy",
  caseNumber: "PAE-778",
  professionalName: "Sam Pro",
  professionalTitle: "Psychologue",
  professionalLicence: "OPQ 1234",
  durationMinutes: 50,
  amountCents: 9000,
  ...over,
});

describe("linesFingerprint", () => {
  const base = linesFingerprint([line(A1), line(A2)]);

  it("is the same whatever the order of the lines, and for ids as strings", () => {
    expect(linesFingerprint([line(A2), line(A1)])).toBe(base);
    expect(linesFingerprint([line(A1), { ...line(A2), appointmentId: String(A2) as never }])).toBe(base);
  });

  it("changes with anything the form was filled in from", () => {
    const changed: Array<Record<string, unknown>> = [
      { amountCents: 12000 },
      { sessionDate: new Date("2026-09-11T12:00:00Z") },
      { patientFullName: "Zoé Roy" },
      { caseNumber: "PAE-779" },
      { professionalName: "Alex Pro" },
      { professionalLicence: "OPQ 9999" },
      { durationMinutes: 60 },
    ];
    for (const over of changed) {
      expect(linesFingerprint([line(A1), line(A2, over)])).not.toBe(base);
    }
    expect(linesFingerprint([line(A1)])).not.toBe(base);
  });

  it("ignores the professional's title — a cosmetic edit must not stale every form", () => {
    expect(linesFingerprint([line(A1), line(A2, { professionalTitle: "Psychothérapeute" })])).toBe(base);
  });
});

describe("decideFormForSend", () => {
  const lines = [line(A1), line(A2)];
  const matching = { linesFingerprint: linesFingerprint(lines) };
  const stale = { linesFingerprint: "attached-to-other-lines" };
  const decide = (requiresOwnForm: boolean, attachment: typeof matching | null, withoutOwnForm?: boolean) =>
    decideFormForSend({ requiresOwnForm, attachment, lines, withoutOwnForm });

  it("sends a matching form", () => {
    expect(decide(true, matching)).toEqual({ kind: "attach" });
    // Attached although not required: it still goes.
    expect(decide(false, matching)).toEqual({ kind: "attach" });
  });

  it("refuses when the form is required and missing, or out of date", () => {
    expect(decide(true, null)).toEqual({ kind: "refuse", code: "OWN_FORM_MISSING" });
    expect(decide(true, stale)).toEqual({ kind: "refuse", code: "OWN_FORM_STALE" });
    expect(decide(false, stale)).toEqual({ kind: "refuse", code: "OWN_FORM_STALE" });
  });

  it("an admin's « send without it » wins over both refusals", () => {
    expect(decide(true, null, true)).toEqual({ kind: "without" });
    expect(decide(true, stale, true)).toEqual({ kind: "without" });
    expect(decide(false, matching, true)).toEqual({ kind: "without" });
  });

  it("nothing to decide for an organization with no form", () => {
    expect(decide(false, null)).toEqual({ kind: "none" });
    // Nothing to skip: not recorded as a decision.
    expect(decide(false, null, true)).toEqual({ kind: "none" });
  });
});

describe("organizationFormFileName", () => {
  it("is fixed, from the invoice number, in the organization's language", () => {
    expect(organizationFormFileName("JCO-2026-000007", "fr")).toBe("JCO-2026-000007-formulaire.pdf");
    expect(organizationFormFileName("JCO-2026-000007", "en")).toBe("JCO-2026-000007-form.pdf");
  });

  it("has a name before the number exists, and keeps nothing unsafe", () => {
    expect(organizationFormFileName(null, "fr")).toBe("brouillon-formulaire.pdf");
    expect(organizationFormFileName("", "en")).toBe("draft-form.pdf");
    expect(organizationFormFileName('JCO-1/../"x', "fr")).toBe("JCO-1x-formulaire.pdf");
  });
});

describe("the rest", () => {
  it("reads the bytes of a stored file, Buffer or BSON Binary", () => {
    const bytes = Buffer.from("%PDF");
    expect(storedFileBytes(bytes)).toBe(bytes);
    expect(storedFileBytes({ buffer: new Uint8Array(bytes) }).toString()).toBe("%PDF");
  });

  it("editable while the invoice can still be sent or resent", () => {
    for (const s of ["draft", "issuing", "sent", "overdue", "partially_paid"]) expect(isFormEditable(s)).toBe(true);
    for (const s of ["paid", "void", "refunded", undefined]) expect(isFormEditable(s)).toBe(false);
  });

  it("hashes like sha256", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

/**
 * The schemas are strict: a field missing from them is dropped silently from
 * a $push — the send log would lose the record of the form that went out.
 */
describe("the invoice model keeps what the form feature writes", () => {
  it("the attachment and the send log's form and decision survive", () => {
    const fileId = new mongoose.Types.ObjectId();
    const doc = new OrganizationInvoice({
      kind: "session",
      organizationId: new mongoose.Types.ObjectId(),
      draftKey: "session:x",
      attachment: {
        fileId,
        fileName: "Formulaire.pdf",
        size: 12,
        sha256: "abc",
        scanStatus: "clean",
        linesFingerprint: "fp",
        uploadedAt: new Date(),
      },
      sendLog: [
        { at: new Date(), to: ["a@b.ca"], kind: "sent", attachment: { fileId, fileName: "JCO-1-formulaire.pdf", size: 12, sha256: "abc" } },
        { at: new Date(), to: ["a@b.ca"], kind: "resent", withoutOwnForm: true },
      ],
    });
    expect(doc.validateSync()).toBeUndefined();
    const o = doc.toObject();
    expect(o.attachment).toMatchObject({ fileName: "Formulaire.pdf", sha256: "abc", linesFingerprint: "fp" });
    expect(o.sendLog[0].attachment).toMatchObject({ fileName: "JCO-1-formulaire.pdf", sha256: "abc" });
    expect(o.sendLog[1].withoutOwnForm).toBe(true);
  });

  it("an invoice without a form has no empty one", () => {
    const doc = new OrganizationInvoice({ kind: "session", organizationId: new mongoose.Types.ObjectId(), draftKey: "session:y" });
    expect(doc.toObject().attachment).toBeUndefined();
  });
});

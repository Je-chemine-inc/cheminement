/**
 * Regression: an Interac payment had TWO different "mandatory" references.
 * The pre-session instructions gave the INT- code; the post-session invoice
 * gave the fiscal invoice number. Same appointment, two answers depending on
 * when the client happened to pay — so nothing could be matched automatically,
 * and a client reading both emails could not tell which one counted.
 *
 * The INT- code is the one everything unifies onto, because it exists from the
 * moment Interac is chosen; `nextInvoiceNumber` is a gap-free fiscal counter
 * allocated at closure and cannot be handed out before the session.
 */
import { describe, it, expect } from "vitest";
import {
  buildInteracReferenceCode,
  resolveInteracReferenceCode,
} from "./interac-reference";

const APPT = "6a95c2524e935d1a706eebe5";
const PRO = "6a393e4d794b4b1a59561b7f";

describe("resolveInteracReferenceCode", () => {
  it("keeps the code already stored on the appointment", () => {
    expect(resolveInteracReferenceCode("INT-1B7F-AF7CD2", APPT, PRO)).toBe(
      "INT-1B7F-AF7CD2",
    );
  });

  it("derives the same code the pre-session flow would have stored", () => {
    // request-transfer-guarantee stores buildInteracReferenceCode(...). An
    // appointment that never went through it must still resolve identically,
    // or the client is told one thing before the session and another after.
    expect(resolveInteracReferenceCode(null, APPT, PRO)).toBe(
      buildInteracReferenceCode(APPT, PRO),
    );
  });

  it("gives the SAME code for a populated professional as for a bare id", () => {
    // Every caller loads the appointment with .populate("professionalId"), so
    // the ref is a DOCUMENT. Calling toString() on it yields the document, not
    // the hex id — which would silently produce a different reference here than
    // the one the pre-session flow stored.
    const populated = { _id: PRO, firstName: "Sassi", lastName: "Essid" };
    expect(resolveInteracReferenceCode(null, APPT, populated)).toBe(
      resolveInteracReferenceCode(null, APPT, PRO),
    );
  });

  it("handles an ObjectId-like ref that stringifies to its hex", () => {
    const objectIdLike = { toString: () => PRO };
    expect(resolveInteracReferenceCode(null, APPT, objectIdLike)).toBe(
      resolveInteracReferenceCode(null, APPT, PRO),
    );
  });

  it("still produces a usable code with no professional at all", () => {
    const code = resolveInteracReferenceCode(null, APPT, undefined);
    expect(code).toMatch(/^INT-[0-9A-F]{4}-[0-9A-F]{6}$/);
  });

  it("treats a blank stored value as absent", () => {
    expect(resolveInteracReferenceCode("   ", APPT, PRO)).toBe(
      buildInteracReferenceCode(APPT, PRO),
    );
    expect(resolveInteracReferenceCode("", APPT, PRO)).toBe(
      buildInteracReferenceCode(APPT, PRO),
    );
  });

  it("is stable — the same appointment always resolves to the same code", () => {
    const a = resolveInteracReferenceCode(null, APPT, PRO);
    const b = resolveInteracReferenceCode(null, APPT, PRO);
    expect(a).toBe(b);
  });

  it("distinguishes two appointments of the same professional", () => {
    const other = "6a933645533dc0db0e07b37f";
    expect(resolveInteracReferenceCode(null, APPT, PRO)).not.toBe(
      resolveInteracReferenceCode(null, other, PRO),
    );
  });

  it("never returns a fiscal invoice number", () => {
    // The invoice number is the DOCUMENT reference, never the transfer note.
    expect(resolveInteracReferenceCode(null, APPT, PRO)).not.toMatch(/^JC-/);
  });
});

/**
 * Parsed against the REAL notification bodies sitting in the production
 * paiement@jechemine.ca mailbox — including the two cases that decide whether
 * automatic reconciliation is safe: a transfer WITH the reference code in the
 * memo, and one with no memo at all.
 */
import { describe, it, expect } from "vitest";
import {
  isInteracNotificationSender,
  parseFrenchAmount,
  parseInteracNotification,
} from "./interac-notification";

/** Verbatim from production — sender wrote the code in the memo. */
const WITH_MEMO = `Bonjour JE CHEMINE INC.,

Les fonds ont été déposés!
25,00 $

Vos fonds ont été déposés automatiquement dans votre compte à la Desjardins.


Desjardins
Compte dont le numéro se termine par 5485

Précisions sur le virement

Message :
Élorie Braën INT-9126-0AE49D

Date : 31 août 2026
Numéro de référence : C1AVzjTtqRCM
Envoyé par : ELORIE BRAEN
Montant : 25,00 $ (CAD)
`;

/** Verbatim from production — sender wrote NO memo. */
const WITHOUT_MEMO = `Bonjour JE CHEMINE INC.,

Les fonds ont été déposés!
175,00 $

Vos fonds ont été déposés automatiquement dans votre compte à la Desjardins.


Desjardins
Compte dont le numéro se termine par 5485

Précisions sur le virement

Date : 1 sept. 2026
Numéro de référence : C1A7xaez4HBj
Envoyé par : Heifa Ferjani
Montant : 175,00 $ (CAD)
`;

const interac = (text: string, subject = "Virement Interac : Vous avez reçu") => ({
  from: "notify@payments.interac.ca",
  subject,
  text,
});

describe("isInteracNotificationSender", () => {
  it("accepts the real Interac notification senders", () => {
    expect(isInteracNotificationSender("notify@payments.interac.ca")).toBe(true);
    expect(isInteracNotificationSender("catch@payments.interac.ca")).toBe(true);
    expect(isInteracNotificationSender("Interac <notify@payments.interac.ca>")).toBe(true);
  });

  it("rejects anyone else — a body is forgeable, the sender is the gate", () => {
    expect(isInteracNotificationSender("notify@payments.interac.ca.evil.com")).toBe(false);
    expect(isInteracNotificationSender("attacker@gmail.com")).toBe(false);
    expect(isInteracNotificationSender("support@jechemine.ca")).toBe(false);
    expect(isInteracNotificationSender("")).toBe(false);
    expect(isInteracNotificationSender(null)).toBe(false);
  });
});

describe("parseFrenchAmount", () => {
  it("reads the French decimal comma", () => {
    expect(parseFrenchAmount("175,00 $")).toBe(175);
    expect(parseFrenchAmount("25,00 $ (CAD)")).toBe(25);
    expect(parseFrenchAmount("8,50 $")).toBe(8.5);
  });

  it("handles thousands separators, including non-breaking spaces", () => {
    expect(parseFrenchAmount("1 234,56 $")).toBe(1234.56);
    expect(parseFrenchAmount("1\u00a0234,56 $")).toBe(1234.56);
    expect(parseFrenchAmount("1\u202f234,56 $")).toBe(1234.56);
  });

  it("returns null for anything unusable", () => {
    expect(parseFrenchAmount("")).toBeNull();
    expect(parseFrenchAmount(null)).toBeNull();
    expect(parseFrenchAmount("aucun montant")).toBeNull();
    expect(parseFrenchAmount("0,00 $")).toBeNull();
  });
});

describe("parseInteracNotification — real production notifications", () => {
  it("extracts everything from a transfer that carries our code", () => {
    const p = parseInteracNotification(interac(WITH_MEMO))!;

    expect(p.amountCad).toBe(25);
    expect(p.referenceCode).toBe("INT-9126-0AE49D");
    expect(p.interacTransactionRef).toBe("C1AVzjTtqRCM");
    expect(p.payerName).toBe("ELORIE BRAEN");
    expect(p.memo).toBe("Élorie Braën INT-9126-0AE49D");
  });

  it("parses a transfer with NO memo, and reports no code", () => {
    // This is the case that must never be auto-settled: money arrived, but
    // nothing says which invoice it belongs to.
    const p = parseInteracNotification(interac(WITHOUT_MEMO))!;

    expect(p.amountCad).toBe(175);
    expect(p.memo).toBeNull();
    expect(p.referenceCode).toBeNull();
    expect(p.interacTransactionRef).toBe("C1A7xaez4HBj");
    expect(p.payerName).toBe("Heifa Ferjani");
  });

  it("does not mistake the Date line for the memo", () => {
    const p = parseInteracNotification(interac(WITH_MEMO))!;
    expect(p.memo).not.toMatch(/Date/);
    expect(p.memo).not.toMatch(/Numéro/);
  });

  it("refuses mail from anyone but Interac, however convincing the body", () => {
    expect(
      parseInteracNotification({
        from: "attacker@gmail.com",
        subject: "Virement Interac : Vous avez reçu 5000,00 $",
        text: WITH_MEMO,
      }),
    ).toBeNull();
  });

  it("returns null when there is no amount to reconcile", () => {
    expect(
      parseInteracNotification(interac("Bonjour, ceci n'est pas un dépôt.", "Info")),
    ).toBeNull();
  });

  it("falls back to the subject when the body has no Montant line", () => {
    const p = parseInteracNotification({
      from: "notify@payments.interac.ca",
      subject: "Virement Interac : Vous avez reçu 175,00 $ de Heifa Ferjani",
      text: "Les fonds ont été déposés!",
    })!;
    expect(p.amountCad).toBe(175);
  });

  it("uppercases a lower-cased reference code", () => {
    const p = parseInteracNotification(
      interac(WITH_MEMO.replace("INT-9126-0AE49D", "int-9126-0ae49d")),
    )!;
    expect(p.referenceCode).toBe("INT-9126-0AE49D");
  });

  it("tolerates CRLF line endings", () => {
    const p = parseInteracNotification(interac(WITH_MEMO.replace(/\n/g, "\r\n")))!;
    expect(p.referenceCode).toBe("INT-9126-0AE49D");
    expect(p.amountCad).toBe(25);
  });
});

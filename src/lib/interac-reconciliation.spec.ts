/**
 * The decision that moves money. Marking an invoice paid issues the fiscal
 * receipt and stops all dunning, so this must settle ONLY on an exact match and
 * hand everything else to a human.
 *
 * The three cases below are not hypothetical — all are already sitting in the
 * production paiement@ mailbox.
 */
import { describe, it, expect } from "vitest";
import {
  decideInteracReconciliation,
  decideOrganizationInteracReconciliation,
} from "./interac-reconciliation";

const CODE = "INT-9126-0AE49D";
const unpaid = { paymentStatus: "pending", priceCad: 150, appointmentStatus: "scheduled" };

describe("decideInteracReconciliation", () => {
  it("settles a transfer that names the session and pays it exactly", () => {
    const d = decideInteracReconciliation(
      { amountCad: 150, referenceCode: CODE, payerName: "ELORIE BRAEN" },
      unpaid,
    );
    expect(d.action).toBe("settle");
    expect(d.reason).toBe("matched");
    expect(d.detail).toContain(CODE);
    expect(d.detail).toContain("ELORIE BRAEN");
  });

  it("REFUSES a partial payment — the real 25 $ against a 150 $ session", () => {
    // Settling this would issue a receipt for a session 125 $ short and stop
    // the reminders, silently writing off the balance.
    const d = decideInteracReconciliation(
      { amountCad: 25, referenceCode: CODE, payerName: "ELORIE BRAEN" },
      unpaid,
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("amount_mismatch");
    expect(d.detail).toContain("manque");
    expect(d.detail).toContain("125.00 $");
  });

  it("REFUSES an overpayment too", () => {
    const d = decideInteracReconciliation(
      { amountCad: 175, referenceCode: CODE },
      unpaid,
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("amount_mismatch");
    expect(d.detail).toContain("surplus");
  });

  it("REFUSES a transfer with no reference — the real no-memo case", () => {
    const d = decideInteracReconciliation(
      { amountCad: 175, referenceCode: null, payerName: "Heifa Ferjani" },
      null,
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("no_reference");
    expect(d.detail).toContain("Heifa Ferjani");
  });

  it("REFUSES a reference no session carries", () => {
    const d = decideInteracReconciliation(
      { amountCad: 150, referenceCode: "INT-0000-000000" },
      null,
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("unknown_reference");
  });

  it("flags a second transfer for an already-paid session instead of re-settling", () => {
    const d = decideInteracReconciliation(
      { amountCad: 150, referenceCode: CODE },
      { ...unpaid, paymentStatus: "paid" },
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("already_paid");
    expect(d.detail).toContain("double");
  });

  it.each(["processing", "refunded", "partially_refunded", "cancelled"])(
    "never re-settles a payment already in state %s",
    (status) => {
      const d = decideInteracReconciliation(
        { amountCad: 150, referenceCode: CODE },
        { ...unpaid, paymentStatus: status },
      );
      expect(d.action).toBe("review");
      expect(d.reason).toBe("already_paid");
    },
  );

  it("never settles a session a third party pays — sends it to review", () => {
    const d = decideInteracReconciliation(
      { amountCad: 150, referenceCode: CODE },
      { ...unpaid, paymentStatus: "covered" },
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("covered_by_third_party");
  });

  it("still settles an OVERDUE invoice — overdue is genuinely unpaid", () => {
    const d = decideInteracReconciliation(
      { amountCad: 150, referenceCode: CODE },
      { ...unpaid, paymentStatus: "overdue" },
    );
    expect(d.action).toBe("settle");
  });

  it("flags a transfer for a cancelled session — a refund may be owed", () => {
    const d = decideInteracReconciliation(
      { amountCad: 150, referenceCode: CODE },
      { ...unpaid, appointmentStatus: "cancelled" },
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("cancelled");
  });

  it("flags a session with nothing to collect", () => {
    const d = decideInteracReconciliation(
      { amountCad: 150, referenceCode: CODE },
      { ...unpaid, priceCad: 0 },
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("no_amount_due");
  });

  it("compares money in cents, not floats", () => {
    // 0.1 + 0.2 style drift must not turn an exact payment into a mismatch.
    const d = decideInteracReconciliation(
      { amountCad: 0.1 + 0.2, referenceCode: CODE },
      { ...unpaid, priceCad: 0.3 },
    );
    expect(d.action).toBe("settle");
  });

  it("catches a one-cent shortfall", () => {
    const d = decideInteracReconciliation(
      { amountCad: 149.99, referenceCode: CODE },
      unpaid,
    );
    expect(d.action).toBe("review");
    expect(d.reason).toBe("amount_mismatch");
  });
});

describe("decideOrganizationInteracReconciliation (spec 002)", () => {
  const REF = "JCO-2026-000007";
  const open = { number: REF, status: "sent", balanceCents: 18000 };
  const decide = (amountCad: number, invoice: Parameters<typeof decideOrganizationInteracReconciliation>[1]) =>
    decideOrganizationInteracReconciliation({ amountCad, referenceCode: REF, payerName: "PAE DESJARDINS" }, invoice);

  it("settles only the exact balance, to the cent", () => {
    expect(decide(180, open)).toMatchObject({ action: "settle", reason: "matched" });
    expect(decide(180, { ...open, status: "partially_paid", balanceCents: 9000 }).action).toBe("review");
    expect(decide(90, { ...open, status: "partially_paid", balanceCents: 9000 }).action).toBe("settle");
    expect(decide(179.99, open)).toMatchObject({ action: "review", reason: "amount_mismatch" });
    expect(decide(200, open).detail).toContain("surplus");
  });

  it("hands everything else to a person", () => {
    expect(decide(180, null).reason).toBe("unknown_reference");
    expect(decide(180, { ...open, status: "void" }).reason).toBe("cancelled");
    expect(decide(180, { ...open, status: "paid", balanceCents: 0 }).reason).toBe("already_paid");
    expect(decide(180, { ...open, status: "issuing" }).reason).toBe("no_amount_due");
    expect(decide(180, { ...open, status: "refunded" }).reason).toBe("no_amount_due");
  });
});

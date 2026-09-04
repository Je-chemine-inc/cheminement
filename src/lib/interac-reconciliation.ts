/**
 * Should an Interac transfer settle an invoice automatically?
 *
 * Marking money received is irreversible in the client's eyes: it issues the
 * fiscal receipt and stops all dunning. So this errs hard towards handing the
 * transfer to a human. Automatic settlement happens ONLY when the transfer
 * names an appointment and pays it exactly; everything else is surfaced for
 * review with the reason, and nothing is written.
 *
 * Both real cases already sitting in the production mailbox are covered:
 *   - a transfer whose memo carries the INT- code, for the exact amount → settle
 *   - a transfer with no memo at all → review ("no reference"), because money
 *     arrived but nothing says whose it is
 *   - and the awkward one: a memo with the right code but a PARTIAL amount
 *     (25,00 $ against a 150 $ session) → review, never a silent write-off
 *
 * Pure: no database, no Stripe, no email. The caller performs the action.
 */

export type ReconciliationAction = "settle" | "review";

export type ReconciliationReason =
  | "matched"
  | "no_reference"
  | "unknown_reference"
  | "already_paid"
  | "amount_mismatch"
  | "no_amount_due"
  | "cancelled";

export interface ReconciliationDecision {
  action: ReconciliationAction;
  reason: ReconciliationReason;
  /** Human-readable, stored on the appointment / shown to an admin. */
  detail: string;
}

export interface TransferFacts {
  amountCad: number;
  referenceCode: string | null;
  payerName?: string | null;
}

export interface InvoiceFacts {
  /** Appointment payment status, e.g. "pending" | "paid" | "overdue". */
  paymentStatus?: string | null;
  /** Amount the client owes for this appointment. */
  priceCad?: number | null;
  /** Appointment status — a cancelled session owes nothing. */
  appointmentStatus?: string | null;
}

/** Payment states where the money question is already closed. */
const SETTLED = [
  "paid",
  "processing",
  "refunded",
  "partially_refunded",
  "cancelled",
];

/** Money compares in cents; never trust float equality on dollars. */
const cents = (n: number): number => Math.round(n * 100);

const money = (n: number): string => `${n.toFixed(2)} $`;

export function decideInteracReconciliation(
  transfer: TransferFacts,
  invoice: InvoiceFacts | null,
): ReconciliationDecision {
  if (!transfer.referenceCode) {
    return {
      action: "review",
      reason: "no_reference",
      detail:
        `Virement de ${money(transfer.amountCad)} sans référence` +
        (transfer.payerName ? ` (de ${transfer.payerName})` : "") +
        " — aucun code INT- dans le message, impossible d'identifier la séance.",
    };
  }

  if (!invoice) {
    return {
      action: "review",
      reason: "unknown_reference",
      detail: `Référence ${transfer.referenceCode} inconnue — aucune séance ne porte ce code.`,
    };
  }

  if (invoice.appointmentStatus === "cancelled") {
    return {
      action: "review",
      reason: "cancelled",
      detail: `La séance ${transfer.referenceCode} est annulée — un remboursement est peut-être dû.`,
    };
  }

  if (SETTLED.includes(invoice.paymentStatus ?? "")) {
    return {
      action: "review",
      reason: "already_paid",
      detail:
        `La séance ${transfer.referenceCode} est déjà réglée ` +
        `(${invoice.paymentStatus}) — virement possiblement en double.`,
    };
  }

  const due = typeof invoice.priceCad === "number" ? invoice.priceCad : 0;
  if (due <= 0) {
    return {
      action: "review",
      reason: "no_amount_due",
      detail: `La séance ${transfer.referenceCode} n'a aucun montant à percevoir.`,
    };
  }

  if (cents(transfer.amountCad) !== cents(due)) {
    const diff = transfer.amountCad - due;
    return {
      action: "review",
      reason: "amount_mismatch",
      detail:
        `Montant reçu ${money(transfer.amountCad)} ≠ montant dû ${money(due)} ` +
        `pour ${transfer.referenceCode} (${diff > 0 ? "surplus" : "manque"} ` +
        `${money(Math.abs(diff))}).`,
    };
  }

  return {
    action: "settle",
    reason: "matched",
    detail:
      `Virement Interac de ${money(transfer.amountCad)} associé automatiquement ` +
      `à ${transfer.referenceCode}` +
      (transfer.payerName ? ` (envoyé par ${transfer.payerName})` : "") +
      ".",
  };
}

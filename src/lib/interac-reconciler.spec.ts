/**
 * The runner that actually moves money. Pins the four properties that make
 * automatic reconciliation safe to leave running unattended:
 *   - only mail genuinely from Interac is acted on;
 *   - only an exact amount match settles;
 *   - a notification is never processed twice;
 *   - every outcome is stamped on the message for the admin to review.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const APPT_ID = "6a921534f57c54b1580ae49d";
const CODE = "INT-9126-0AE49D";

const h = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  appointment: null as Record<string, unknown> | null,
  settle: vi.fn(),
  updates: [] as Array<{ id: unknown; $set: Record<string, string> }>,
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/payment-settlement", () => ({
  settleInteracPayment: (...a: unknown[]) => h.settle(...a),
}));
vi.mock("@/models/Appointment", () => ({
  default: { findOne: vi.fn(async () => h.appointment) },
}));
vi.mock("@/models/ExternalMessage", () => ({
  default: {
    find: () => ({ sort: () => ({ limit: async () => h.messages }) }),
    findByIdAndUpdate: async (id: unknown, update: { $set: Record<string, string> }) => {
      h.updates.push({ id, $set: update.$set });
      return null;
    },
  },
}));

import { runInteracReconciliation } from "@/lib/interac-reconciler";

const body = (amount: string, memo?: string) =>
  [
    "Bonjour JE CHEMINE INC.,",
    "",
    "Les fonds ont été déposés!",
    `${amount} $`,
    "",
    "Précisions sur le virement",
    "",
    ...(memo ? ["Message :", memo, ""] : []),
    "Date : 31 août 2026",
    "Numéro de référence : C1AVzjTtqRCM",
    "Envoyé par : ELORIE BRAEN",
    `Montant : ${amount} $ (CAD)`,
  ].join("\n");

const notification = (amount: string, memo?: string) => ({
  _id: "msg1",
  emailMessageId: "<abc@interac>",
  senderEmail: "notify@payments.interac.ca",
  subject: "Virement Interac : Vous avez reçu",
  message: body(amount, memo),
});

const appointmentFor = (price: number, status = "pending") => ({
  _id: APPT_ID,
  status: "scheduled",
  payment: { status, price, interacReferenceCode: CODE },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.messages.length = 0;
  h.updates.length = 0;
  h.appointment = null;
  h.settle.mockResolvedValue({ found: true, alreadyPaid: false, payment: {} });
});

describe("runInteracReconciliation", () => {
  it("settles an exact match and records the payer for audit", async () => {
    h.messages.push(notification("150,00", `Élorie Braën ${CODE}`));
    h.appointment = appointmentFor(150);

    const run = await runInteracReconciliation();

    expect(run.settled).toBe(1);
    expect(run.review).toBe(0);
    expect(h.settle).toHaveBeenCalledTimes(1);
    const [id, opts] = h.settle.mock.calls[0] as [string, Record<string, string>];
    expect(id).toBe(APPT_ID);
    expect(opts.payerName).toBe("ELORIE BRAEN");
    expect(opts.note).toContain("C1AVzjTtqRCM");
  });

  it("does NOT settle a partial payment — the real 25 $ / 150 $ case", async () => {
    h.messages.push(notification("25,00", `Élorie Braën ${CODE}`));
    h.appointment = appointmentFor(150);

    const run = await runInteracReconciliation();

    expect(run.settled).toBe(0);
    expect(run.review).toBe(1);
    expect(h.settle).not.toHaveBeenCalled();
    expect(run.outcomes[0].reason).toBe("amount_mismatch");
  });

  it("does NOT settle a transfer with no memo", async () => {
    h.messages.push(notification("175,00"));

    const run = await runInteracReconciliation();

    expect(run.settled).toBe(0);
    expect(h.settle).not.toHaveBeenCalled();
    expect(run.outcomes[0].reason).toBe("no_reference");
  });

  it("ignores mail that only claims to be Interac", async () => {
    h.messages.push({
      ...notification("150,00", `Élorie Braën ${CODE}`),
      senderEmail: "attacker@gmail.com",
    });
    h.appointment = appointmentFor(150);

    const run = await runInteracReconciliation();

    expect(h.settle).not.toHaveBeenCalled();
    expect(run.settled).toBe(0);
    expect(run.skipped).toBe(1);
  });

  it("stamps every notification as processed, settled or not", async () => {
    h.messages.push(notification("175,00"));

    await runInteracReconciliation();

    expect(h.updates).toHaveLength(1);
    const $set = h.updates[0].$set;
    // The marker is what makes a re-run free and can never be skipped.
    expect($set["metadata.interacReconciledAt"]).toBeTruthy();
    expect($set["metadata.interac_reason"]).toBe("no_reference");
  });

  it("records the reason on the message so an admin can act on it", async () => {
    h.messages.push(notification("25,00", `Élorie Braën ${CODE}`));
    h.appointment = appointmentFor(150);

    await runInteracReconciliation();

    const $set = h.updates[0].$set;
    expect($set["metadata.interac_action"]).toBe("review");
    expect($set["metadata.interac_detail"]).toContain("125.00 $");
    expect($set["metadata.interac_appointmentId"]).toBe(APPT_ID);
  });

  it("never re-settles an invoice already paid", async () => {
    h.messages.push(notification("150,00", `Élorie Braën ${CODE}`));
    h.appointment = appointmentFor(150, "paid");

    const run = await runInteracReconciliation();

    expect(h.settle).not.toHaveBeenCalled();
    expect(run.outcomes[0].reason).toBe("already_paid");
  });

  it("flags a reference no session carries", async () => {
    h.messages.push(notification("150,00", "INT-0000-000000"));
    h.appointment = null;

    const run = await runInteracReconciliation();

    expect(h.settle).not.toHaveBeenCalled();
    expect(run.outcomes[0].reason).toBe("unknown_reference");
  });

  it("does nothing when there are no new notifications", async () => {
    const run = await runInteracReconciliation();
    expect(run).toMatchObject({ examined: 0, settled: 0, review: 0, skipped: 0 });
    expect(h.settle).not.toHaveBeenCalled();
  });
});

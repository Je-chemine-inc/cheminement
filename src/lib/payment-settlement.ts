import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import ClientReceipt from "@/models/ClientReceipt";
import { issueFiscalReceipt } from "@/lib/session-post-closure";

/**
 * Acknowledge an Interac e-transfer (or other out-of-band payment) for an
 * appointment, keeping the client-visible fiscal receipt in lockstep.
 *
 * Interac receipts are created `pending_transfer` and stay HIDDEN from the
 * client (the /api/client/receipts list returns only `paid`) until an admin
 * confirms the transfer. So marking the appointment paid MUST also flip the
 * linked ClientReceipt — otherwise the client never sees the receipt for a
 * payment they did make. Both admin "marquer comme payé" entry points (the
 * appointment-level button and the receipt-level button) funnel through here.
 * Idempotent.
 */
export async function settleInteracPayment(
  appointmentId: string,
  /**
   * Optional reconciliation metadata captured by the admin when associating an
   * Interac transfer (e.g. an "orphan" transfer received under a spouse's name).
   * Stored on the appointment for audit even when the payment is already paid.
   */
  opts?: { payerName?: string; note?: string },
): Promise<{
  found: boolean;
  alreadyPaid: boolean;
  payment: { status?: string; paidAt?: Date; method?: string } | null;
}> {
  await connectToDatabase();
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) return { found: false, alreadyPaid: false, payment: null };

  const payerName = opts?.payerName?.trim();
  const note = opts?.note?.trim();

  const alreadyPaid = appointment.payment?.status === "paid";
  if (!alreadyPaid) {
    appointment.payment.status = "paid";
    appointment.payment.paidAt = new Date();
    if (!appointment.payment.method) {
      appointment.payment.method = "transfer";
    }
  }
  // Persist the reconciliation metadata whenever provided (even on a re-confirm).
  if (payerName) appointment.payment.interacPayerName = payerName;
  if (note) appointment.payment.interacReconciliationNote = note;
  if (!alreadyPaid || payerName || note) {
    await appointment.save();
  }

  // GOLDEN RULE: the transfer is now confirmed → issue + send the official
  // receipt. This also flips the held `pending_transfer` row to `paid` (its
  // upsert), revealing it to the client. Must run BEFORE the explicit flip
  // below: issueFiscalReceipt skips sending if it sees an already-`paid` row.
  await issueFiscalReceipt(appointmentId).catch((err) =>
    console.error("issueFiscalReceipt (settleInteracPayment):", err),
  );

  // Legacy safety net: appointments closed before the golden-rule change have
  // `fiscalReceiptIssuedAt` set (so issueFiscalReceipt no-ops) but still carry a
  // `pending_transfer` row — reveal it. Scoped so we never resurrect a refund.
  await ClientReceipt.findOneAndUpdate(
    { appointmentId, status: "pending_transfer" },
    { $set: { status: "paid" } },
  );

  return {
    found: true,
    alreadyPaid,
    payment: {
      status: appointment.payment?.status,
      paidAt: appointment.payment?.paidAt,
      method: appointment.payment?.method,
    },
  };
}

/**
 * On refund, void the client's fiscal receipt so a refunded payment no longer
 * surfaces a valid paid receipt. The client list shows only `paid` (so a
 * `refunded` receipt drops out), and the on-demand PDF route is gated on
 * payment.status === "paid". Idempotent.
 */
export async function voidReceiptForRefund(
  appointmentId: string,
): Promise<void> {
  await connectToDatabase();
  await ClientReceipt.findOneAndUpdate(
    { appointmentId, status: { $ne: "refunded" } },
    { $set: { status: "refunded" } },
  );
}

/**
 * Reverse a receipt void when a refund later FAILS (Stripe charge.refund.updated
 * with status "failed"/"canceled"): the client effectively still paid, so the
 * voided receipt must be restored to "paid". Idempotent.
 */
export async function restoreReceiptForReversedRefund(
  appointmentId: string,
): Promise<void> {
  await connectToDatabase();
  await ClientReceipt.findOneAndUpdate(
    { appointmentId, status: "refunded" },
    { $set: { status: "paid" } },
  );
}

import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import ClientReceipt from "@/models/ClientReceipt";

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
export async function settleInteracPayment(appointmentId: string): Promise<{
  found: boolean;
  alreadyPaid: boolean;
  payment: { status?: string; paidAt?: Date; method?: string } | null;
}> {
  await connectToDatabase();
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) return { found: false, alreadyPaid: false, payment: null };

  const alreadyPaid = appointment.payment?.status === "paid";
  if (!alreadyPaid) {
    appointment.payment.status = "paid";
    appointment.payment.paidAt = new Date();
    if (!appointment.payment.method) {
      appointment.payment.method = "transfer";
    }
    await appointment.save();
  }

  // Reveal the receipt that was held back pending the transfer. Scoped to
  // `pending_transfer` so we never resurrect a refunded/voided receipt.
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

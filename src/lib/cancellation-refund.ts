/**
 * How much of a paid appointment goes back when it is cancelled (PATCH /api/appointments/[id]).
 * Pure, in integer cents.
 *
 * A client cancelling at least `freeHours` before gets everything back. Closer to the appointment a
 * client cannot cancel by themselves (the route refuses it), but a cancellation recorded as the
 * client's keeps a CANCELLATION_FEE_RATE fee. A cancellation by the professional or the team always
 * refunds in full.
 */
export const CANCELLATION_FEE_RATE = 0.15;

export function cancellationRefund(input: {
  /** The session's price, in dollars, as stored on the appointment. */
  priceCad: number;
  cancelledBy: string;
  hoursUntil: number;
  freeHours: number;
}): { refundCents: number; feeCents: number } {
  const priceCents = Math.max(0, Math.round((Number.isFinite(input.priceCad) ? input.priceCad : 0) * 100));
  const late = input.cancelledBy === "client" && input.hoursUntil < input.freeHours;
  const feeCents = late ? Math.round(priceCents * CANCELLATION_FEE_RATE) : 0;
  return { refundCents: priceCents - feeCents, feeCents };
}

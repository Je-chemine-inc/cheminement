/**
 * Human-facing receipt number — shown on the fiscal-receipt PDF ("Reçu n° …")
 * AND used as the PDF attachment filename, so the two always match. Uppercase,
 * e.g. appointmentId "…bda8a524" → "REC-BDA8A524".
 */
export function buildReceiptNumber(appointmentId: string): string {
  return `REC-${appointmentId.slice(-8).toUpperCase()}`;
}

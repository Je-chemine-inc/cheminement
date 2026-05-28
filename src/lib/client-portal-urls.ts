import crypto from "crypto";
import Appointment from "@/models/Appointment";

/**
 * URL resolution for cron-driven reminders sent to client recipients.
 *
 * Background: emails sent to recently-provisioned guest/prospect accounts
 * (no password yet, status !== "active") cannot link to auth-gated routes
 * like `/client/dashboard/*` — the user would land on the login screen
 * with no way to log in. The same `/pay?token=…` pattern used by the
 * jumelage email lets non-active recipients act on payment-method links
 * without authentication.
 *
 * Active clients still get the dashboard deep-links so they land where
 * they expect (their portal), not the lightweight `/pay` flow.
 */

const PAYMENT_TOKEN_TTL_DAYS = 14;
const PAYMENT_TOKEN_REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000;

type AppointmentWithPaymentToken = {
  _id: { toString: () => string };
  payment?: {
    paymentToken?: string;
    paymentTokenExpiry?: Date;
  };
};

/**
 * Returns the URL to point a "Choose / change payment method" CTA at.
 *
 * - Active client → auth-gated dashboard deep-link.
 * - Non-active   → tokenized `/pay?token=…` (mints/refreshes the token
 *   on the appointment if missing or expiring within 24h).
 */
export async function resolveBillingUrl(opts: {
  userStatus: string | undefined;
  appointment: AppointmentWithPaymentToken;
  base: string;
}): Promise<string> {
  const { userStatus, appointment, base } = opts;

  if (userStatus === "active") {
    return `${base}/client/dashboard/billing?action=addPaymentMethod`;
  }

  const existing = appointment.payment?.paymentToken;
  const expiry = appointment.payment?.paymentTokenExpiry;
  const stillFresh =
    existing &&
    expiry &&
    expiry.getTime() > Date.now() + PAYMENT_TOKEN_REFRESH_BUFFER_MS;

  if (stillFresh) {
    return `${base}/pay?token=${existing}`;
  }

  const newToken = crypto.randomBytes(32).toString("hex");
  const newExpiry = new Date(
    Date.now() + PAYMENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await Appointment.findByIdAndUpdate(appointment._id, {
    "payment.paymentToken": newToken,
    "payment.paymentTokenExpiry": newExpiry,
  });
  return `${base}/pay?token=${newToken}`;
}

/**
 * Returns the URL to point an appointment-management CTA at
 * (cancel / reschedule / confirm-attendance).
 *
 * - Active client → auth-gated dashboard deep-link with the requested action.
 * - Non-active   → claim-account URL so the user can set their password first,
 *   then manage their appointment. There is no public-token endpoint for
 *   appointment management yet; redirecting through `/signup/member` is the
 *   only way to keep the CTA actionable without exposing a write-endpoint
 *   to the open web.
 */
export function resolveAppointmentManageUrl(opts: {
  userStatus: string | undefined;
  recipientEmail: string;
  appointmentId: string;
  action: "cancel" | "confirm" | "reschedule";
  base: string;
}): string {
  const { userStatus, recipientEmail, appointmentId, action, base } = opts;

  if (userStatus === "active") {
    if (action === "reschedule") {
      return `${base}/appointment?for=self`;
    }
    return `${base}/client/dashboard/appointments?id=${encodeURIComponent(
      appointmentId,
    )}&action=${action}`;
  }

  return `${base}/signup/member?email=${encodeURIComponent(recipientEmail)}`;
}

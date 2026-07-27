/**
 * Payment emails reply to the dedicated payment inbox (paiement@…, the Interac
 * deposit address) instead of the general support inbox, so client payment
 * questions reach whoever handles money. This guards the type-routing set.
 */
import { describe, it, expect } from "vitest";
import { isPaymentEmailType } from "./notifications";
import type { EmailNotificationType } from "@/models/PlatformSettings";

describe("isPaymentEmailType", () => {
  it("routes every payment-category email to the payment inbox", () => {
    const paymentTypes: EmailNotificationType[] = [
      "interac_transfer_instructions",
      "interac_payment_reminder",
      "payment_invitation",
      "payment_failed",
      "payment_refund",
      "fiscal_receipt",
      "guest_payment_confirmation",
      "guest_payment_complete",
      "payment_guarantee_day1_reminder",
      "payment_guarantee_day2_reminder",
      "payment_guarantee_48h_client",
    ];
    for (const t of paymentTypes) {
      expect(isPaymentEmailType(t), t).toBe(true);
    }
  });

  it("leaves non-payment emails on the default (support) reply-to", () => {
    const nonPaymentTypes: EmailNotificationType[] = [
      "welcome",
      "email_verification",
      "password_reset",
      "appointment_confirmation",
      "appointment_reminder",
      "appointment_cancellation",
      "meeting_link",
      "professional_approval",
      // Pro-facing alert, not a client payment email — stays on default.
      "payment_guarantee_48h_professional",
      // Admin alert — stays on default.
      "admin_interac_trust_request",
    ];
    for (const t of nonPaymentTypes) {
      expect(isPaymentEmailType(t), t).toBe(false);
    }
  });
});

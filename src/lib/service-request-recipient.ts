/**
 * Resolve WHO receives the automatic acknowledgement ("Confirmation immédiate")
 * email for a new service request that has no professional assigned yet.
 *
 * This is the single source of truth shared by the authenticated booking route
 * (`/api/appointments`) and the guest route (`/api/appointments/guest`) so the
 * two paths can never drift. Recipient rules:
 *   - self                  → the requester (themselves) = fallback
 *   - loved-one <14         → the requester (parent owns the account; LSSSS art. 14) = fallback
 *   - loved-one 14+ adult   → the loved one directly, at lovedOneInfo.email
 *   - patient referral       → the PATIENT (referralInfo.patientEmail), so a doctor
 *                              referring a patient informs the patient, NOT the
 *                              referrer. When the patient email is blank (it is
 *                              OPTIONAL on the form) we fall back to the referrer
 *                              (= fallback) so the request is still acknowledged.
 *
 * Note: referralInfo.patientEmail is a plaintext Appointment subdocument field
 * (only referrerPhone/patientPhone are encrypted), so reading it here is safe.
 */
export interface ServiceRequestRecipientInput {
  bookingFor?: string | null;
  referralInfo?: {
    patientFirstName?: string;
    patientLastName?: string;
    patientEmail?: string;
  } | null;
  lovedOneInfo?: {
    firstName?: string;
    email?: string;
  } | null;
  /** Whether the loved one is under 14 (parent owns the account & comms). */
  lovedOneUnder14?: boolean;
  /**
   * The requester / guest — used as the fallback recipient for self, loved-one
   * <14, and the patient-referral case when no patient email was provided.
   */
  fallbackName?: string | null;
  fallbackEmail?: string | null;
}

/**
 * Which party the acknowledgement resolved to. Drives WHICH email is sent:
 *   - "patient"   → the referral confirmation (account-aware: log-in vs sign-up)
 *   - otherwise   → the generic service-request onboarding email
 */
export type ServiceRequestRecipientKind = "patient" | "loved-one" | "requester";

export interface ServiceRequestRecipient {
  toName: string | null;
  /** null when no usable recipient exists (caller should send nothing). */
  toEmail: string | null;
  recipientKind: ServiceRequestRecipientKind;
}

export function resolveServiceRequestRecipient(
  input: ServiceRequestRecipientInput,
): ServiceRequestRecipient {
  const {
    bookingFor,
    referralInfo,
    lovedOneInfo,
    lovedOneUnder14,
    fallbackName,
    fallbackEmail,
  } = input;

  const fallback: ServiceRequestRecipient = {
    toName: fallbackName?.trim() || "Client",
    toEmail: fallbackEmail?.trim() || null,
    recipientKind: "requester",
  };

  // Patient referral: inform the PATIENT directly; fall back to the referrer
  // only when no patient email was supplied.
  if (bookingFor === "patient") {
    const patientEmail = referralInfo?.patientEmail?.trim();
    if (patientEmail) {
      const patientName = `${referralInfo?.patientFirstName ?? ""} ${
        referralInfo?.patientLastName ?? ""
      }`.trim();
      return {
        toName: patientName || "Client",
        toEmail: patientEmail,
        recipientKind: "patient",
      };
    }
    return fallback;
  }

  // Loved-one 14+ adult → the loved one directly.
  if (
    bookingFor === "loved-one" &&
    !lovedOneUnder14 &&
    lovedOneInfo?.email?.trim()
  ) {
    return {
      toName: lovedOneInfo.firstName?.trim() || fallback.toName,
      toEmail: lovedOneInfo.email.trim(),
      recipientKind: "loved-one",
    };
  }

  // self, loved-one <14, or patient-referral-without-email → requester/guest.
  return fallback;
}

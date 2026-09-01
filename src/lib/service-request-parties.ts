/**
 * Who is the *client* of a service request, and who referred them.
 *
 * For a professional referral (`bookingFor === "patient"`) the account attached
 * to the appointment belongs to the **referring doctor**, because the guest
 * booking route creates the prospect from the form's top-level identity — which
 * the referrer fills with their own details. The patient the request is actually
 * *for* lives in `referralInfo.patient*`.
 *
 * That made admin queues show the doctor in the "Client" column with no way to
 * reach the referred patient. This resolves the pair explicitly:
 *   - the **client** is the referred patient when we have their name
 *   - the **referrer** is surfaced separately, so an admin can still contact the
 *     doctor — which matters most when the patient left no email of their own
 *     (patient email is OPTIONAL on the referral form).
 *
 * Mirrors `resolveServiceRequestRecipient`, which already sends the
 * acknowledgement email to the patient rather than the referrer. This makes what
 * an admin *sees* agree with what the system already *does*.
 */

export interface ReferralInfoLike {
  referrerType?: string | null;
  referrerName?: string | null;
  referrerLicense?: string | null;
  referrerPhone?: string | null;
  referrerEmail?: string | null;
  patientFirstName?: string | null;
  patientLastName?: string | null;
  patientPhone?: string | null;
  patientEmail?: string | null;
}

export interface AccountHolderLike {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface Referrer {
  name: string;
  type: string | null;
  license: string | null;
  email: string | null;
  phone: string | null;
}

export interface ServiceRequestParties {
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  /** Present only when the request came from a referring professional. */
  referrer: Referrer | null;
  /** True when the client shown is the referred patient, not the account holder. */
  isReferredPatient: boolean;
  /**
   * True when the patient gave no email of their own, so the referrer is the
   * only way to reach them. The UI should say so rather than showing a bare "—".
   */
  patientEmailMissing: boolean;
}

const clean = (v: string | null | undefined): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

export function resolveServiceRequestParties(input: {
  bookingFor?: string | null;
  referralInfo?: ReferralInfoLike | null;
  account?: AccountHolderLike | null;
}): ServiceRequestParties {
  const { bookingFor, referralInfo, account } = input;

  const accountName =
    [clean(account?.firstName), clean(account?.lastName)]
      .filter(Boolean)
      .join(" ")
      .trim() || null;

  const referrerName = clean(referralInfo?.referrerName);
  const referrer: Referrer | null = referrerName
    ? {
        name: referrerName,
        type: clean(referralInfo?.referrerType),
        license: clean(referralInfo?.referrerLicense),
        // Fall back to the account's contact details: on a referral the account
        // IS the referrer, so these are their details even when the dedicated
        // referrer fields were left blank on the form.
        email: clean(referralInfo?.referrerEmail) ?? clean(account?.email),
        phone: clean(referralInfo?.referrerPhone) ?? clean(account?.phone),
      }
    : null;

  const patientName =
    [clean(referralInfo?.patientFirstName), clean(referralInfo?.patientLastName)]
      .filter(Boolean)
      .join(" ")
      .trim() || null;

  const isReferredPatient = bookingFor === "patient" && Boolean(patientName);

  if (!isReferredPatient) {
    return {
      clientName: accountName ?? "—",
      clientEmail: clean(account?.email),
      clientPhone: clean(account?.phone),
      referrer,
      isReferredPatient: false,
      patientEmailMissing: false,
    };
  }

  const patientEmail = clean(referralInfo?.patientEmail);

  return {
    clientName: patientName!,
    clientEmail: patientEmail,
    clientPhone: clean(referralInfo?.patientPhone),
    referrer,
    isReferredPatient: true,
    // The referral form makes the patient's email optional.
    patientEmailMissing: patientEmail === null,
  };
}

/**
 * Who is the *client* of a service request, and who referred them.
 *
 * Booking routes now register the PATIENT as the account on a referral (see
 * lib/referral-patient-account.ts), so for new requests the account and
 * `referralInfo.patient*` name the same person and this resolver simply agrees
 * with both. It remains the authority for two reasons: **legacy rows** created
 * before that fix still carry the *referring doctor* as the account (the guest
 * route built the prospect from the form's top-level identity, which the
 * referrer fills with their own details), and it is the one place that decides
 * how the referrer is surfaced separately from the client.
 *
 * On those legacy rows the admin queues showed the doctor in the "Client" column
 * with no way to reach the referred patient. This resolves the pair explicitly:
 *   - the **client** is the referred patient when we have their name
 *   - the **referrer** is surfaced separately, so an admin can still contact the
 *     doctor — which matters most on a legacy row where the patient left no
 *     email of their own (it was optional on the form until the fix above).
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
        // Read ONLY from referralInfo. The account used to belong to the
        // referrer, so a blank field could safely fall back to it — that is no
        // longer true: a referral now registers the PATIENT as the account
        // (see lib/referral-patient-account.ts), and falling back would print
        // the patient's own address as their doctor's. Both booking routes
        // backfill these at write time, so new referrals always carry them.
        email: clean(referralInfo?.referrerEmail),
        phone: clean(referralInfo?.referrerPhone),
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

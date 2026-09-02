/**
 * A doctor's referral registers the PATIENT as the client — not the doctor.
 *
 * The booking funnel's top-level identity fields ("guest info" / the logged-in
 * session) are filled with the *referrer's* details, because the referrer is the
 * one at the keyboard. Both booking routes used to hand that identity straight
 * to `clientId`, so a referral produced an appointment whose client was the
 * referring professional. Consequences seen in production:
 *   - the professional's queues showed the doctor in the "Client" column and the
 *     referred patient nowhere at all;
 *   - `payment_invitation` (which resolves its recipient from `clientId`) was
 *     emailed to the DOCTOR for the patient's session;
 *   - the patient had no account row, so nothing downstream — receipts,
 *     messaging, billing — could reach them.
 *
 * The fix mirrors the loved-one flow, which already re-points `clientId` at the
 * person the booking is *for* (`data.clientId = minorUser._id`). Here the same
 * applies: the patient becomes the account, and the referrer is preserved
 * exclusively in `referralInfo.referrer*` — which is precisely what the blue
 * "Référence patient" badge renders.
 *
 * `patientEmail` is therefore REQUIRED for a referral: it is the account's
 * unique key and the only address that can carry the confirmation and the
 * payment request to the patient.
 */
import User, { type IUser } from "@/models/User";
import { findUserByStrongKey } from "@/lib/account-dedup";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string | null | undefined): boolean {
  return EMAIL_PATTERN.test((value ?? "").trim());
}

export interface ReferralInfoInput {
  patientFirstName?: string | null;
  patientLastName?: string | null;
  patientEmail?: string | null;
  patientPhone?: string | null;
}

export interface ReferralPatientIdentity {
  firstName: string;
  lastName: string;
  /** Always lower-cased — this is the account's unique key. */
  email: string;
  phone: string;
}

const clean = (v: string | null | undefined): string =>
  typeof v === "string" ? v.trim() : "";

/**
 * The patient's account identity, or null when the referral does not carry
 * enough to register one (missing name, or a missing/invalid email). Callers
 * treat null as "keep the existing behaviour" so a malformed legacy payload can
 * never throw its way through the booking funnel.
 */
export function resolveReferralPatientIdentity(
  referralInfo: ReferralInfoInput | null | undefined,
): ReferralPatientIdentity | null {
  const firstName = clean(referralInfo?.patientFirstName);
  const lastName = clean(referralInfo?.patientLastName);
  const email = clean(referralInfo?.patientEmail).toLowerCase();

  if (!firstName || !lastName) return null;
  if (!isValidEmail(email)) return null;

  return { firstName, lastName, email, phone: clean(referralInfo?.patientPhone) };
}

export type PreferredPaymentMethod =
  | "interac"
  | "card"
  | "direct_debit"
  | "payment_plan";

/** A shell is a passwordless lead-capture row; a real account can log in. */
function isShell(user: IUser): boolean {
  return !user.password || user.role === "guest" || user.role === "prospect";
}

/**
 * Find (or register) the referred patient's account.
 *
 * Reuses `findUserByStrongKey` so a patient already known by email — or by
 * phone, via the normalized lookup hash — is consolidated instead of duplicated.
 * A REAL account (one that can log in) is reused as-is and never overwritten:
 * a referral must not be able to rewrite a member's own profile. Only
 * lead-capture shells get their contact details refreshed from the referral.
 */
export async function findOrCreateReferralPatient(opts: {
  identity: ReferralPatientIdentity;
  language?: string | null;
  location?: string | null;
  preferredPaymentMethod?: PreferredPaymentMethod;
}): Promise<{ user: IUser; created: boolean }> {
  const { identity } = opts;
  const language = opts.language === "en" ? "en" : "fr";

  const match = await findUserByStrongKey({
    email: identity.email,
    phone: identity.phone || null,
  });

  if (match) {
    const user = match.user;
    if (isShell(user)) {
      user.firstName = identity.firstName;
      user.lastName = identity.lastName;
      if (identity.phone) user.phone = identity.phone;
      const location = clean(opts.location);
      if (location && !user.location) user.location = location;
      if (opts.preferredPaymentMethod) {
        user.preferredPaymentMethod = opts.preferredPaymentMethod;
      } else if (!user.preferredPaymentMethod) {
        user.preferredPaymentMethod = "interac";
      }
      await user.save();
    }
    return { user, created: false };
  }

  const user = new User({
    email: identity.email,
    firstName: identity.firstName,
    lastName: identity.lastName,
    phone: identity.phone || undefined,
    location: clean(opts.location) || undefined,
    role: "prospect",
    status: "active",
    language,
    preferredPaymentMethod: opts.preferredPaymentMethod ?? "interac",
  });
  await user.save();
  return { user, created: true };
}

/**
 * Keep the referrer reachable once their identity is no longer the account.
 *
 * The guest funnel collects the referrer at the top level; if the form left
 * `referrerEmail` / `referrerPhone` blank we would otherwise drop the only way
 * to contact the referring professional. Mutates and returns `referralInfo`.
 */
export function backfillReferrerContact<
  T extends { referrerEmail?: string | null; referrerPhone?: string | null },
>(referralInfo: T, fallback: { email?: string | null; phone?: string | null }): T {
  if (!clean(referralInfo.referrerEmail) && clean(fallback.email)) {
    referralInfo.referrerEmail = clean(fallback.email).toLowerCase();
  }
  if (!clean(referralInfo.referrerPhone) && clean(fallback.phone)) {
    referralInfo.referrerPhone = clean(fallback.phone);
  }
  return referralInfo;
}

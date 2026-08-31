/**
 * Which `Profile` fields a professional may set on **themselves** via
 * `PUT /api/profile`.
 *
 * Why this exists: that route used to build its update as `{ ...body }` and
 * hand it straight to `findOneAndUpdate`, so any key in the request body was
 * written verbatim. That allowed a professional to forge fields the route is
 * supposed to own — `profileCompleted`, the professional-terms acceptance
 * stamp, the secret `calendarFeedToken`, and most seriously `userId`, which
 * would have re-pointed the profile at another account.
 *
 * The allowlist is the inverse of a denylist on purpose: a field added to the
 * schema later is **not** self-writable until someone puts it here
 * deliberately. Fail closed.
 *
 * Fields intentionally NOT here (the route or an admin owns them):
 * - `userId` — identity; changing it reassigns the profile to another user.
 * - `profileCompleted` — derived by the route from terms acceptance.
 * - `professionalTermsAcceptedAt` / `professionalTermsVersion` — set by the
 *   route from the `acceptProfessionalTerms` flag + `LEGAL_VERSIONS`, never
 *   from client input.
 * - `calendarFeedToken` — server-generated secret for the iCal feed.
 * - `createdAt` / `updatedAt` — mongoose timestamps.
 */
export const PROFILE_SELF_WRITABLE = [
  "problematics",
  "approaches",
  "ageCategories",
  "diagnosedConditions",
  "skills",
  "bio",
  "yearsOfExperience",
  "specialty",
  "license",
  "certifications",
  "availability",
  "clinicalAvailability",
  "languages",
  "sessionTypes",
  "modalities",
  "paymentAgreement",
  "paymentFrequency",
  // NOTE: `pricing` is self-writable **today** because a professional sets
  // their own rate under the current pricing model. Spec 001 moves pricing
  // under admin control; removing it from this list is what makes the
  // propose/approve flow enforceable rather than decorative.
  // See specs/001-per-professional-pricing/plan.md step 6.
  "pricing",
  "education",
  "visibleToProfessionals",
  "profileVisible",
  "showRating",
  "acceptingNewClients",
  "acceptingEmergencyConsultations",
  "payoutMethod",
  "payoutInteracEmail",
  "payoutChequeUrl",
  "payoutChequeName",
] as const;

export type ProfileSelfWritableField = (typeof PROFILE_SELF_WRITABLE)[number];

/**
 * Copy only the allowlisted keys out of an untrusted request body.
 *
 * A key is carried over only when it is actually present, so an absent field
 * stays absent rather than becoming an explicit `undefined` — writing
 * `undefined` into a mongoose update would unset a stored value.
 */
export function pickWritable<T extends string>(
  data: unknown,
  allowlist: readonly T[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof data !== "object" || data === null) return out;

  const source = data as Record<string, unknown>;
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key];
    }
  }
  return out;
}

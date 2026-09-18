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
 * - `availabilityConfirmedAt` — stamped by the route when the professional saves their own hours
 *   (`availabilityConfirmationFor`); a forged date would put invented times on a public page.
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
  // Where the professional actually receives clients. Self-writable: it is
  // their own practice detail, and it is what an in-person reminder shows the
  // client instead of the platform's address. Nothing about it is
  // money- or identity-bearing.
  "officeAddress",
  "officeNotes",
  "paymentAgreement",
  "paymentFrequency",
  // NOTE: `pricing` and `rates` are deliberately ABSENT. Pricing is
  // admin-controlled — see PATCH /api/admin/professionals/[id]/pricing. Without
  // this omission a professional could set their own rate with a crafted
  // `PUT /api/profile`, which would make admin-controlled pricing decorative
  // rather than enforced. Do not add them back.
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
 * Which `Profile` fields an admin may set on a professional via `PUT /api/admin/users/[id]`: the
 * professional's file (« Informations de base », the profile form, the hours, the intake switches).
 *
 * The profile form is the professional's own (`ProfileCompletionModal`), and the route used to keep
 * its own shorter list: the office address and its directions were dropped while the admin read
 * « Profil professionnel mis à jour avec succès » (2026-09-18). The form's initial state now
 * `satisfies` this list, so a form field missing here fails the build.
 *
 * Fields intentionally NOT here:
 * - `userId`, `calendarFeedToken`, the terms-acceptance stamp — same reasons as above.
 * - `availabilityConfirmedAt` — only the professional's own save confirms hours (spec 003 phase 3b).
 * - `rates` — the admin pricing editor owns it (PATCH /api/admin/professionals/[id]/pricing).
 */
export const PROFILE_ADMIN_WRITABLE = [
  "specialty",
  "license",
  "bio",
  "approaches",
  "problematics",
  "languages",
  "yearsOfExperience",
  "certifications",
  "ageCategories",
  "diagnosedConditions",
  "skills",
  "availability",
  "sessionTypes",
  "modalities",
  // Where the professional receives clients: in-person reminders show it (with the notes) instead
  // of « Adresse à confirmer avec votre professionnel ».
  "officeAddress",
  "officeNotes",
  "paymentAgreement",
  "paymentFrequency",
  "pricing",
  "education",
  "profileCompleted",
  // Intake toggles — let an admin pause/resume a pro's auto-matching on their
  // behalf (same effect as the pro's own profile switches).
  "acceptingNewClients",
  "acceptingEmergencyConsultations",
] as const;

export type ProfileAdminWritableField = (typeof PROFILE_ADMIN_WRITABLE)[number];

/**
 * When a save confirms a professional's weekly hours: only when they save them themselves, from
 * their own schedule editor, which says so with `confirmAvailability: true`, and the request really
 * carries hours. Null otherwise — a save of anything else, a signup, or any other role leaves the
 * stamp as it was.
 *
 * Showcase pages offer times only on confirmed hours (spec 003 phase 3b), because the signup
 * default (Monday–Friday 9:00–17:00) is what most professionals still have.
 */
export function availabilityConfirmationFor(input: {
  confirm: unknown;
  update: Record<string, unknown>;
  role: string | null | undefined;
  now: Date;
}): Date | null {
  if (input.confirm !== true || input.role !== "professional") return null;
  const availability = input.update.availability as { days?: unknown } | null | undefined;
  if (!availability || typeof availability !== "object" || !Array.isArray(availability.days)) return null;
  return input.now;
}

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

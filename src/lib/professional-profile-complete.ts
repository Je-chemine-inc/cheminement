/**
 * Whether a professional's profile has the fields the completion form REQUIRES,
 * which drives the "complete your profile" banner + the terms-acceptance prompt
 * gated behind it.
 *
 * IMPORTANT: `skills` ("Compétences supplémentaires") is intentionally NOT
 * required — the completion form marks it "(Facultatif)" and never blocks on it.
 * Requiring it here trapped pros who filled every required field but added no
 * extra skill on the banner forever, and (because the terms prompt is gated
 * behind completeness) prevented the server `profileCompleted` flag from ever
 * setting → they were never auto-matched. These mirror the form's required steps
 * exactly: problématiques, approches, catégories d'âge, années d'expérience, bio.
 */
type ProfileCompletenessFields = {
  problematics?: unknown[];
  approaches?: unknown[];
  ageCategories?: unknown[];
  yearsOfExperience?: unknown;
  bio?: unknown;
} | null;

export function isProfessionalProfileComplete(
  profile: ProfileCompletenessFields,
): boolean {
  if (!profile) return false;
  return !!(
    profile.problematics?.length &&
    profile.approaches?.length &&
    profile.ageCategories?.length &&
    profile.yearsOfExperience &&
    profile.bio
  );
}

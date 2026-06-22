/**
 * The client concern(s) the jumelage matches on, in priority order.
 *
 * Product rule (client decision, Jun 2026): match PRIMARILY on the
 * "Motifs de consultation" (consultationMotifs). When a profile has none
 * (older profiles created before motifs were collected), fall back to the
 * Problème principal (primaryIssues / legacy primaryIssue) + Problèmes
 * secondaires so no one loses their matching signal.
 *
 * Returned deduped, in priority order. The first entry is the strongest signal
 * (the matcher's 100-point exact-match anchor); the rest are secondary.
 * Pure + exported so it is unit-tested and shared by the service-request needs
 * builder AND the matcher call site (single source of truth).
 */
export function resolveMatchingConcerns(
  profile:
    | {
        consultationMotifs?: string[];
        primaryIssues?: string[];
        primaryIssue?: string;
        secondaryIssues?: string[];
      }
    | null
    | undefined,
): string[] {
  if (!profile) return [];

  const clean = (arr?: string[]): string[] =>
    (arr ?? []).filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0,
    );

  const dedupe = (arr: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of arr) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  };

  // Primary: motifs de consultation.
  const motifs = clean(profile.consultationMotifs);
  if (motifs.length > 0) return dedupe(motifs);

  // Fallback: problème principal (up to 3) + problèmes secondaires.
  const primaries = profile.primaryIssues?.length
    ? clean(profile.primaryIssues)
    : profile.primaryIssue && profile.primaryIssue.trim()
      ? [profile.primaryIssue.trim()]
      : [];
  return dedupe([...primaries, ...clean(profile.secondaryIssues)]);
}

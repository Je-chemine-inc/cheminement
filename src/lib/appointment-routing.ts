import Profile from "@/models/Profile";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import MedicalProfile from "@/models/MedicalProfile";
import { migrateLegacyAvailabilitySlots } from "@/config/clinical-availability-grid";
import {
  sendProfessionalNotification,
  sendAdminAppointmentMovedToGeneralAlert,
  sendAdminJumelageProblemAlert,
} from "@/lib/notifications";

/**
 * Calculate age from date of birth
 */
export function calculateAge(dateOfBirth: Date | string | undefined): number | null {
  if (!dateOfBirth) return null;
  
  const birthDate = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
  if (isNaN(birthDate.getTime())) return null;
  
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * Determine if patient is a child (< 18 years) or adult (>= 18 years)
 */
export function isChild(age: number | null): boolean {
  if (age === null) return false; // Default to adult if age unknown
  return age < 18;
}

/**
 * Check if professional treats the patient's age category
 */
export function professionalTreatsAgeCategory(
  professionalAgeCategories: string[] | undefined,
  isPatientChild: boolean,
): boolean {
  if (!professionalAgeCategories || professionalAgeCategories.length === 0) {
    // If no age categories specified, assume they treat all ages
    return true;
  }

  if (isPatientChild) {
    // Child (< 18): must have one of these categories
    return professionalAgeCategories.some((cat) => {
      const catLower = cat.toLowerCase();
      return (
        catLower.includes("child") ||
        catLower.includes("adolescent") ||
        catLower.includes("0-12") ||
        catLower.includes("13-17")
      );
    });
  } else {
    // Adult (>= 18): must have one of these categories (but NOT child/adolescent)
    return professionalAgeCategories.some((cat) => {
      const catLower = cat.toLowerCase();
      // Exclude child/adolescent categories
      const isChildCategory =
        catLower.includes("child") || catLower.includes("adolescent");
      if (isChildCategory) return false;
      // Include adult/senior categories
      return (
        catLower.includes("adult") ||
        catLower.includes("senior") ||
        catLower.includes("18-") ||
        catLower.includes("26-") ||
        catLower.includes("65+")
      );
    });
  }
}

interface ProfessionalMatch {
  professionalId: string;
  score: number;
  reasons: string[];
}

/**
 * Normalize a string for comparison (remove accents, lowercase, trim)
 */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .trim()
    .replace(/\s+/g, " "); // Normalize whitespace
}

/**
 * Does the professional's gender satisfy the client's stated preference?
 * Soft signal only — used to rank, never to exclude. "noPreference"/empty → false
 * (no bonus). Matches on exact normalized tokens (so "female" never satisfies a
 * "male" preference) and handles FR + EN spellings.
 */
export function professionalMatchesGenderPreference(
  professionalGender: string | undefined,
  preferredGender: string | undefined,
): boolean {
  if (!preferredGender || preferredGender === "noPreference") return false;
  if (!professionalGender) return false;
  const tokens = normalizeString(professionalGender).split(/\s+/);
  const SYNONYMS: Record<string, string[]> = {
    male: ["male", "homme", "masculin", "man"],
    female: ["female", "femme", "feminin", "woman"],
    other: ["other", "autre", "nonbinaire", "nonbinary", "x"],
  };
  const syns = SYNONYMS[preferredGender];
  if (!syns) return false;
  return syns.some((s) => tokens.includes(s));
}

/**
 * HARD gender filter: when the client stated a gender preference, keep ONLY
 * professionals whose gender matches it. No preference (or "noPreference") lets
 * everyone through. Pure + exported so the requirement can be unit-tested.
 */
export function filterProfessionalsByGenderPreference<
  T extends { userId: { toString(): string } },
>(
  profiles: T[],
  genderById: Map<string, string | undefined>,
  preferredGender: string | undefined | null,
): T[] {
  if (!preferredGender || preferredGender === "noPreference") return profiles;
  return profiles.filter((p) =>
    professionalMatchesGenderPreference(
      genderById.get(String(p.userId)),
      preferredGender,
    ),
  );
}

/**
 * Calculate string similarity using multiple methods
 * Returns a score between 0 and 1
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  const normalized1 = normalizeString(str1);
  const normalized2 = normalizeString(str2);

  // Exact match
  if (normalized1 === normalized2) {
    return 1.0;
  }

  // One contains the other (high similarity)
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    const minLen = Math.min(normalized1.length, normalized2.length);
    const maxLen = Math.max(normalized1.length, normalized2.length);
    return minLen / maxLen; // Proportional similarity
  }

  // Word-based matching
  const words1 = normalized1.split(/\s+/);
  const words2 = normalized2.split(/\s+/);
  const commonWords = words1.filter((w) => words2.includes(w));
  if (commonWords.length > 0) {
    const wordSimilarity =
      commonWords.length / Math.max(words1.length, words2.length);
    return wordSimilarity * 0.7; // Slightly lower than exact match
  }

  // Character-based similarity (simple Levenshtein-like)
  const longer = normalized1.length > normalized2.length ? normalized1 : normalized2;
  const shorter = normalized1.length > normalized2.length ? normalized2 : normalized1;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) {
      matches++;
    }
  }
  if (matches > 0) {
    return (matches / longer.length) * 0.5; // Lower weight for character matching
  }

  return 0;
}

/**
 * Check for exact match (same string) between client preference and professional list
 * Returns true if exact match found, false otherwise
 */
function hasExactMatch(
  clientPreference: string,
  professionalList: string[],
): boolean {
  if (!clientPreference || !professionalList || professionalList.length === 0) {
    return false;
  }

  const normalizedClient = normalizeString(clientPreference);
  
  return professionalList.some((professionalItem) => {
    const normalizedProfessional = normalizeString(professionalItem);
    return normalizedClient === normalizedProfessional;
  });
}

/**
 * Find the best match between a client preference and a list of professional specialties
 * Returns the best similarity score and the matched item
 * Priority: exact match first, then similarity
 */
export function findBestMatch(
  clientPreference: string,
  professionalList: string[],
  threshold: number = 0.3,
): { score: number; matchedItem?: string; isExactMatch?: boolean } {
  if (!clientPreference || !professionalList || professionalList.length === 0) {
    return { score: 0 };
  }

  // First, check for exact match (normalized)
  const normalizedClient = normalizeString(clientPreference);
  for (const professionalItem of professionalList) {
    const normalizedProfessional = normalizeString(professionalItem);
    if (normalizedClient === normalizedProfessional) {
      return { score: 1.0, matchedItem: professionalItem, isExactMatch: true };
    }
  }

  // If no exact match, use similarity as fallback
  let bestScore = 0;
  let bestMatch: string | undefined;

  for (const professionalItem of professionalList) {
    const similarity = calculateStringSimilarity(
      clientPreference,
      professionalItem,
    );
    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = professionalItem;
    }
  }

  // Only return if above threshold
  if (bestScore >= threshold) {
    return { score: bestScore, matchedItem: bestMatch, isExactMatch: false };
  }

  return { score: 0 };
}

/** Time-of-day windows (24h) behind the booking grid tokens (week_/weekend_ +
 *  morning|afternoon|evening). Mirrors src/config/clinical-availability-grid. */
const TIME_OF_DAY_RANGES: Record<string, [number, number]> = {
  morning: [9, 12],
  afternoon: [12, 17],
  evening: [17, 21],
};

const WEEKDAY_NAMES = new Set([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
]);

type AvailabilityDay = {
  day: string;
  isWorkDay: boolean;
  startTime?: string;
  endTime?: string;
};

/** "HH:MM" → decimal hours ("13:30" → 13.5); null if unparseable. */
function parseHourMinutes(value?: string): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h + min / 60;
}

/**
 * Does the professional actually work a given preferred slot (e.g.
 * "week_morning")? True when at least one work day in the right day-bucket
 * (weekday vs weekend) has working hours that overlap the slot's time window.
 */
export function professionalCoversAvailabilitySlot(
  slotId: string,
  days: AvailabilityDay[] | undefined,
): boolean {
  if (!days || days.length === 0) return false;
  const m = /^(week|weekend)_(morning|afternoon|evening)$/.exec(
    slotId.toLowerCase(),
  );
  if (!m) return false;
  const wantWeekday = m[1] === "week";
  const [periodStart, periodEnd] = TIME_OF_DAY_RANGES[m[2]];

  return days.some((d) => {
    if (!d.isWorkDay) return false;
    const isWeekday = WEEKDAY_NAMES.has(d.day);
    if (wantWeekday !== isWeekday) return false;
    const start = parseHourMinutes(d.startTime);
    const end = parseHourMinutes(d.endTime);
    if (start === null || end === null) return false;
    // Overlap between the pro's working window and the slot's time window.
    return start < periodEnd && end > periodStart;
  });
}

/**
 * How many of the client's preferred availability slots the professional can
 * actually serve. Legacy tokens are normalized; specific-date tokens
 * ("YYYY-MM-DD-morning") map to their weekday/weekend bucket. Returns counts so
 * the caller scores proportionally. Unrecognized tokens are ignored.
 */
export function scoreAvailabilityMatch(
  preferred: string[] | undefined,
  days: AvailabilityDay[] | undefined,
): { matched: number; total: number } {
  if (!preferred || preferred.length === 0) return { matched: 0, total: 0 };
  const CANONICAL = /^(week|weekend)_(morning|afternoon|evening)$/;
  let matched = 0;
  let total = 0;
  const handleCanonical = (slot: string) => {
    total++;
    if (professionalCoversAvailabilitySlot(slot, days)) matched++;
  };
  for (const raw of preferred) {
    const slot = raw.toLowerCase();
    if (CANONICAL.test(slot)) {
      handleCanonical(slot);
      continue;
    }
    const dm = /^(\d{4}-\d{2}-\d{2})-(morning|afternoon|evening)$/.exec(slot);
    if (dm) {
      total++;
      const dt = new Date(`${dm[1]}T12:00:00`);
      if (!Number.isNaN(dt.getTime())) {
        const dow = dt.getDay(); // 0 Sun … 6 Sat
        const bucket = dow === 0 || dow === 6 ? "weekend" : "week";
        if (professionalCoversAvailabilitySlot(`${bucket}_${dm[2]}`, days)) {
          matched++;
        }
      }
      continue;
    }
    // Legacy text token (e.g. "Weekday Mornings") → normalize to canonical.
    for (const mtok of migrateLegacyAvailabilitySlots([raw])) {
      if (CANONICAL.test(mtok.toLowerCase())) handleCanonical(mtok.toLowerCase());
    }
  }
  return { matched, total };
}

/** A scored professional candidate, used by the 3-level cascade selector. */
export interface ScoredCandidate {
  professionalId: string;
  score: number;
  reasons: string[];
  /** How many of the client's preferred availability slots this pro covers. */
  availMatched: number;
  /** Total preferred slots the client gave (0 = no preference stated). */
  availTotal: number;
}

/**
 * 3-level cascade selector — picks ONE professional for the current attempt.
 *
 * - attemptsMade 0 → Tentative 1 (STRICT): a strong match (score ≥ strictScore,
 *   i.e. an exact problématique match) AND availability overlap with the client's
 *   preferred slots — or no preference stated. If no strict candidate exists,
 *   relax immediately to the best reasonable match rather than skip the attempt.
 * - attemptsMade 1 → Tentative 2 (RELAXED): any reasonable match (score ≥
 *   relaxedScore); availability is no longer required (only used to break ties).
 * - attemptsMade ≥ maxTargetedAttempts → null: caller routes to the general pool.
 *
 * Returns the single best candidate, or null when the caller should fall back to
 * the general pool. Pure function (no I/O) so it is unit-tested directly.
 */
export function selectCascadeCandidate(
  scored: ScoredCandidate[],
  attemptsMade: number,
  opts: {
    strictScore: number;
    relaxedScore: number;
    maxTargetedAttempts: number;
  },
): ScoredCandidate | null {
  if (attemptsMade >= opts.maxTargetedAttempts) return null;

  // Best first: highest relevancy, then most preferred-slot overlap.
  const byBestFirst = (a: ScoredCandidate, b: ScoredCandidate) =>
    b.score - a.score || b.availMatched - a.availMatched;

  // Availability is satisfied when the client stated no preference
  // (availTotal === 0) or at least one preferred slot is covered.
  const availabilityOk = (c: ScoredCandidate) =>
    c.availTotal === 0 || c.availMatched > 0;

  const relaxed = scored
    .filter((c) => c.score >= opts.relaxedScore)
    .sort(byBestFirst);

  if (attemptsMade === 0) {
    const strict = scored
      .filter((c) => c.score >= opts.strictScore && availabilityOk(c))
      .sort(byBestFirst);
    return strict[0] ?? relaxed[0] ?? null;
  }

  return relaxed[0] ?? null;
}

/**
 * Calculate a relevancy score for a professional based on appointment requirements
 * and client medical profile preferences
 */
export function calculateRelevancyScore(
  profile: {
    problematics?: string[];
    specialty?: string;
    approaches?: string[];
    ageCategories?: string[];
    modalities?: string[];
    sessionTypes?: string[];
    languages?: string[];
    availability?: {
      days: {
        day: string;
        isWorkDay: boolean;
        startTime?: string;
        endTime?: string;
      }[];
    };
  },
  appointment: {
    issueType?: string;
    /** Multi-reason motifs array from the booking form (1–3 items). */
    needs?: string[];
    type: string;
    therapyType: string;
    preferredAvailability?: string[];
  },
  medicalProfile?: {
    primaryIssue?: string;
    secondaryIssues?: string[];
    therapyApproach?: string[];
    languagePreference?: string;
    preferredGender?: string;
  } | null,
  professionalGender?: string,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // ===== MATCHING BASED ON CLIENT PREFERENCES vs PROFESSIONAL SPECIALTIES =====

  // 1. Match primary issue with problematics/specialty (highest weight)
  // PRIORITY: Exact match required for problematics
  if (medicalProfile?.primaryIssue) {
    const primaryIssue = medicalProfile.primaryIssue;

    // Check against problematics - EXACT MATCH REQUIRED
    if (profile.problematics && profile.problematics.length > 0) {
      const match = findBestMatch(primaryIssue, profile.problematics, 0.3);
      if (match.isExactMatch) {
        // Exact match gets maximum points
        score += 100;
        reasons.push(
          "Correspondance exacte avec votre problématique principale",
        );
      } else if (match.score > 0) {
        // Similarity match gets lower points (fallback)
        const points = Math.round(match.score * 20); // Reduced from 50
        score += points;
        reasons.push(
          `Correspondance partielle avec votre problématique principale (${Math.round(match.score * 100)}%)`,
        );
      }
    }

    // Check against specialty (similarity allowed)
    if (profile.specialty) {
      const match = findBestMatch(primaryIssue, [profile.specialty], 0.3);
      if (match.score > 0) {
        const points = Math.round(match.score * 15); // Reduced from 30
        score += points;
        reasons.push(
          `Spécialité correspondante (${Math.round(match.score * 100)}%)`,
        );
      }
    }
  }

  // 2. Match issueType from appointment (fallback if no medical profile)
  // PRIORITY: Exact match required for problematics
  if (!medicalProfile?.primaryIssue && appointment.issueType) {
    if (profile.problematics && profile.problematics.length > 0) {
      const match = findBestMatch(appointment.issueType, profile.problematics, 0.3);
      if (match.isExactMatch) {
        // Exact match gets maximum points
        score += 100;
        reasons.push(
          "Correspondance exacte avec le motif de consultation",
        );
      } else if (match.score > 0) {
        // Similarity match gets lower points (fallback)
        const points = Math.round(match.score * 20); // Reduced from 40
        score += points;
        reasons.push(
          `Correspondance partielle avec le motif de consultation (${Math.round(match.score * 100)}%)`,
        );
      }
    }
    if (profile.specialty) {
      const match = findBestMatch(appointment.issueType, [profile.specialty], 0.3);
      if (match.score > 0) {
        const points = Math.round(match.score * 15); // Reduced from 25
        score += points;
        reasons.push(
          `Spécialité pertinente (${Math.round(match.score * 100)}%)`,
        );
      }
    }
  }

  // 2b. Match additional motifs from the `needs` array (multi-reason booking form)
  // Each motif beyond the first that matches earns bonus points to reward specificity.
  if (appointment.needs && appointment.needs.length > 0) {
    const needsToScore = medicalProfile?.primaryIssue
      ? appointment.needs // primary already scored above; all needs still get bonus weight here
      : appointment.needs.slice(1); // first need already handled by issueType block above

    let exactNeedsMatches = 0;
    let partialNeedsScore = 0;

    for (const need of needsToScore) {
      if (profile.problematics && profile.problematics.length > 0) {
        const match = findBestMatch(need, profile.problematics, 0.3);
        if (match.isExactMatch) {
          exactNeedsMatches++;
        } else if (match.score > 0) {
          partialNeedsScore += match.score;
        }
      }
      if (profile.specialty) {
        const match = findBestMatch(need, [profile.specialty], 0.3);
        if (match.score > 0) {
          partialNeedsScore += match.score * 0.5;
        }
      }
    }

    if (exactNeedsMatches > 0) {
      score += exactNeedsMatches * 25;
      reasons.push(
        `${exactNeedsMatches} motif(s) de consultation correspondant(s) exactement`,
      );
    }
    if (partialNeedsScore > 0) {
      const pts = Math.round(Math.min(partialNeedsScore * 10, 20));
      score += pts;
      reasons.push("Correspondances partielles sur les motifs de consultation");
    }
  }

  // 3. Match secondary issues with problematics
  // PRIORITY: Exact match required
  if (medicalProfile?.secondaryIssues && medicalProfile.secondaryIssues.length > 0) {
    let exactSecondaryMatches = 0;
    let partialSecondaryMatches = 0;

    for (const secondaryIssue of medicalProfile.secondaryIssues) {
      if (profile.problematics && profile.problematics.length > 0) {
        const match = findBestMatch(secondaryIssue, profile.problematics, 0.25);
        if (match.isExactMatch) {
          exactSecondaryMatches++;
        } else if (match.score > 0) {
          partialSecondaryMatches++;
        }
      }
    }

    // Exact matches get more points
    if (exactSecondaryMatches > 0) {
      score += exactSecondaryMatches * 30; // 30 points per exact match
      reasons.push(
        `${exactSecondaryMatches} problématique(s) secondaire(s) correspondante(s) exactement`,
      );
    }
    
    // Partial matches get fewer points
    if (partialSecondaryMatches > 0) {
      score += Math.min(partialSecondaryMatches * 10, 20); // Max 20 points for partial matches
      reasons.push(
        `${partialSecondaryMatches} problématique(s) secondaire(s) partiellement correspondante(s)`,
      );
    }
  }

  // 4. Match therapy approach preferences
  if (medicalProfile?.therapyApproach && medicalProfile.therapyApproach.length > 0) {
    if (profile.approaches && profile.approaches.length > 0) {
      let approachMatches = 0;
      let totalApproachScore = 0;

      for (const clientApproach of medicalProfile.therapyApproach) {
        const match = findBestMatch(clientApproach, profile.approaches, 0.3);
        if (match.score > 0) {
          approachMatches++;
          totalApproachScore += match.score;
        }
      }

      if (approachMatches > 0) {
        const avgScore = totalApproachScore / approachMatches;
        const points = Math.round(avgScore * 25); // Up to 25 points
        score += points;
        reasons.push(
          `${approachMatches} approche(s) thérapeutique(s) correspondante(s)`,
        );
      }
    }
  }

  // 5. Match language preference
  if (medicalProfile?.languagePreference && profile.languages) {
    const languageMatch = findBestMatch(
      medicalProfile.languagePreference,
      profile.languages,
      0.5,
    );
    if (languageMatch.score > 0) {
      score += 10;
      reasons.push("Langue préférée disponible");
    }
  }

  // ===== MATCHING BASED ON APPOINTMENT REQUIREMENTS =====

  // 6. Match by modality (video, in-person, phone, both)
  if (profile.modalities) {
    if (appointment.type === "both") {
      const offersVideoOrInPerson =
        profile.modalities.includes("online") ||
        profile.modalities.includes("inPerson") ||
        profile.modalities.includes("both");
      if (offersVideoOrInPerson) {
        score += 15;
        reasons.push("Offre la modalité de session requise (vidéo ou en personne)");
      }
    } else {
      const modalityMap: Record<string, string> = {
        video: "online",
        "in-person": "inPerson",
        phone: "phone",
      };
      const requiredModality = modalityMap[appointment.type];
      if (
        requiredModality &&
        (profile.modalities.includes(requiredModality) ||
          profile.modalities.includes("both"))
      ) {
        score += 15;
        reasons.push("Offre la modalité de session requise");
      }
    }
  }

  // 7. Match by session type (solo, couple, group)
  if (profile.sessionTypes) {
    const sessionTypeMap: Record<string, string> = {
      solo: "individual",
      couple: "couple",
      group: "group",
    };
    const requiredType = sessionTypeMap[appointment.therapyType];
    if (
      profile.sessionTypes.some((t) => t.toLowerCase().includes(requiredType))
    ) {
      score += 12;
      reasons.push("Offre le type de session requis");
    }
  }

  // 8. Match by availability — cross the client's preferred day+time slots
  // (week_/weekend_ × morning/afternoon/evening) with the professional's ACTUAL
  // working windows (right day bucket AND overlapping hours). Proportional: a
  // pro who fits every preferred slot scores highest; one who fits none scores
  // 0 here. Soft signal (ranking), not a hard filter, so the pool never empties.
  if (appointment.preferredAvailability && profile.availability?.days) {
    const { matched, total } = scoreAvailabilityMatch(
      appointment.preferredAvailability,
      profile.availability.days,
    );
    if (total > 0) {
      const points = Math.round((matched / total) * 15);
      if (points > 0) {
        score += points;
        reasons.push(
          `Disponibilités correspondantes (${matched}/${total} créneaux préférés)`,
        );
      }
    }
  }

  // 9. Match gender preference (soft signal — bonus when the professional's
  // gender matches the client's stated preference; never a hard filter, so the
  // pool can't empty when few pros of a given gender are available).
  if (
    medicalProfile?.preferredGender &&
    professionalMatchesGenderPreference(
      professionalGender,
      medicalProfile.preferredGender,
    )
  ) {
    score += 12;
    reasons.push("Genre du professionnel correspondant à votre préférence");
  }

  // ===== BONUS POINTS =====

  // Profile completeness bonus
  if (profile.problematics && profile.problematics.length > 0) {
    score += 3;
  }
  if (profile.modalities && profile.modalities.length > 0) {
    score += 2;
  }
  if (profile.approaches && profile.approaches.length > 0) {
    score += 2;
  }

  return { score, reasons };
}

/**
 * Whether a professional's profile is eligible to be AUTO-PROPOSED a request.
 *
 * History: this used to hard-require `profileCompleted === true`. But that flag
 * only flips true when the pro accepts the professional TERMS (see
 * /api/profile) — NOT when they fill their profile. So an active, admin-approved
 * pro with a rich profile (problématiques, spécialité…) who hadn't run the terms
 * step stayed `profileCompleted: false` and was invisible to auto-matching,
 * starving the pool (the reported "jumelage automatique ne fonctionne pas").
 *
 * A pro is now eligible when they are accepting new clients AND either the
 * profile is formally completed OR it carries real matching data
 * (problématiques or spécialité). Truly-empty profiles are still excluded, and
 * low-data pros simply score low. Pure + exported so it is unit-tested directly.
 */
export function isProfileMatchEligible(
  profile: {
    profileCompleted?: boolean;
    acceptingNewClients?: boolean;
    acceptingEmergencyConsultations?: boolean;
    problematics?: string[];
    specialty?: string;
  },
  opts: { isEmergency?: boolean } = {},
): boolean {
  // Accepting new clients? Explicit `false` opts out; undefined = accepting.
  if (profile.acceptingNewClients === false) return false;
  // Emergency ("Consultation ponctuelle rapide") requests only auto-push to
  // pros who also accept urgent consultations (they can still self-claim from
  // the general pool). Undefined = accepting.
  if (opts.isEmergency && profile.acceptingEmergencyConsultations === false) {
    return false;
  }
  const hasProblematics =
    Array.isArray(profile.problematics) && profile.problematics.length > 0;
  const hasSpecialty =
    typeof profile.specialty === "string" && profile.specialty.trim().length > 0;
  return profile.profileCompleted === true || hasProblematics || hasSpecialty;
}

/**
 * Route an appointment to relevant professionals based on matching criteria
 * Returns the list of matched professionals and updates the appointment
 */
export async function routeAppointmentToProfessionals(
  appointmentId: string,
): Promise<{
  success: boolean;
  matches: ProfessionalMatch[];
  routingStatus: string;
}> {
  try {
    // Get the appointment
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return { success: false, matches: [], routingStatus: "pending" };
    }

    // Only route pending appointments that haven't been routed yet
    if (appointment.routingStatus !== "pending" || appointment.professionalId) {
      return {
        success: false,
        matches: [],
        routingStatus: appointment.routingStatus,
      };
    }

    // Pros who already refused OR let a proposal lapse (no-response timeout:
    // 24h regular / 12h urgent) must never be re-proposed nor re-emailed (§3.1:
    // "en excluant les professionnels
    // qui a refusé/ignoré"). Both the refuse route and the proposal-timeout cron
    // add the pro to refusedBy before re-running this matcher; refusedBy is empty
    // on first routing, so this is a no-op then.
    const refusedIds = new Set(
      (appointment.refusedBy ?? []).map((r) => String(r)),
    );

    // Get all active professionals with profiles (minus anyone who refused).
    const professionals = (
      await User.find({
        role: "professional",
        status: "active",
      }).select("_id firstName lastName email language gender")
    ).filter((p) => !refusedIds.has(String(p._id)));

    const professionalIds = professionals.map((p) => p._id);
    // Professional gender, keyed by id — fed into the relevancy score so a
    // client's gender preference ranks matching pros higher.
    const genderById = new Map<string, string | undefined>(
      professionals.map((p) => [
        String(p._id),
        (p as { gender?: string }).gender,
      ]),
    );

    // When the auto-match cascade is exhausted (2 failed attempts: Pro 1 →
    // expire/refuse → Pro 2 → expire/refuse) or no eligible pro can be targeted,
    // the dossier FALLS TO THE GENERAL POOL (routingStatus "general", client
    // feedback §4 "tombe liste générale") so ANY active professional can
    // self-claim it — rather than sitting in the red "awaiting_admin" queue.
    // Admins are still alerted so the fallback never goes unseen. Awaited (not
    // fire-and-forget) so the send completes before this function — itself
    // wrapped in after() by the caller — resolves; otherwise Vercel may kill the
    // container mid-send.
    const notifyAdminMovedToGeneral = async () => {
      const populated = await Appointment.findById(appointmentId)
        .populate("clientId", "firstName lastName email")
        .lean();
      if (!populated) return;
      const c = populated.clientId as
        | { firstName?: string; lastName?: string; email?: string }
        | null;
      const clientName =
        `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim() || "Client";
      await sendAdminAppointmentMovedToGeneralAlert({
        clientName,
        clientEmail: c?.email?.trim() || "—",
        motif: populated.issueType,
        appointmentId: String(populated._id),
        refusalCount: populated.cascadeAttempts ?? 0,
      }).catch((err) =>
        console.error("[routing] moved-to-general alert failed:", err),
      );
    };

    // Get profiles for all active professionals, then keep the eligible ones.
    // Eligibility is decided in JS by isProfileMatchEligible (pure + tested):
    // accepting new clients (+ urgent for emergencies) AND a completed-or-data
    // -bearing profile. Done in JS rather than a Mongo filter so the rule stays
    // unit-testable and so a rich-but-not-"completed" profile is no longer
    // wrongly excluded (the auto-match pool was being starved otherwise).
    const profiles = (
      await Profile.find({ userId: { $in: professionalIds } })
    ).filter((profile) =>
      isProfileMatchEligible(profile, {
        isEmergency: appointment.isEmergency,
      }),
    );

    // Get client's medical profile for better matching
    let medicalProfile = null;
    try {
      medicalProfile = await MedicalProfile.findOne({
        userId: appointment.clientId,
      });
    } catch (error) {
      console.error("Error fetching medical profile:", error);
      // Continue without medical profile
    }

    // Determine patient age and if they are a child or adult
    let patientAge: number | null = null;
    let isPatientChild = false;

    // Get client user to access dateOfBirth
    const clientUser = await User.findById(appointment.clientId);
    
    if (appointment.bookingFor === "loved-one" && appointment.lovedOneInfo?.dateOfBirth) {
      // For loved-one bookings, use lovedOneInfo dateOfBirth
      patientAge = calculateAge(appointment.lovedOneInfo.dateOfBirth);
      isPatientChild = isChild(patientAge);
    } else if (appointment.bookingFor === "self" && clientUser?.dateOfBirth) {
      // For self bookings, use client's dateOfBirth
      patientAge = calculateAge(clientUser.dateOfBirth);
      isPatientChild = isChild(patientAge);
    } else if (appointment.bookingFor === "patient") {
      // For patient bookings (medical referral), we don't have dateOfBirth
      // Default to adult, but this could be enhanced with additional data
      isPatientChild = false;
    } else if (clientUser?.dateOfBirth) {
      // Fallback: use client's dateOfBirth if available
      patientAge = calculateAge(clientUser.dateOfBirth);
      isPatientChild = isChild(patientAge);
    }

    // Commit a terminal routing decision (proposed/general) ONLY if no one else
    // advanced this request while we were scoring — a concurrent admin
    // assignment or acceptance moves it out of "pending" / sets professionalId.
    // Without this guard the matcher (now re-run on a pro's refusal) could
    // silently overwrite that assignment and email the wrong pros. Returns true
    // when we won the write.
    const commitRouting = async (
      update: Record<string, unknown>,
    ): Promise<boolean> => {
      const res = await Appointment.findOneAndUpdate(
        {
          _id: appointmentId,
          routingStatus: "pending",
          professionalId: { $exists: false },
        },
        update,
      );
      return Boolean(res);
    };

    // Filter professionals by age category BEFORE calculating relevancy scores
    const ageFilteredProfiles = profiles.filter((profile) =>
      professionalTreatsAgeCategory(profile.ageCategories, isPatientChild),
    );

    if (ageFilteredProfiles.length === 0) {
      console.log(
        `No professionals found for ${isPatientChild ? "child" : "adult"} patients`,
      );
      if (!(await commitRouting({
        $set: { routingStatus: "general" },
        $unset: { proposedTo: "", proposedAt: "" },
      }))) {
        return { success: false, matches: [], routingStatus: "skipped" };
      }
      await notifyAdminMovedToGeneral();

      return { success: true, matches: [], routingStatus: "general" };
    }

    // HARD filter by gender preference (when the client stated one). A stated
    // gender preference is a requirement, not just a ranking signal — mirrors
    // the age filter above. If it empties the candidate pool, fall back to the
    // general queue so the client is never left unmatched.
    const preferredGender = medicalProfile?.preferredGender;
    const genderFilteredProfiles = filterProfessionalsByGenderPreference(
      ageFilteredProfiles,
      genderById,
      preferredGender,
    );

    if (genderFilteredProfiles.length === 0) {
      console.log(
        `No professional matching the "${preferredGender}" gender preference — returning to admin queue`,
      );
      if (!(await commitRouting({
        $set: { routingStatus: "general" },
        $unset: { proposedTo: "", proposedAt: "" },
      }))) {
        return { success: false, matches: [], routingStatus: "skipped" };
      }
      await notifyAdminMovedToGeneral();

      return { success: true, matches: [], routingStatus: "general" };
    }

    // ===== 3-LEVEL CASCADE — ONE professional per attempt =====
    // Tentative 1 (refusedBy empty): STRICT — strong match (score >= 100, i.e. an
    //   exact problématique match) AND availability overlap with the client's
    //   preferred slots (or the client stated no preference). If no strict
    //   candidate exists, relax immediately rather than burn the attempt with no pro.
    // Tentative 2 (1 refusal so far): RELAXED — any reasonable match (score >= 20);
    //   availability is no longer required (still used to rank).
    // Tentative 3 (>= 2 attempts): no targeted pick below → the dossier FALLS TO
    //   THE GENERAL POOL (routingStatus "general") so any active pro can
    //   self-claim it (client feedback §4 "2 profs 24h après tombe liste
    //   générale"); admins are alerted.
    // The attempt counter is `cascadeAttempts` (incremented ONLY by a genuine
    // refusal in the refuse re-route OR a proposal timeout — 24h regular /
    // 12h urgent), NOT refusedBy.length —
    // refusedBy is also written by release/reassign and must not advance the
    // cascade. The 100/20 thresholds map the client's "100% / 50%" tiers.
    const STRICT_SCORE = 100;
    const RELAXED_SCORE = 20;
    const MAX_TARGETED_ATTEMPTS = 2;
    const attemptsMade = appointment.cascadeAttempts ?? 0;

    const scored = genderFilteredProfiles.map((profile) => {
      const { score, reasons } = calculateRelevancyScore(
        profile,
        {
          issueType: appointment.issueType,
          needs: appointment.needs,
          type: appointment.type,
          therapyType: appointment.therapyType,
          preferredAvailability: appointment.preferredAvailability,
        },
        medicalProfile
          ? {
              primaryIssue: medicalProfile.primaryIssue,
              secondaryIssues: medicalProfile.secondaryIssues,
              therapyApproach: medicalProfile.therapyApproach,
              languagePreference: medicalProfile.languagePreference,
              preferredGender: medicalProfile.preferredGender,
            }
          : null,
        genderById.get(String(profile.userId)),
      );
      const avail = scoreAvailabilityMatch(
        appointment.preferredAvailability,
        profile.availability?.days,
      );
      return {
        professionalId: profile.userId.toString(),
        score,
        reasons,
        availMatched: avail.matched,
        availTotal: avail.total,
      };
    });

    const chosen = selectCascadeCandidate(scored, attemptsMade, {
      strictScore: STRICT_SCORE,
      relaxedScore: RELAXED_SCORE,
      maxTargetedAttempts: MAX_TARGETED_ATTEMPTS,
    });
    const selected: ProfessionalMatch | null = chosen
      ? {
          professionalId: chosen.professionalId,
          score: chosen.score,
          reasons: chosen.reasons,
        }
      : null;

    // One pro per attempt. An empty list means "no targeted candidate for this
    // attempt (or the 2-attempt cascade is exhausted) → FALL TO THE GENERAL POOL
    // (routingStatus "general") so any active pro can self-claim it", with an
    // admin alert.
    const topMatches: ProfessionalMatch[] = selected ? [selected] : [];

    if (topMatches.length === 0) {
      if (!(await commitRouting({
        $set: { routingStatus: "general" },
        $unset: { proposedTo: "", proposedAt: "" },
      }))) {
        return { success: false, matches: [], routingStatus: "skipped" };
      }
      await notifyAdminMovedToGeneral();

      return { success: true, matches: [], routingStatus: "general" };
    }

    // Propose to the single selected professional for this attempt — only if
    // nothing else claimed it meanwhile (see commitRouting). If it lost the race,
    // bail before notifying so we don't email a pro for an already-assigned request.
    const proposedIds = topMatches.map((m) => m.professionalId);
    if (
      !(await commitRouting({
        routingStatus: "proposed",
        proposedTo: proposedIds,
        // Stamp the proposal time so the no-response timeout can fire (24h
        // regular / 12h urgent — see proposal-timeout.ts).
        proposedAt: new Date(),
      }))
    ) {
      return { success: false, matches: [], routingStatus: "skipped" };
    }

    const populatedAppt = await Appointment.findById(appointmentId)
      .populate("clientId", "firstName lastName email phone")
      .lean();

    const client = populatedAppt?.clientId as
      | {
          firstName?: string;
          lastName?: string;
          email?: string;
        }
      | null
      | undefined;

    const clientEmail = client?.email?.trim();
    if (clientEmail) {
      const clientName =
        `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() ||
        "Client";
      const dateIso = populatedAppt?.date
        ? new Date(populatedAppt.date).toISOString()
        : undefined;
      const apptType = (populatedAppt?.type ?? "video") as
        | "video"
        | "in-person"
        | "phone"
        | "both";

      // Await the sends (collected, run together) so they complete before this
      // function resolves. The caller wraps the whole call in after(), which
      // keeps the Vercel container alive until this promise settles — a prior
      // fire-and-forget (`void`) here could be killed before SMTP finished.
      const notificationPromises: Promise<unknown>[] = [];
      for (const match of topMatches) {
        const pro = await User.findById(match.professionalId)
          .select("firstName lastName email")
          .lean();
        if (!pro?.email) continue;

        notificationPromises.push(
          sendProfessionalNotification({
            clientName,
            clientEmail,
            professionalName: `${pro.firstName} ${pro.lastName}`,
            professionalEmail: pro.email,
            date: dateIso,
            time: populatedAppt?.time,
            duration: populatedAppt?.duration ?? 60,
            type: apptType,
          }).catch((err) =>
            console.error(
              `[routing] Failed to notify professional ${match.professionalId}:`,
              err,
            ),
          ),
        );
      }
      await Promise.allSettled(notificationPromises);
    } else {
      console.warn(
        `[routing] Skipped professional notifications for appointment ${appointmentId}: missing client email`,
      );
    }

    return { success: true, matches: topMatches, routingStatus: "proposed" };
  } catch (error) {
    console.error("Route appointment error:", error);
    // §3.2: a jumelage tentative that ERRORS (vs. simply finding no eligible pro,
    // which already routes to general + alerts) must ALSO alert the admin so the
    // problem is tracked — otherwise the request sits "pending" with no proposal
    // and no signal. Best-effort; never mask the original failure.
    try {
      const appt = await Appointment.findById(appointmentId)
        .populate("clientId", "firstName lastName email")
        .lean();
      const c = appt?.clientId as
        | { firstName?: string; lastName?: string; email?: string }
        | null;
      await sendAdminJumelageProblemAlert({
        clientName:
          `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim() || "Client",
        clientEmail: c?.email?.trim() || "—",
        appointmentId,
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch (alertErr) {
      console.error("[routing] jumelage-problem alert failed:", alertErr);
    }
    return { success: false, matches: [], routingStatus: "pending" };
  }
}

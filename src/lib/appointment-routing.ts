import Profile from "@/models/Profile";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import MedicalProfile from "@/models/MedicalProfile";
import {
  sendProfessionalNotification,
  sendRequestMovedToGeneralListEmail,
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
      days: { day: string; isWorkDay: boolean }[];
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
  } | null,
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

  // 8. Match by availability
  if (appointment.preferredAvailability && profile.availability?.days) {
    const availableDays = profile.availability.days
      .filter((d) => d.isWorkDay)
      .map((d) => d.day);

    const weekdaySet = new Set([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
    const weekendSet = new Set(["Saturday", "Sunday"]);

    const availabilityMatches = appointment.preferredAvailability.some(
      (pref) => {
        const p = pref.toLowerCase();
        if (p.startsWith("week_")) {
          return availableDays.some((d) => weekdaySet.has(d));
        }
        if (p.startsWith("weekend_")) {
          return availableDays.some((d) => weekendSet.has(d));
        }
        if (p.includes("weekday")) {
          return availableDays.some((d) => weekdaySet.has(d));
        }
        if (p.includes("weekend")) {
          return availableDays.some((d) => weekendSet.has(d));
        }
        return true;
      },
    );

    if (availabilityMatches) {
      score += 10;
      reasons.push("Disponibilité correspondante");
    }
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

    // Get all active professionals with profiles
    const professionals = await User.find({
      role: "professional",
      status: "active",
    }).select("_id firstName lastName email");

    const professionalIds = professionals.map((p) => p._id);

    // Get profiles for all professionals
    const profiles = await Profile.find({
      userId: { $in: professionalIds },
      profileCompleted: true,
    });

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

    // Filter professionals by age category BEFORE calculating relevancy scores
    const ageFilteredProfiles = profiles.filter((profile) =>
      professionalTreatsAgeCategory(profile.ageCategories, isPatientChild),
    );

    if (ageFilteredProfiles.length === 0) {
      console.log(
        `No professionals found for ${isPatientChild ? "child" : "adult"} patients`,
      );
      await Appointment.findByIdAndUpdate(appointmentId, {
        routingStatus: "general",
      });

      // Notify the client their request is now open to the full network
      void (async () => {
        try {
          const apptDoc = await Appointment.findById(appointmentId)
            .populate("clientId", "firstName lastName email language")
            .lean();
          const c = apptDoc?.clientId as {
            firstName?: string;
            lastName?: string;
            email?: string;
            language?: string;
          } | null;
          if (c?.email) {
            await sendRequestMovedToGeneralListEmail({
              clientName: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Client",
              clientEmail: c.email,
              locale: c.language === "fr" ? "fr" : "en",
            });
          }
        } catch (e) {
          console.error("[routing] Failed to send general-list notification:", e);
        }
      })();

      return { success: true, matches: [], routingStatus: "general" };
    }

    // Calculate relevancy scores only for age-filtered professionals
    const matches: ProfessionalMatch[] = [];

    for (const profile of ageFilteredProfiles) {
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
            }
          : null,
      );

      // Only include professionals with a minimum relevancy score
      // Priority: professionals with exact matches (score >= 100) or good matches (score >= 20)
      // Exact match on primary issue or appointment issueType gives 100 points
      if (score >= 20 || score >= 100) {
        matches.push({
          professionalId: profile.userId.toString(),
          score,
          reasons,
        });
      }
    }

    // Sort by score (highest first) and take top 5
    matches.sort((a, b) => b.score - a.score);
    const topMatches = matches.slice(0, 5);

    if (topMatches.length === 0) {
      await Appointment.findByIdAndUpdate(appointmentId, {
        routingStatus: "general",
      });

      // Notify the client their request is now open to the full network
      void (async () => {
        try {
          const apptDoc = await Appointment.findById(appointmentId)
            .populate("clientId", "firstName lastName email language")
            .lean();
          const c = apptDoc?.clientId as {
            firstName?: string;
            lastName?: string;
            email?: string;
            language?: string;
          } | null;
          if (c?.email) {
            await sendRequestMovedToGeneralListEmail({
              clientName: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Client",
              clientEmail: c.email,
              locale: c.language === "fr" ? "fr" : "en",
            });
          }
        } catch (e) {
          console.error("[routing] Failed to send general-list notification:", e);
        }
      })();

      return { success: true, matches: [], routingStatus: "general" };
    }

    // Update appointment with proposed professionals
    const proposedIds = topMatches.map((m) => m.professionalId);
    await Appointment.findByIdAndUpdate(appointmentId, {
      routingStatus: "proposed",
      proposedTo: proposedIds,
    });

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

      for (const match of topMatches) {
        const pro = await User.findById(match.professionalId)
          .select("firstName lastName email")
          .lean();
        if (!pro?.email) continue;

        void sendProfessionalNotification({
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
        );
      }
    } else {
      console.warn(
        `[routing] Skipped professional notifications for appointment ${appointmentId}: missing client email`,
      );
    }

    return { success: true, matches: topMatches, routingStatus: "proposed" };
  } catch (error) {
    console.error("Route appointment error:", error);
    return { success: false, matches: [], routingStatus: "pending" };
  }
}

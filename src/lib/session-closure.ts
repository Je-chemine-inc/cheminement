import type { AppointmentStatus } from "@/types/api";

/** Raison de la consultation (facturation / dossier). */
export const SESSION_ACT_NATURE_VALUES = [
  "parental_coaching",
  "punctual_consultation",
  "psychological_evaluation",
  "individual_psychotherapy",
  "couple_psychotherapy",
  "family_psychotherapy",
  "evaluation_report",
  "notes_synthesis",
  "work_stoppage",
  "psychological_follow_up",
  "parent_support",
] as const;

export type SessionActNature = (typeof SESSION_ACT_NATURE_VALUES)[number];

/**
 * Issue de la rencontre — détermine le statut du RDV et la fraction facturée.
 * Les 4 valeurs reflètent la règle stricte 48 h :
 *   - completed              : séance tenue, 100 % facturé
 *   - cancelled_48h_plus     : annulation >48h (politique standard), 0 frais
 *   - cancelled_late         : annulation tardive <48h, 100 % facturé (frais de gestion)
 *   - no_show                : absence du client, 100 % facturé (frais de gestion)
 */
export const SESSION_OUTCOME_VALUES = [
  "completed",
  "cancelled_48h_plus",
  "cancelled_late",
  "no_show",
] as const;

export type SessionOutcome = (typeof SESSION_OUTCOME_VALUES)[number];

/** True when the outcome is a late cancel or no-show (auto-billed as management fees). */
export function isLateOrNoShow(outcome: SessionOutcome): boolean {
  return outcome === "cancelled_late" || outcome === "no_show";
}

export function getBillingFraction(outcome: SessionOutcome): number {
  switch (outcome) {
    case "completed":
      return 1;
    case "cancelled_48h_plus":
      return 0;
    case "cancelled_late":
      return 1;
    case "no_show":
      return 1;
    default:
      return 1;
  }
}

export function getAppointmentStatusForOutcome(
  outcome: SessionOutcome,
): AppointmentStatus {
  switch (outcome) {
    case "completed":
      return "completed";
    case "cancelled_48h_plus":
      return "cancelled";
    case "cancelled_late":
      return "cancelled";
    case "no_show":
      return "no-show";
    default:
      return "completed";
  }
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

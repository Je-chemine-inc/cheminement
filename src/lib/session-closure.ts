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

/** Issue de la rencontre — détermine le statut du RDV et la fraction facturée. */
export const SESSION_OUTCOME_VALUES = [
  "completed",
  "cancelled_48h_plus",
  "absence_or_late_cancel",
] as const;

export type SessionOutcome = (typeof SESSION_OUTCOME_VALUES)[number];

export function getBillingFraction(outcome: SessionOutcome): number {
  switch (outcome) {
    case "completed":
      return 1;
    case "cancelled_48h_plus":
      return 0;
    case "absence_or_late_cancel":
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
    case "absence_or_late_cancel":
      return "no-show";
    default:
      return "completed";
  }
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

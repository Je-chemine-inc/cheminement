import type { SessionActNature } from "@/lib/session-closure";

export const ACT_LABELS_FR: Record<SessionActNature, string> = {
  parental_coaching: "Coaching parental",
  punctual_consultation: "Consultation ponctuelle / conseils",
  psychological_evaluation: "Évaluation psychologique/neuropsychologique",
  individual_psychotherapy: "Psychothérapie individuelle",
  couple_psychotherapy: "Psychothérapie de couple",
  family_psychotherapy: "Psychothérapie familiale",
  evaluation_report: "Rédaction rapport d'évaluation",
  notes_synthesis: "Rédaction notes, synthèse du dossier",
  work_stoppage: "Rédaction : arrêt de travail / plan de retour progressif au travail",
  psychological_follow_up: "Suivi psychologique",
  parent_support: "Soutien aux parents",
};

export function getSessionActNatureLabelFr(key: string | undefined): string {
  if (!key || !(key in ACT_LABELS_FR)) return key || "—";
  return ACT_LABELS_FR[key as SessionActNature];
}
